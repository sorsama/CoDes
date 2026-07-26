use crate::AppState;
use chrono::{Datelike, SecondsFormat, TimeZone, Utc};
use keyring::Entry;
use reqwest::blocking::Client;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;
use walkdir::WalkDir;

const KEYRING_SERVICE: &str = "codes.usage";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    id: String,
    external_id: Option<String>,
    provider: String,
    product: String,
    model: Option<String>,
    workspace_id: Option<String>,
    project_id: Option<String>,
    session_id: Option<String>,
    started_at: i64,
    ended_at: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_tokens: Option<i64>,
    reasoning_tokens: Option<i64>,
    total_tokens: Option<i64>,
    request_count: Option<i64>,
    cost_amount: Option<f64>,
    cost_currency: Option<String>,
    native_unit: Option<String>,
    native_quantity: Option<f64>,
    source: String,
    source_kind: String,
    confidence: String,
    synced_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageConnector {
    id: String,
    kind: String,
    label: String,
    enabled: bool,
    account_id: Option<String>,
    project_id: Option<String>,
    organization_id: Option<String>,
    has_credential: bool,
    last_synced_at: Option<i64>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSyncStatus {
    connector_id: String,
    status: String,
    records_imported: usize,
    last_synced_at: Option<i64>,
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQuery {
    provider: Option<String>,
    source_kind: Option<String>,
    project_id: Option<String>,
    start_at: Option<i64>,
    end_at: Option<i64>,
    limit: Option<usize>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn keyring_entry(id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, id).map_err(|error| error.to_string())
}

fn has_secret(id: &str) -> bool {
    keyring_entry(id)
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok()
}

fn connector_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UsageConnector> {
    let id: String = row.get(0)?;
    Ok(UsageConnector {
        has_credential: has_secret(&id),
        id,
        kind: row.get(1)?,
        label: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        account_id: row.get(4)?,
        project_id: row.get(5)?,
        organization_id: row.get(6)?,
        last_synced_at: row.get(7)?,
        last_error: row.get(8)?,
    })
}

#[tauri::command]
pub fn usage_connectors(state: State<'_, AppState>) -> Result<Vec<UsageConnector>, String> {
    let database = state.database.lock();
    let mut statement = database
        .prepare("SELECT id,kind,label,enabled,account_id,project_id,organization_id,last_synced_at,last_error FROM usage_connectors ORDER BY label")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], connector_from_row)
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn save_usage_connector(
    connector: UsageConnector,
    secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<UsageConnector, String> {
    if !matches!(
        connector.kind.as_str(),
        "openai" | "anthropic" | "github" | "google"
    ) {
        return Err("Unsupported usage connector.".into());
    }
    if let Some(secret) = secret.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        keyring_entry(&connector.id)?
            .set_password(secret)
            .map_err(|error| format!("Could not save credential: {error}"))?;
    }
    state.database.lock().execute(
        "INSERT INTO usage_connectors(id,kind,label,enabled,account_id,project_id,organization_id,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,enabled=excluded.enabled,account_id=excluded.account_id,project_id=excluded.project_id,organization_id=excluded.organization_id,updated_at=excluded.updated_at",
        params![
            connector.id,
            connector.kind,
            connector.label,
            connector.enabled as i64,
            connector.account_id,
            connector.project_id,
            connector.organization_id,
            now_ms()
        ],
    ).map_err(|error| error.to_string())?;
    Ok(UsageConnector {
        has_credential: has_secret(&connector.id),
        ..connector
    })
}

#[tauri::command]
pub fn delete_usage_credential(id: String) -> Result<(), String> {
    match keyring_entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete credential: {error}")),
    }
}

