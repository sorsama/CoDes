use regex::Regex;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const TRANSCRIPT_LIMIT: usize = 1_048_576;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareHistoryRequest {
    pub session_id: String,
    pub provider: String,
    pub cwd: String,
    pub started_at: i64,
    pub provider_session_id: Option<String>,
    pub mode: String,
    pub recent_turns: usize,
    pub max_chars: usize,
    pub redact_secrets: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPreview {
    pub status: String,
    pub source: String,
    pub source_label: String,
    pub conversation_available: bool,
    pub provider_session_id: Option<String>,
    pub content: String,
    pub char_count: usize,
    pub message_count: usize,
    pub redaction_count: usize,
    pub omitted_count: usize,
    pub warning: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
struct HistoryMessage {
    role: String,
    content: String,
    timestamp: Option<i64>,
}

#[derive(Debug, Clone)]
struct ImportedHistory {
    source: String,
    source_label: String,
    session_id: Option<String>,
    messages: Vec<HistoryMessage>,
}

#[derive(Debug, Clone)]
enum HistoryIssue {
    Unavailable(String),
    Ambiguous(String),
    Malformed(String),
    PermissionDenied(String),
}

impl HistoryIssue {
    fn status(&self) -> &'static str {
        match self {
            Self::Unavailable(_) => "unavailable",
            Self::Ambiguous(_) => "ambiguous",
            Self::Malformed(_) => "malformed",
            Self::PermissionDenied(_) => "permission_denied",
        }
    }
    fn detail(&self) -> &str {
        match self {
            Self::Unavailable(value)
            | Self::Ambiguous(value)
            | Self::Malformed(value)
            | Self::PermissionDenied(value) => value,
        }
    }
}

pub fn transcript_path(app_data_dir: &Path, session_id: &str) -> PathBuf {
    let safe: String = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    app_data_dir
        .join("transcripts")
        .join(format!("{safe}.ansi"))
}

pub fn persist_transcript(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tail = if bytes.len() > TRANSCRIPT_LIMIT {
        &bytes[bytes.len() - TRANSCRIPT_LIMIT..]
    } else {
        bytes
    };
    fs::write(path, tail)
}

pub fn remove_transcript(app_data_dir: &Path, session_id: &str) -> Result<(), String> {
    let path = transcript_path(app_data_dir, session_id);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn prepare_history(app_data_dir: &Path, request: &PrepareHistoryRequest) -> HistoryPreview {
    let structured = import_structured(request);
    let conversation_available = structured
        .as_ref()
        .is_ok_and(|history| !history.messages.is_empty());

    let selected = match request.mode.as_str() {
        "conversation" => structured,
        "recent" if conversation_available => structured.map(|mut history| {
            let keep = request.recent_turns.max(1).saturating_mul(2);
            if history.messages.len() > keep {
                history.messages = history.messages.split_off(history.messages.len() - keep);
            }
            history.source = format!("{}-recent", history.source);
            history.source_label = format!("{} · recent", history.source_label);
            history
        }),
        "recent" | "visible" => import_visible(app_data_dir, request).map(|mut history| {
            if request.mode == "recent" {
                history.messages = recent_visible(history.messages, request.recent_turns.max(1));
                history.source = "codes-visible-recent".into();
                history.source_label = "CoDes terminal capture · recent".into();
            }
            history
        }),
        _ => Err(HistoryIssue::Malformed(
            "Unknown handoff history mode.".into(),
        )),
    };

    let mut history = match selected {
        Ok(history) if !history.messages.is_empty() => history,
        Ok(_) => {
            return issue_preview(
                HistoryIssue::Unavailable("No transferable messages were found.".into()),
                conversation_available,
            );
        }
        Err(issue) => return issue_preview(issue, conversation_available),
    };

    let mut redaction_count = 0;
    if request.redact_secrets {
        for message in &mut history.messages {
            let (redacted, count) = redact(&message.content);
            message.content = redacted;
            redaction_count += count;
        }
    }
    let (messages, omitted_count) = limit_messages(history.messages, request.max_chars.max(1_024));
    let content = render_messages(&messages, omitted_count);
    let warning = if omitted_count > 0 {
        Some(format!(
            "{omitted_count} older message(s) were omitted to fit the transfer limit."
        ))
    } else if redaction_count > 0 {
        Some(format!("{redaction_count} likely secret(s) were redacted."))
    } else {
        None
    };
    HistoryPreview {
        status: "ready".into(),
        source: history.source,
        source_label: history.source_label,
        conversation_available,
        provider_session_id: history.session_id,
        char_count: content.chars().count(),
        message_count: messages.len(),
        redaction_count,
        omitted_count,
        warning,
        detail: None,
        content,
    }
}

fn issue_preview(issue: HistoryIssue, conversation_available: bool) -> HistoryPreview {
    let detail = issue.detail().to_string();
    HistoryPreview {
        status: issue.status().into(),
        source: "none".into(),
        source_label: "No history source".into(),
        conversation_available,
        provider_session_id: None,
        content: String::new(),
        char_count: 0,
        message_count: 0,
        redaction_count: 0,
        omitted_count: 0,
        warning: None,
        detail: Some(detail),
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn import_structured(request: &PrepareHistoryRequest) -> Result<ImportedHistory, HistoryIssue> {
    let home = home_dir()
        .ok_or_else(|| HistoryIssue::Unavailable("User home directory is unavailable.".into()))?;
    match request.provider.as_str() {
        "codex" => import_jsonl_tree(
            &home.join(".codex/sessions"),
            request,
            "codex-jsonl",
            "Codex conversation",
            parse_codex_file,
        ),
        "claude" => import_jsonl_tree(
            &home.join(".claude/projects"),
            request,
            "claude-jsonl",
            "Claude conversation",
            parse_claude_file,
        ),
        "pi" => import_jsonl_tree(
            &home.join(".pi/agent/sessions"),
            request,
            "pi-jsonl",
            "Pi conversation",
            parse_pi_file,
        ),
        "grok" => import_grok(&home, request),
        "opencode" => import_opencode(&home, request),
        provider => Err(HistoryIssue::Unavailable(format!(
            "{provider} does not expose a verified structured local history; choose Full visible or Recent."
        ))),
    }
}

type ParsedHistory = (Option<String>, Option<String>, Vec<HistoryMessage>);
type FileParser = fn(&Path) -> Result<ParsedHistory, HistoryIssue>;

fn import_jsonl_tree(
    root: &Path,
    request: &PrepareHistoryRequest,
    source: &str,
    label: &str,
    parser: FileParser,
) -> Result<ImportedHistory, HistoryIssue> {
    let files = collect_files(root, "jsonl")?;
    let mut candidates = Vec::new();
    for path in files {
        let Ok((session_id, cwd, messages)) = parser(&path) else {
            continue;
        };
        if messages.is_empty()
            || cwd
                .as_deref()
                .is_some_and(|value| !same_path(value, &request.cwd))
        {
            continue;
        }
        if let Some(expected) = request.provider_session_id.as_deref()
            && session_id.as_deref() != Some(expected)
            && !path.to_string_lossy().contains(expected)
        {
            continue;
        }
        let modified = created_ms(&path).unwrap_or_default();
        candidates.push((
            distance(modified, request.started_at),
            modified,
            session_id,
            messages,
        ));
    }
    select_candidate(candidates, request, source, label)
}

fn select_candidate(
    mut candidates: Vec<(i64, i64, Option<String>, Vec<HistoryMessage>)>,
    request: &PrepareHistoryRequest,
    source: &str,
    label: &str,
) -> Result<ImportedHistory, HistoryIssue> {
    if candidates.is_empty() {
        return Err(HistoryIssue::Unavailable(format!(
            "No {label} matching this working directory and session was found."
        )));
    }
    candidates.sort_by_key(|candidate| candidate.0);
    if request.provider_session_id.is_none()
        && candidates.len() > 1
        && candidates[0].0 <= 5_000
        && candidates[1].0 <= 5_000
    {
        return Err(HistoryIssue::Ambiguous(format!(
            "Multiple {label} files match sessions started at nearly the same time."
        )));
    }
    let (_, _, session_id, messages) = candidates.remove(0);
    Ok(ImportedHistory {
        source: source.into(),
        source_label: label.into(),
        session_id,
        messages,
    })
}

fn parse_codex_file(path: &Path) -> Result<ParsedHistory, HistoryIssue> {
    parse_lines(path, |value, session_id, cwd, messages| {
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            let payload = &value["payload"];
            *session_id = string_field(payload, &["id", "session_id"]);
            *cwd = string_field(payload, &["cwd"]);
        } else if value.get("type").and_then(Value::as_str) == Some("response_item") {
            push_message(&value["payload"], messages);
        }
    })
}

fn parse_claude_file(path: &Path) -> Result<ParsedHistory, HistoryIssue> {
    parse_lines(path, |value, session_id, cwd, messages| {
        if session_id.is_none() {
            *session_id = string_field(value, &["sessionId", "session_id"]);
        }
        if cwd.is_none() {
            *cwd = string_field(value, &["cwd"]);
        }
        if !value
            .get("isMeta")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            push_message(value.get("message").unwrap_or(value), messages);
        }
    })
}

fn parse_pi_file(path: &Path) -> Result<ParsedHistory, HistoryIssue> {
    parse_lines(path, |value, session_id, cwd, messages| {
        if value.get("type").and_then(Value::as_str) == Some("session") {
            *session_id = string_field(value, &["id"]);
            *cwd = string_field(value, &["cwd"]);
        }
        if value.get("type").and_then(Value::as_str) == Some("message") {
            push_message(value.get("message").unwrap_or(value), messages);
        }
    })
}

fn parse_lines(
    path: &Path,
    mut visit: impl FnMut(&Value, &mut Option<String>, &mut Option<String>, &mut Vec<HistoryMessage>),
) -> Result<ParsedHistory, HistoryIssue> {
    let file = fs::File::open(path).map_err(io_issue)?;
    let mut session_id = None;
    let mut cwd = None;
    let mut messages = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            visit(&value, &mut session_id, &mut cwd, &mut messages);
        }
    }
    Ok((session_id, cwd, messages))
}