fn upsert(database: &rusqlite::Connection, record: &UsageRecord) -> Result<(), String> {
    database.execute(
        "INSERT INTO usage_records(id,external_id,provider,product,model,workspace_id,project_id,session_id,started_at,ended_at,input_tokens,output_tokens,cached_tokens,reasoning_tokens,total_tokens,request_count,cost_amount,cost_currency,native_unit,native_quantity,source,source_kind,confidence,synced_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
         ON CONFLICT(source,external_id) DO UPDATE SET provider=excluded.provider,product=excluded.product,model=excluded.model,workspace_id=COALESCE(excluded.workspace_id,usage_records.workspace_id),project_id=COALESCE(excluded.project_id,usage_records.project_id),session_id=COALESCE(excluded.session_id,usage_records.session_id),started_at=excluded.started_at,ended_at=excluded.ended_at,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cached_tokens=excluded.cached_tokens,reasoning_tokens=excluded.reasoning_tokens,total_tokens=excluded.total_tokens,request_count=excluded.request_count,cost_amount=excluded.cost_amount,cost_currency=excluded.cost_currency,native_unit=excluded.native_unit,native_quantity=excluded.native_quantity,source_kind=excluded.source_kind,confidence=excluded.confidence,synced_at=excluded.synced_at",
        params![
            record.id, record.external_id, record.provider, record.product, record.model,
            record.workspace_id, record.project_id, record.session_id, record.started_at,
            record.ended_at, record.input_tokens, record.output_tokens, record.cached_tokens,
            record.reasoning_tokens, record.total_tokens, record.request_count, record.cost_amount,
            record.cost_currency, record.native_unit, record.native_quantity, record.source,
            record.source_kind, record.confidence, record.synced_at
        ],
    ).map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn record_usage(mut record: UsageRecord, state: State<'_, AppState>) -> Result<(), String> {
    if record.id.trim().is_empty() {
        record.id = Uuid::new_v4().to_string();
    }
    record.synced_at = now_ms();
    upsert(&state.database.lock(), &record)
}

fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UsageRecord> {
    Ok(UsageRecord {
        id: row.get(0)?,
        external_id: row.get(1)?,
        provider: row.get(2)?,
        product: row.get(3)?,
        model: row.get(4)?,
        workspace_id: row.get(5)?,
        project_id: row.get(6)?,
        session_id: row.get(7)?,
        started_at: row.get(8)?,
        ended_at: row.get(9)?,
        input_tokens: row.get(10)?,
        output_tokens: row.get(11)?,
        cached_tokens: row.get(12)?,
        reasoning_tokens: row.get(13)?,
        total_tokens: row.get(14)?,
        request_count: row.get(15)?,
        cost_amount: row.get(16)?,
        cost_currency: row.get(17)?,
        native_unit: row.get(18)?,
        native_quantity: row.get(19)?,
        source: row.get(20)?,
        source_kind: row.get(21)?,
        confidence: row.get(22)?,
        synced_at: row.get(23)?,
    })
}

#[tauri::command]
pub fn query_usage(
    query: UsageQuery,
    state: State<'_, AppState>,
) -> Result<Vec<UsageRecord>, String> {
    let database = state.database.lock();
    let mut statement = database.prepare(
        "SELECT id,external_id,provider,product,model,workspace_id,project_id,session_id,started_at,ended_at,input_tokens,output_tokens,cached_tokens,reasoning_tokens,total_tokens,request_count,cost_amount,cost_currency,native_unit,native_quantity,source,source_kind,confidence,synced_at
         FROM usage_records
         WHERE (?1 IS NULL OR provider=?1) AND (?2 IS NULL OR source_kind=?2) AND (?3 IS NULL OR project_id=?3)
           AND (?4 IS NULL OR started_at>=?4) AND (?5 IS NULL OR started_at<?5)
         ORDER BY started_at DESC LIMIT ?6"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                query.provider,
                query.source_kind,
                query.project_id,
                query.start_at,
                query.end_at,
                query.limit.unwrap_or(500).min(5_000) as i64
            ],
            record_from_row,
        )
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn integer(value: &Value, names: &[&str]) -> Option<i64> {
    names.iter().find_map(|name| {
        value
            .get(*name)
            .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
    })
}

fn text(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name)?.as_str().map(str::to_string))
}

fn parse_timestamp(value: &Value, fallback: i64) -> i64 {
    text(value, &["timestamp", "created_at", "started_at"])
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.timestamp_millis())
        .or_else(|| integer(value, &["timestamp", "created_at", "started_at"]))
        .map(|value| {
            if value < 10_000_000_000 {
                value * 1000
            } else {
                value
            }
        })
        .unwrap_or(fallback)
}

fn usage_from_value(
    provider: &str,
    product: &str,
    source: &str,
    external_id: String,
    value: &Value,
    fallback_time: i64,
) -> Option<UsageRecord> {
    let usage = value
        .get("usage")
        .or_else(|| value.get("usage_metadata"))
        .unwrap_or(value);
    let input_tokens = integer(
        usage,
        &[
            "input_tokens",
            "prompt_tokens",
            "inputTokens",
            "promptTokenCount",
        ],
    );
    let output_tokens = integer(
        usage,
        &[
            "output_tokens",
            "completion_tokens",
            "outputTokens",
            "candidatesTokenCount",
        ],
    );
    let cached_tokens = integer(
        usage,
        &[
            "input_cached_tokens",
            "cache_read_input_tokens",
            "cached_tokens",
            "cachedContentTokenCount",
        ],
    );
    let reasoning_tokens = integer(
        usage,
        &["reasoning_tokens", "thoughtsTokenCount", "thinking_tokens"],
    );
    let total_tokens = integer(usage, &["total_tokens", "totalTokens", "totalTokenCount"])
        .or_else(|| Some(input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0)));
    if input_tokens.is_none()
        && output_tokens.is_none()
        && cached_tokens.is_none()
        && reasoning_tokens.is_none()
        && total_tokens == Some(0)
    {
        return None;
    }
    Some(UsageRecord {
        id: Uuid::new_v4().to_string(),
        external_id: Some(external_id),
        provider: provider.into(),
        product: product.into(),
        model: text(value, &["model", "model_name", "modelName"]),
        workspace_id: None,
        project_id: None,
        session_id: text(value, &["session_id", "sessionId"]),
        started_at: parse_timestamp(value, fallback_time),
        ended_at: None,
        input_tokens,
        output_tokens,
        cached_tokens,
        reasoning_tokens,
        total_tokens,
        request_count: Some(1),
        cost_amount: value
            .get("cost")
            .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok())),
        cost_currency: value.get("cost").map(|_| "USD".into()),
        native_unit: None,
        native_quantity: None,
        source: source.into(),
        source_kind: "local_structured".into(),
        confidence: "provider_reported".into(),
        synced_at: now_ms(),
    })
}

fn scan_jsonl_tree(root: &Path, provider: &str, product: &str) -> Vec<UsageRecord> {
    if !root.is_dir() {
        return vec![];
    }
    let mut records = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry.path().extension().is_some_and(|ext| ext == "jsonl")
        })
    {
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64)
            .unwrap_or_else(now_ms);
        let Ok(file) = fs::File::open(entry.path()) else {
            continue;
        };
        for (index, line) in BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .enumerate()
        {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let candidates = [
                &value,
                value.get("payload").unwrap_or(&Value::Null),
                value.get("message").unwrap_or(&Value::Null),
            ];
            if let Some(record) = candidates.iter().find_map(|candidate| {
                usage_from_value(
                    provider,
                    product,
                    &format!("{provider}-local"),
                    format!("{}:{index}", entry.path().to_string_lossy()),
                    candidate,
                    modified,
                )
            }) {
                records.push(record);
            }
        }
    }
    records
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn scan_opencode(home: &Path) -> Vec<UsageRecord> {
    let candidates = [
        home.join(".local/share/opencode/opencode.db"),
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join("opencode/opencode.db"),
    ];
    let Some(path) = candidates.into_iter().find(|path| path.is_file()) else {
        return vec![];
    };
    let Ok(database) =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return vec![];
    };
    let Ok(mut statement) = database
        .prepare("SELECT id,session_id,time_created,data FROM message ORDER BY time_created")
    else {
        return vec![];
    };
    let Ok(rows) = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
        ))
    }) else {
        return vec![];
    };
    rows.filter_map(Result::ok)
        .filter_map(|(id, session_id, timestamp, data)| {
            let value = serde_json::from_str::<Value>(&data).ok()?;
            let mut record = usage_from_value(
                "opencode",
                "OpenCode",
                "opencode-local",
                id,
                &value,
                timestamp,
            )?;
            record.session_id = Some(session_id);
            Some(record)
        })
        .collect()
}