fn import_grok(
    home: &Path,
    request: &PrepareHistoryRequest,
) -> Result<ImportedHistory, HistoryIssue> {
    let files = collect_named_files(&home.join(".grok/sessions"), "chat_history.jsonl")?;
    let mut candidates = Vec::new();
    for path in files {
        let session_id = path
            .parent()
            .and_then(Path::file_name)
            .map(|value| value.to_string_lossy().into_owned());
        if request
            .provider_session_id
            .as_deref()
            .is_some_and(|id| session_id.as_deref() != Some(id))
        {
            continue;
        }
        let group = path
            .parent()
            .and_then(Path::parent)
            .unwrap_or(Path::new(""));
        let cwd_file = group.join(".cwd");
        let group_cwd = if cwd_file.is_file() {
            fs::read_to_string(&cwd_file).ok()
        } else {
            group
                .file_name()
                .map(|value| percent_decode(&value.to_string_lossy()))
        };
        if group_cwd
            .as_deref()
            .is_some_and(|cwd| !same_path(cwd.trim(), &request.cwd))
        {
            continue;
        }
        let (_, _, messages) = parse_grok_file(&path)?;
        if !messages.is_empty() {
            candidates.push((
                distance(created_ms(&path).unwrap_or_default(), request.started_at),
                created_ms(&path).unwrap_or_default(),
                session_id,
                messages,
            ));
        }
    }
    select_candidate(candidates, request, "grok-jsonl", "Grok conversation")
}