#[tauri::command]
pub fn sync_local_usage(state: State<'_, AppState>) -> Result<UsageSyncStatus, String> {
    let home = home_dir().ok_or_else(|| "User home directory is unavailable.".to_string())?;
    let sources = [
        (home.join(".codex/sessions"), "codex", "Codex"),
        (home.join(".claude/projects"), "claude", "Claude Code"),
        (home.join(".pi/agent/sessions"), "pi", "Pi"),
        (home.join(".grok/sessions"), "grok", "Grok Build"),
    ];
    let database = state.database.lock();
    let mut imported = 0;
    for (root, provider, product) in sources {
        for record in scan_jsonl_tree(&root, provider, product) {
            upsert(&database, &record)?;
            imported += 1;
        }
    }
    for record in scan_opencode(&home) {
        upsert(&database, &record)?;
        imported += 1;
    }
    Ok(UsageSyncStatus {
        connector_id: "local".into(),
        status: "ready".into(),
        records_imported: imported,
        last_synced_at: Some(now_ms()),
        detail: Some("Read verified token fields from local provider records.".into()),
    })
}

fn get_json(client: &Client, url: &str, header: (&str, String)) -> Result<Value, String> {
    let response = client
        .get(url)
        .header(header.0, header.1)
        .header("content-type", "application/json")
        .send()
        .map_err(|error| format!("Usage service could not be reached: {error}"))?;
    let status = response.status();
    let body = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Usage service returned {}. Check the credential and account scope.",
            status.as_u16()
        ));
    }
    serde_json::from_str(&body).map_err(|error| format!("Usage response was malformed: {error}"))
}

fn paginated_json(
    client: &Client,
    base_url: &str,
    header: (&str, String),
    page_key: &str,
) -> Result<Vec<Value>, String> {
    let mut url = base_url.to_string();
    let mut data = Vec::new();
    for _ in 0..100 {
        let page = get_json(client, &url, (header.0, header.1.clone()))?;
        data.extend(
            page.get("data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned(),
        );
        let next = page
            .get("next_page")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        if page.get("has_more").and_then(Value::as_bool) != Some(true) || next.is_none() {
            break;
        }
        let separator = if base_url.contains('?') { '&' } else { '?' };
        url = format!("{base_url}{separator}{page_key}={}", next.unwrap());
    }
    Ok(data)
}

fn anthropic_pages(client: &Client, base_url: &str, secret: &str) -> Result<Vec<Value>, String> {
    let mut url = base_url.to_string();
    let mut data = Vec::new();
    for _ in 0..100 {
        let response = client
            .get(&url)
            .header("x-api-key", secret)
            .header("anthropic-version", "2023-06-01")
            .send()
            .map_err(|error| format!("Anthropic usage could not be reached: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Anthropic returned {}. An Admin API key is required.",
                response.status().as_u16()
            ));
        }
        let page: Value = response.json().map_err(|error| error.to_string())?;
        data.extend(
            page.get("data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned(),
        );
        let next = page
            .get("next_page")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        if page.get("has_more").and_then(Value::as_bool) != Some(true) || next.is_none() {
            break;
        }
        let separator = if base_url.contains('?') { '&' } else { '?' };
        url = format!("{base_url}{separator}page={}", next.unwrap());
    }
    Ok(data)
}

fn openai_records(connector: &UsageConnector, secret: &str) -> Result<Vec<UsageRecord>, String> {
    let client = Client::builder()
        .build()
        .map_err(|error| error.to_string())?;
    let start = (Utc::now() - chrono::Duration::days(30)).timestamp();
    let url = format!(
        "https://api.openai.com/v1/organization/usage/completions?start_time={start}&bucket_width=1d&limit=31&group_by=model"
    );
    let buckets = paginated_json(
        &client,
        &url,
        ("authorization", format!("Bearer {secret}")),
        "page",
    )?;
    let mut records = Vec::new();
    for bucket in &buckets {
        let started_at = integer(bucket, &["start_time"]).unwrap_or(start) * 1000;
        for (index, result) in bucket
            .get("results")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            if let Some(mut record) = usage_from_value(
                "openai",
                "OpenAI API",
                &format!("openai:{}", connector.id),
                format!(
                    "{started_at}:{index}:{}",
                    text(result, &["model"]).unwrap_or_default()
                ),
                result,
                started_at,
            ) {
                record.source_kind = "official_api".into();
                record.confidence = "exact".into();
                record.request_count = integer(result, &["num_model_requests"]);
                records.push(record);
            }
        }
    }
    let cost_url = format!(
        "https://api.openai.com/v1/organization/costs?start_time={start}&bucket_width=1d&limit=31&group_by=project_id"
    );
    let cost_buckets = paginated_json(
        &client,
        &cost_url,
        ("authorization", format!("Bearer {secret}")),
        "page",
    )?;
    for bucket in &cost_buckets {
        let started_at = integer(bucket, &["start_time"]).unwrap_or(start) * 1000;
        for (index, result) in bucket
            .get("results")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let amount = result
                .pointer("/amount/value")
                .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()));
            records.push(UsageRecord {
                id: Uuid::new_v4().to_string(),
                external_id: Some(format!(
                    "cost:{started_at}:{index}:{}",
                    text(result, &["project_id", "line_item"]).unwrap_or_default()
                )),
                provider: "openai".into(),
                product: text(result, &["line_item"]).unwrap_or_else(|| "OpenAI API".into()),
                model: None,
                workspace_id: None,
                project_id: text(result, &["project_id"]),
                session_id: None,
                started_at,
                ended_at: None,
                input_tokens: None,
                output_tokens: None,
                cached_tokens: None,
                reasoning_tokens: None,
                total_tokens: None,
                request_count: None,
                cost_amount: amount,
                cost_currency: result
                    .pointer("/amount/currency")
                    .and_then(Value::as_str)
                    .map(|value| value.to_uppercase())
                    .or(Some("USD".into())),
                native_unit: None,
                native_quantity: None,
                source: format!("openai:{}", connector.id),
                source_kind: "official_api".into(),
                confidence: "exact".into(),
                synced_at: now_ms(),
            });
        }
    }
    Ok(records)
}

fn anthropic_records(connector: &UsageConnector, secret: &str) -> Result<Vec<UsageRecord>, String> {
    let client = Client::builder()
        .build()
        .map_err(|error| error.to_string())?;
    let start =
        (Utc::now() - chrono::Duration::days(30)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let end = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let url = format!(
        "https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at={start}&ending_at={end}&bucket_width=1d&group_by[]=model"
    );
    let buckets = anthropic_pages(&client, &url, secret)?;
    let mut records = Vec::new();
    for (bucket_index, bucket) in buckets.iter().enumerate() {
        let started_at = parse_timestamp(bucket, now_ms());
        for (index, result) in bucket
            .get("results")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            if let Some(mut record) = usage_from_value(
                "anthropic",
                "Claude Platform",
                &format!("anthropic:{}", connector.id),
                format!("{bucket_index}:{index}:{started_at}"),
                result,
                started_at,
            ) {
                record.source_kind = "official_api".into();
                record.confidence = "exact".into();
                records.push(record);
            }
        }
    }
    let cost_url = format!(
        "https://api.anthropic.com/v1/organizations/cost_report?starting_at={start}&ending_at={end}&bucket_width=1d&group_by[]=description"
    );
    let costs = anthropic_pages(&client, &cost_url, secret)?;
    for (index, result) in costs.iter().enumerate() {
        let lowest_units = result.get("amount").and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str()?.parse::<f64>().ok())
        });
        records.push(UsageRecord {
            id: Uuid::new_v4().to_string(),
            external_id: Some(format!(
                "cost:{index}:{}",
                text(result, &["starting_at", "description"]).unwrap_or_default()
            )),
            provider: "anthropic".into(),
            product: text(result, &["description", "cost_type"])
                .unwrap_or_else(|| "Claude Platform".into()),
            model: result
                .pointer("/description/model")
                .and_then(Value::as_str)
                .map(str::to_string),
            workspace_id: None,
            project_id: text(result, &["workspace_id"]),
            session_id: None,
            started_at: parse_timestamp(result, now_ms()),
            ended_at: None,
            input_tokens: None,
            output_tokens: None,
            cached_tokens: None,
            reasoning_tokens: None,
            total_tokens: None,
            request_count: None,
            cost_amount: lowest_units.map(|value| value / 100.0),
            cost_currency: Some("USD".into()),
            native_unit: Some("cents".into()),
            native_quantity: lowest_units,
            source: format!("anthropic:{}", connector.id),
            source_kind: "official_api".into(),
            confidence: "exact".into(),
            synced_at: now_ms(),
        });
    }
    Ok(records)
}