fn import_opencode(
    home: &Path,
    request: &PrepareHistoryRequest,
) -> Result<ImportedHistory, HistoryIssue> {
    let db_path = home.join(".local/share/opencode/opencode.db");
    if !db_path.is_file() {
        return Err(HistoryIssue::Unavailable(
            "OpenCode history database was not found.".into(),
        ));
    }
    let connection =
        Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| HistoryIssue::Malformed(error.to_string()))?;
    let mut statement = connection.prepare("SELECT id,time_created FROM session WHERE lower(replace(directory,'\\','/'))=lower(replace(?1,'\\','/')) ORDER BY abs(time_created-?2), time_updated DESC LIMIT 2").map_err(|error| HistoryIssue::Malformed(error.to_string()))?;
    let rows = statement
        .query_map(params![request.cwd, request.started_at], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| HistoryIssue::Malformed(error.to_string()))?;
    let mut sessions: Vec<(String, i64)> = rows.filter_map(Result::ok).collect();
    if let Some(expected) = request.provider_session_id.as_deref() {
        sessions.retain(|(id, _)| id == expected);
    }
    if sessions.is_empty() {
        return Err(HistoryIssue::Unavailable(
            "No matching OpenCode session was found.".into(),
        ));
    }
    if request.provider_session_id.is_none()
        && sessions.len() > 1
        && distance(sessions[0].1, request.started_at) <= 5_000
        && distance(sessions[1].1, request.started_at) <= 5_000
    {
        return Err(HistoryIssue::Ambiguous(
            "Multiple OpenCode sessions were started at nearly the same time.".into(),
        ));
    }
    let session_id = sessions.remove(0).0;
    let messages = read_opencode_messages(&connection, &session_id)?;
    Ok(ImportedHistory {
        source: "opencode-sqlite".into(),
        source_label: "OpenCode conversation".into(),
        session_id: Some(session_id),
        messages,
    })
}

fn parse_grok_file(path: &Path) -> Result<ParsedHistory, HistoryIssue> {
    parse_lines(path, |value, _, _, messages| push_message(value, messages))
}

fn read_opencode_messages(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<HistoryMessage>, HistoryIssue> {
    let mut messages = Vec::new();
    let mut query = connection.prepare("SELECT m.data,p.data,m.time_created FROM message m LEFT JOIN part p ON p.message_id=m.id WHERE m.session_id=?1 ORDER BY m.time_created,p.time_created").map_err(|error| HistoryIssue::Malformed(error.to_string()))?;
    let parts = query
        .query_map([&session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| HistoryIssue::Malformed(error.to_string()))?;
    for (message_data, part_data, timestamp) in parts.filter_map(Result::ok) {
        let Ok(message) = serde_json::from_str::<Value>(&message_data) else {
            continue;
        };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let Some(part_data) = part_data else { continue };
        let Ok(part) = serde_json::from_str::<Value>(&part_data) else {
            continue;
        };
        if part.get("type").and_then(Value::as_str) == Some("text")
            && let Some(content) = part.get("text").and_then(Value::as_str)
        {
            add_message(&mut messages, role, content, Some(timestamp));
        }
    }
    Ok(messages)
}

fn import_visible(
    app_data_dir: &Path,
    request: &PrepareHistoryRequest,
) -> Result<ImportedHistory, HistoryIssue> {
    let path = transcript_path(app_data_dir, &request.session_id);
    let bytes = fs::read(&path).map_err(io_issue)?;
    let content = strip_terminal_noise(&String::from_utf8_lossy(&bytes));
    if content.trim().is_empty() {
        return Err(HistoryIssue::Unavailable(
            "No CoDes terminal capture is available for this session.".into(),
        ));
    }
    Ok(ImportedHistory {
        source: "codes-visible".into(),
        source_label: "CoDes terminal capture".into(),
        session_id: request.provider_session_id.clone(),
        messages: vec![HistoryMessage {
            role: "visible terminal".into(),
            content,
            timestamp: None,
        }],
    })
}

fn push_message(value: &Value, messages: &mut Vec<HistoryMessage>) {
    let role = value.get("role").and_then(Value::as_str).unwrap_or("");
    let content = content_text(value.get("content").unwrap_or(&Value::Null));
    let timestamp = value
        .get("timestamp")
        .and_then(Value::as_i64)
        .or_else(|| value.get("time").and_then(Value::as_i64));
    add_message(messages, role, &content, timestamp);
}

fn add_message(
    messages: &mut Vec<HistoryMessage>,
    role: &str,
    content: &str,
    timestamp: Option<i64>,
) {
    if !matches!(role, "user" | "assistant")
        || content.trim().is_empty()
        || is_control_content(content)
    {
        return;
    }
    messages.push(HistoryMessage {
        role: role.into(),
        content: content.trim().into(),
        timestamp,
    });
}

fn content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let kind = item.get("type").and_then(Value::as_str).unwrap_or("text");
                if matches!(kind, "text" | "input_text" | "output_text") {
                    item.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn is_control_content(content: &str) -> bool {
    let trimmed = content.trim_start();
    [
        "<environment_context>",
        "<permissions instructions>",
        "<collaboration_mode>",
        "<recommended_plugins>",
        "# AGENTS.md instructions",
        "<oai-mem-citation>",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

fn render_messages(messages: &[HistoryMessage], omitted: usize) -> String {
    let mut sections = Vec::new();
    if omitted > 0 {
        sections.push(format!("[OLDER HISTORY OMITTED: {omitted} message(s)]"));
    }
    for message in messages {
        let timestamp = message
            .timestamp
            .map(|value| format!(" · {value}"))
            .unwrap_or_default();
        sections.push(format!(
            "[{}{}]\n{}",
            message.role.to_uppercase(),
            timestamp,
            message.content.trim()
        ));
    }
    sections.join("\n\n")
}

fn limit_messages(
    mut messages: Vec<HistoryMessage>,
    max_chars: usize,
) -> (Vec<HistoryMessage>, usize) {
    let original = messages.len();
    while messages.len() > 1
        && render_messages(&messages, original - messages.len())
            .chars()
            .count()
            > max_chars
    {
        messages.remove(0);
    }
    let mut omitted = original - messages.len();
    let rendered_chars = render_messages(&messages, omitted).chars().count();
    if rendered_chars > max_chars
        && let Some(first) = messages.first_mut()
    {
        let keep = max_chars.saturating_sub(96);
        first.content = first
            .content
            .chars()
            .rev()
            .take(keep)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        omitted += 1;
    }
    (messages, omitted)
}

fn recent_visible(messages: Vec<HistoryMessage>, turns: usize) -> Vec<HistoryMessage> {
    messages
        .into_iter()
        .map(|mut message| {
            let lines: Vec<&str> = message.content.lines().collect();
            let keep = turns.saturating_mul(12).max(12);
            if lines.len() > keep {
                message.content = lines[lines.len() - keep..].join("\n");
            }
            message
        })
        .collect()
}

fn redact(content: &str) -> (String, usize) {
    let patterns = [
        r"(?i)(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+",
        r#"(?i)((?:api[_-]?key|token|secret|password|cookie)\s*[=:]\s*)[^\s"']+"#,
        r"(?s)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        r"\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b",
    ];
    let mut output = content.to_string();
    let mut count = 0;
    for pattern in patterns {
        let regex = Regex::new(pattern).expect("static redaction regex");
        count += regex.find_iter(&output).count();
        output = regex
            .replace_all(&output, |captures: &regex::Captures<'_>| {
                captures.get(1).map_or_else(
                    || "[REDACTED]".into(),
                    |prefix| format!("{}[REDACTED]", prefix.as_str()),
                )
            })
            .into_owned();
    }
    (output, count)
}

fn strip_terminal_noise(value: &str) -> String {
    let ansi = Regex::new(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[()][A-Z0-9])")
        .expect("static ansi regex");
    let controls = Regex::new(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]").expect("static controls regex");
    let clean = ansi.replace_all(value, "");
    controls
        .replace_all(&clean, "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}

fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str).map(str::to_owned))
}
fn same_path(left: &str, right: &str) -> bool {
    left.replace('\\', "/")
        .trim_end_matches('/')
        .eq_ignore_ascii_case(right.replace('\\', "/").trim_end_matches('/'))
}
fn distance(left: i64, right: i64) -> i64 {
    left.saturating_sub(right).abs()
}
fn created_ms(path: &Path) -> Option<i64> {
    let metadata = path.metadata().ok()?;
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_millis() as i64)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            output.push(byte);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn collect_files(root: &Path, extension: &str) -> Result<Vec<PathBuf>, HistoryIssue> {
    collect_matching(root, &|path| {
        path.extension()
            .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    })
}
fn collect_named_files(root: &Path, name: &str) -> Result<Vec<PathBuf>, HistoryIssue> {
    collect_matching(root, &|path| {
        path.file_name().is_some_and(|value| value == name)
    })
}
fn collect_matching(
    root: &Path,
    predicate: &dyn Fn(&Path) -> bool,
) -> Result<Vec<PathBuf>, HistoryIssue> {
    if !root.is_dir() {
        return Err(HistoryIssue::Unavailable(format!(
            "History directory was not found: {}",
            root.display()
        )));
    }
    let mut output = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(io_issue)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if predicate(&path) {
                output.push(path);
            }
        }
    }
    Ok(output)
}
fn io_issue(error: std::io::Error) -> HistoryIssue {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        HistoryIssue::PermissionDenied(error.to_string())
    } else if error.kind() == std::io::ErrorKind::NotFound {
        HistoryIssue::Unavailable(error.to_string())
    } else {
        HistoryIssue::Malformed(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_jsonl(path: &Path, values: &[Value]) {
        let document = values
            .iter()
            .map(|value| serde_json::to_string(value).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(path, document).unwrap();
    }

    #[test]
    fn redacts_credentials_and_private_keys() {
        let input = "Authorization: Bearer abc123\nAPI_KEY=secret-value\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
        let (output, count) = redact(input);
        assert!(count >= 3);
        assert!(!output.contains("abc123"));
        assert!(!output.contains("secret-value"));
        assert!(!output.contains("\nsecret\n"));
    }

    #[test]
    fn strips_ansi_and_control_sequences() {
        assert_eq!(
            strip_terminal_noise("\x1b[31mHello\x1b[0m\r\nWorld\x07"),
            "Hello\nWorld"
        );
    }

    #[test]
    fn codex_parser_keeps_only_visible_conversation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.jsonl");
        fs::write(&path, concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"cwd\":\"C:\\\\work\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Fix it\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Done\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"role\":\"assistant\",\"content\":[{\"type\":\"reasoning\",\"text\":\"hidden\"}]}}\n"
        )).unwrap();
        let (id, cwd, messages) = parse_codex_file(&path).unwrap();
        assert_eq!(id.as_deref(), Some("s1"));
        assert_eq!(cwd.as_deref(), Some("C:\\work"));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "Fix it");
        assert_eq!(messages[1].content, "Done");
    }

    #[test]
    fn persisted_transcript_is_bounded_to_one_megabyte() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capture.ansi");
        persist_transcript(&path, &vec![b'x'; TRANSCRIPT_LIMIT + 128]).unwrap();
        assert_eq!(fs::metadata(path).unwrap().len(), TRANSCRIPT_LIMIT as u64);
    }

    #[test]
    fn claude_parser_excludes_meta_and_tool_records() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("claude.jsonl");
        write_jsonl(
            &path,
            &[
                serde_json::json!({"sessionId":"claude-1","cwd":"C:\\work","isMeta":true,"message":{"role":"user","content":"hidden setup"}}),
                serde_json::json!({"sessionId":"claude-1","cwd":"C:\\work","message":{"role":"user","content":[{"type":"text","text":"Please continue"},{"type":"tool_result","content":"secret"}]}}),
                serde_json::json!({"message":{"role":"assistant","content":[{"type":"text","text":"Continuing now"},{"type":"tool_use","name":"Bash"}]}}),
            ],
        );
        let (id, cwd, messages) = parse_claude_file(&path).unwrap();
        assert_eq!(id.as_deref(), Some("claude-1"));
        assert_eq!(cwd.as_deref(), Some("C:\\work"));
        assert_eq!(
            messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["Please continue", "Continuing now"]
        );
    }

    #[test]
    fn pi_and_grok_parsers_normalize_visible_messages() {
        let directory = tempfile::tempdir().unwrap();
        let pi = directory.path().join("pi.jsonl");
        write_jsonl(
            &pi,
            &[
                serde_json::json!({"type":"session","id":"pi-1","cwd":"C:\\work"}),
                serde_json::json!({"type":"message","message":{"role":"user","content":"Build it"}}),
                serde_json::json!({"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Built"},{"type":"thinking","text":"hidden"}]}}),
            ],
        );
        let (id, _, messages) = parse_pi_file(&pi).unwrap();
        assert_eq!(id.as_deref(), Some("pi-1"));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].content, "Built");

        let grok = directory.path().join("chat_history.jsonl");
        write_jsonl(
            &grok,
            &[
                serde_json::json!({"role":"user","content":"Inspect"}),
                serde_json::json!({"role":"assistant","content":"Ready"}),
            ],
        );
        let (_, _, messages) = parse_grok_file(&grok).unwrap();
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn opencode_reader_uses_text_parts_only() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT);").unwrap();
        connection
            .execute(
                "INSERT INTO message VALUES('m1','s1',1,?1)",
                [serde_json::json!({"role":"user"}).to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO part VALUES('p1','m1','s1',1,?1)",
                [serde_json::json!({"type":"text","text":"Open it"}).to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO part VALUES('p2','m1','s1',2,?1)",
                [serde_json::json!({"type":"tool","text":"hidden"}).to_string()],
            )
            .unwrap();
        let messages = read_opencode_messages(&connection, "s1").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Open it");
    }

    #[test]
    fn visible_preview_redacts_and_keeps_the_newest_content() {
        let directory = tempfile::tempdir().unwrap();
        let request = PrepareHistoryRequest {
            session_id: "visible-1".into(),
            provider: "antigravity".into(),
            cwd: "C:\\work".into(),
            started_at: 1,
            provider_session_id: None,
            mode: "visible".into(),
            recent_turns: 10,
            max_chars: 1_024,
            redact_secrets: true,
        };
        persist_transcript(
            &transcript_path(directory.path(), &request.session_id),
            format!(
                "old line\nAPI_KEY=secret-value\n{}newest",
                "x".repeat(2_000)
            )
            .as_bytes(),
        )
        .unwrap();
        let preview = prepare_history(directory.path(), &request);
        assert_eq!(preview.status, "ready");
        assert!(preview.redaction_count >= 1);
        assert!(preview.omitted_count >= 1);
        assert!(!preview.content.contains("secret-value"));
        assert!(preview.content.ends_with("newest"));
    }

    #[test]
    fn rejects_ambiguous_sessions_started_together() {
        let request = PrepareHistoryRequest {
            session_id: "s".into(),
            provider: "codex".into(),
            cwd: "C:\\work".into(),
            started_at: 10_000,
            provider_session_id: None,
            mode: "conversation".into(),
            recent_turns: 10,
            max_chars: 64_000,
            redact_secrets: true,
        };
        let message = || {
            vec![HistoryMessage {
                role: "user".into(),
                content: "hello".into(),
                timestamp: None,
            }]
        };
        let result = select_candidate(
            vec![
                (1_000, 9_000, Some("one".into()), message()),
                (2_000, 12_000, Some("two".into()), message()),
            ],
            &request,
            "fixture",
            "fixture history",
        );
        assert!(matches!(result, Err(HistoryIssue::Ambiguous(_))));
    }
}