fn github_records(connector: &UsageConnector) -> Result<Vec<UsageRecord>, String> {
    let account = if let Some(account) = connector.account_id.as_deref() {
        account.to_string()
    } else {
        let output = Command::new("gh")
            .args(["api", "user", "--jq", ".login"])
            .output()
            .map_err(|error| format!("GitHub CLI is unavailable: {error}"))?;
        if !output.status.success() {
            return Err("GitHub CLI is not authenticated.".into());
        }
        String::from_utf8_lossy(&output.stdout).trim().into()
    };
    let now = Utc::now();
    let endpoint = if let Some(organization) = connector
        .organization_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        format!(
            "organizations/{organization}/settings/billing/ai_credit/usage?year={}&month={}",
            now.year(),
            now.month()
        )
    } else {
        format!(
            "users/{account}/settings/billing/ai_credit/usage?year={}&month={}",
            now.year(),
            now.month()
        )
    };
    let output = Command::new("gh")
        .args(["api", &endpoint])
        .output()
        .map_err(|error| format!("GitHub usage could not be loaded: {error}"))?;
    if !output.status.success() {
        return Err("GitHub billing usage is unavailable for this account or token scope.".into());
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let started_at = Utc
        .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
        .single()
        .map(|value| value.timestamp_millis())
        .unwrap_or_else(now_ms);
    Ok(value
        .get("usageItems")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, item)| UsageRecord {
            id: Uuid::new_v4().to_string(),
            external_id: Some(format!(
                "{}:{index}:{}",
                now.format("%Y-%m"),
                text(item, &["sku"]).unwrap_or_default()
            )),
            provider: "github".into(),
            product: text(item, &["product"]).unwrap_or_else(|| "GitHub Copilot".into()),
            model: text(item, &["model"]),
            workspace_id: None,
            project_id: None,
            session_id: None,
            started_at,
            ended_at: None,
            input_tokens: None,
            output_tokens: None,
            cached_tokens: None,
            reasoning_tokens: None,
            total_tokens: None,
            request_count: None,
            cost_amount: item.get("netAmount").and_then(Value::as_f64),
            cost_currency: Some("USD".into()),
            native_unit: text(item, &["unitType"]),
            native_quantity: item.get("grossQuantity").and_then(Value::as_f64),
            source: format!("github:{}", connector.id),
            source_kind: "official_api".into(),
            confidence: "exact".into(),
            synced_at: now_ms(),
        })
        .collect())
}

fn google_records(connector: &UsageConnector) -> Result<Vec<UsageRecord>, String> {
    let project = connector
        .project_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Google connector needs a Cloud project ID.".to_string())?;
    let token = ["auth", "application-default", "print-access-token"];
    let mut output = Command::new("gcloud").args(token).output();
    if output.as_ref().is_err() || output.as_ref().is_ok_and(|value| !value.status.success()) {
        output = Command::new("gcloud")
            .args(["auth", "print-access-token"])
            .output();
    }
    let output = output.map_err(|error| format!("gcloud is unavailable: {error}"))?;
    if !output.status.success() {
        return Err("Google Cloud authentication is unavailable.".into());
    }
    let access_token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let end = Utc::now();
    let start = end - chrono::Duration::days(30);
    let metrics = [
        (
            "generativelanguage.googleapis.com/generate_content_usage_input_token_count",
            "input",
        ),
        (
            "generativelanguage.googleapis.com/generate_content_usage_output_token_count",
            "output",
        ),
    ];
    let client = Client::builder()
        .build()
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for (metric, direction) in metrics {
        let url = reqwest::Url::parse_with_params(
            &format!("https://monitoring.googleapis.com/v3/projects/{project}/timeSeries"),
            &[
                ("filter", format!("metric.type=\"{metric}\"")),
                ("interval.startTime", start.to_rfc3339()),
                ("interval.endTime", end.to_rfc3339()),
                ("view", "FULL".into()),
            ],
        )
        .map_err(|error| error.to_string())?;
        let value = get_json(
            &client,
            url.as_str(),
            ("authorization", format!("Bearer {access_token}")),
        )?;
        for (series_index, series) in value
            .get("timeSeries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let model = series
                .pointer("/metric/labels/model")
                .and_then(Value::as_str)
                .map(str::to_string);
            for (point_index, point) in series
                .get("points")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let quantity = point.pointer("/value/int64Value").and_then(|value| {
                    value
                        .as_str()
                        .and_then(|value| value.parse::<i64>().ok())
                        .or_else(|| value.as_i64())
                });
                let timestamp = point
                    .pointer("/interval/endTime")
                    .and_then(Value::as_str)
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .map(|value| value.timestamp_millis())
                    .unwrap_or_else(now_ms);
                records.push(UsageRecord {
                    id: Uuid::new_v4().to_string(),
                    external_id: Some(format!("{metric}:{series_index}:{point_index}:{timestamp}")),
                    provider: "google".into(),
                    product: "Gemini API".into(),
                    model: model.clone(),
                    workspace_id: None,
                    project_id: Some(project.into()),
                    session_id: None,
                    started_at: timestamp,
                    ended_at: None,
                    input_tokens: (direction == "input").then_some(quantity.unwrap_or(0)),
                    output_tokens: (direction == "output").then_some(quantity.unwrap_or(0)),
                    cached_tokens: None,
                    reasoning_tokens: None,
                    total_tokens: quantity,
                    request_count: None,
                    cost_amount: None,
                    cost_currency: None,
                    native_unit: Some("tokens".into()),
                    native_quantity: quantity.map(|value| value as f64),
                    source: format!("google:{}", connector.id),
                    source_kind: "official_api".into(),
                    confidence: "exact".into(),
                    synced_at: now_ms(),
                });
            }
        }
    }
    Ok(records)
}

#[tauri::command]
pub fn sync_usage_connector(
    id: String,
    state: State<'_, AppState>,
) -> Result<UsageSyncStatus, String> {
    let connector = {
        let database = state.database.lock();
        database.query_row(
            "SELECT id,kind,label,enabled,account_id,project_id,organization_id,last_synced_at,last_error FROM usage_connectors WHERE id=?1",
            [&id],
            connector_from_row,
        ).optional().map_err(|error| error.to_string())?
            .ok_or_else(|| "Usage connector was not found.".to_string())?
    };
    if !connector.enabled {
        return Err("Enable the connector before refreshing it.".into());
    }
    let secret = if matches!(connector.kind.as_str(), "openai" | "anthropic") {
        Some(
            keyring_entry(&connector.id)?
                .get_password()
                .map_err(|_| "The connector credential is missing.".to_string())?,
        )
    } else {
        None
    };
    let result = match connector.kind.as_str() {
        "openai" => openai_records(&connector, secret.as_deref().unwrap_or_default()),
        "anthropic" => anthropic_records(&connector, secret.as_deref().unwrap_or_default()),
        "github" => github_records(&connector),
        "google" => google_records(&connector),
        _ => Err("Unsupported usage connector.".into()),
    };
    let synced_at = now_ms();
    match result {
        Ok(records) => {
            let database = state.database.lock();
            let imported = records.len();
            for record in records {
                upsert(&database, &record)?;
            }
            database.execute(
                "UPDATE usage_connectors SET last_synced_at=?1,last_error=NULL,updated_at=?1 WHERE id=?2",
                params![synced_at, id],
            ).map_err(|error| error.to_string())?;
            Ok(UsageSyncStatus {
                connector_id: id,
                status: "ready".into(),
                records_imported: imported,
                last_synced_at: Some(synced_at),
                detail: Some("Official usage refreshed.".into()),
            })
        }
        Err(error) => {
            let _ = state.database.lock().execute(
                "UPDATE usage_connectors SET last_error=?1,updated_at=?2 WHERE id=?3",
                params![error, synced_at, id],
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_explicit_token_fields() {
        assert!(
            usage_from_value(
                "x",
                "x",
                "x",
                "1".into(),
                &serde_json::json!({"text":"many words"}),
                1
            )
            .is_none()
        );
        let record = usage_from_value(
            "x",
            "x",
            "x",
            "2".into(),
            &serde_json::json!({"usage":{"input_tokens":12,"output_tokens":4}}),
            1,
        )
        .expect("usage");
        assert_eq!(record.total_tokens, Some(16));
    }
}
