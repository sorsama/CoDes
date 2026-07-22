mod history;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, ipc::Channel};

type SharedChild = Arc<Mutex<Box<dyn Child + Send + Sync>>>;

struct SessionHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: SharedChild,
    listeners: Arc<Mutex<Vec<Channel<PtyEvent>>>>,
    scrollback: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default)]
struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
}

struct AppState {
    sessions: SessionManager,
    database: Mutex<Connection>,
    app_data_dir: PathBuf,
}

impl AppState {
    fn new(database_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA foreign_keys=ON;
                 CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                 INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
                 CREATE TABLE IF NOT EXISTS projects(
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   path TEXT NOT NULL UNIQUE,
                   color TEXT NOT NULL,
                   last_opened_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS sessions(
                   id TEXT PRIMARY KEY,
                   project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                   title TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   status TEXT NOT NULL,
                   cwd TEXT NOT NULL,
                   resume_id TEXT,
                   layout_json TEXT NOT NULL DEFAULT '{}',
                   created_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS tasks(
                   id TEXT PRIMARY KEY,
                   project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                   title TEXT NOT NULL,
                   description TEXT NOT NULL DEFAULT '',
                   column_id TEXT NOT NULL,
                   tags_json TEXT NOT NULL DEFAULT '[]',
                   session_id TEXT,
                   position INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE IF NOT EXISTS telemetry_events(
                   id TEXT PRIMARY KEY,
                   session_id TEXT NOT NULL,
                   event_type TEXT NOT NULL,
                   payload_json TEXT NOT NULL,
                   occurred_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS themes(
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   version INTEGER NOT NULL,
                   document_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 UPDATE sessions SET provider = 'antigravity' WHERE provider = 'gemini';
                 INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
                 CREATE TABLE IF NOT EXISTS app_settings(
                   key TEXT PRIMARY KEY,
                   value_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS workspace_state(
                   id INTEGER PRIMARY KEY CHECK(id = 1),
                   snapshot_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            sessions: SessionManager::default(),
            database: Mutex::new(connection),
            app_data_dir: database_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf(),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSessionRequest {
    session_id: String,
    provider: String,
    cwd: String,
    resume_id: Option<String>,
    mode: Option<String>,
    model: Option<String>,
    initial_prompt: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "event",
    content = "data"
)]
enum PtyEvent {
    Output { bytes: Vec<u8> },
    Exit { code: Option<u32> },
    Error { message: String },
}

#[cfg(target_os = "windows")]
fn codex_executable() -> PathBuf {
    if let Some(app_data) = env::var_os("APPDATA") {
        let package_root = PathBuf::from(app_data)
            .join("npm")
            .join("node_modules")
            .join("@openai")
            .join("codex");
        let candidates = [
            package_root
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe"),
            package_root
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe"),
        ];
        if let Some(candidate) = candidates.into_iter().find(|path| path.is_file()) {
            return candidate;
        }
    }

    if let Some(path) = env::var_os("PATH")
        && let Some(candidate) = env::split_paths(&path)
            .map(|directory| directory.join("codex.exe"))
            .find(|path| path.is_file())
    {
        return candidate;
    }

    PathBuf::from("codex.exe")
}

#[cfg(not(target_os = "windows"))]
fn codex_executable() -> PathBuf {
    PathBuf::from("codex")
}

#[cfg(target_os = "windows")]
fn antigravity_executable() -> PathBuf {
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data)
            .join("agy")
            .join("bin")
            .join("agy.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    if let Some(path) = env::var_os("PATH")
        && let Some(candidate) = env::split_paths(&path)
            .map(|directory| directory.join("agy.exe"))
            .find(|path| path.is_file())
    {
        return candidate;
    }

    PathBuf::from("agy.exe")
}

#[cfg(not(target_os = "windows"))]
fn antigravity_executable() -> PathBuf {
    PathBuf::from("agy")
}

/// How a provider translates a stored session `resume_id` into CLI arguments.
enum ResumeMode {
    /// Positional subcommand, e.g. codex: `resume <id>`.
    SubcommandPositional(&'static str),
    /// Flag that takes the id, e.g. `--resume <id>`, `--session <id>`, `--conversation <id>`.
    FlagWithId(&'static str),
    /// Boolean flag with no id (continue-last semantics), e.g. aider `--restore-chat-history`.
    FlagOnly(&'static str),
}

/// How a provider's executable is located.
enum Binary {
    /// Resolved through PATH and common per-user install directories.
    Named(&'static str),
    /// Bespoke resolver for vendored / non-PATH installs (codex, antigravity).
    Resolved(fn() -> PathBuf),
}

struct ResolvedBinary {
    program: PathBuf,
    prefix_args: Vec<OsString>,
}

impl ResolvedBinary {
    fn direct(program: PathBuf) -> Self {
        Self {
            program,
            prefix_args: Vec::new(),
        }
    }

    fn command_builder(&self) -> CommandBuilder {
        let mut command = CommandBuilder::new(&self.program);
        command.args(&self.prefix_args);
        command
    }

    fn std_command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        command
    }
}

#[cfg(target_os = "windows")]
fn windows_command_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(app_data) = env::var_os("APPDATA") {
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        let user_profile = PathBuf::from(user_profile);
        directories.push(user_profile.join(".local").join("bin"));
        directories.push(user_profile.join(".bun").join("bin"));
        directories.push(user_profile.join(".grok").join("bin"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        directories.push(PathBuf::from(local_app_data).join("agy").join("bin"));
    }
    if let Some(path) = env::var_os("PATH") {
        directories.extend(env::split_paths(&path));
    }
    directories.dedup();
    directories
}

#[cfg(target_os = "windows")]
fn resolve_windows_named_from(name: &str, directories: &[PathBuf]) -> ResolvedBinary {
    // Search every directory for a native binary before considering command scripts. npm
    // installs extensionless POSIX shims beside .cmd launchers; handing one of those to
    // CreateProcessW produces os error 193.
    for extension in ["exe", "com"] {
        if let Some(candidate) = directories
            .iter()
            .map(|directory| directory.join(name).with_extension(extension))
            .find(|path| path.is_file())
        {
            return ResolvedBinary::direct(candidate);
        }
    }

    for extension in ["cmd", "bat"] {
        if let Some(script) = directories
            .iter()
            .map(|directory| directory.join(name).with_extension(extension))
            .find(|path| path.is_file())
        {
            let command_processor = env::var_os("COMSPEC")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("cmd.exe"));
            return ResolvedBinary {
                program: command_processor,
                prefix_args: vec![
                    "/D".into(),
                    "/S".into(),
                    "/C".into(),
                    script.into_os_string(),
                ],
            };
        }
    }

    // Keep the missing-tool error deterministic and never fall back to an extensionless shim.
    ResolvedBinary::direct(PathBuf::from(format!("{name}.exe")))
}

#[cfg(target_os = "windows")]
fn resolve_named_binary(name: &str) -> ResolvedBinary {
    resolve_windows_named_from(name, &windows_command_directories())
}

#[cfg(not(target_os = "windows"))]
fn resolve_named_binary(name: &str) -> ResolvedBinary {
    ResolvedBinary::direct(PathBuf::from(name))
}

impl Binary {
    fn resolve(&self) -> ResolvedBinary {
        match self {
            Binary::Named(name) => resolve_named_binary(name),
            Binary::Resolved(resolver) => ResolvedBinary::direct(resolver()),
        }
    }
}

/// Launch/detection specification for one agent provider CLI.
struct ProviderSpec {
    id: &'static str,
    binary: Binary,
    base_args: &'static [&'static str],
    resume: ResumeMode,
    autonomous: AutonomousMode,
    model_arg: Option<&'static str>,
}

/// Provider-specific non-interactive entry point used by autonomous board tasks.
enum AutonomousMode {
    Subcommand(&'static str),
    Flag(&'static str),
    FlagWithPrompt(&'static str),
    Positional,
}

/// Single source of truth for supported agent providers.
/// Adding a new provider is a single entry here (plus one TS entry in `src/lib/providers.ts`).
const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        id: "codex",
        binary: Binary::Resolved(codex_executable),
        base_args: &[],
        resume: ResumeMode::SubcommandPositional("resume"),
        autonomous: AutonomousMode::Subcommand("exec"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "claude",
        binary: Binary::Named("claude"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--resume"),
        autonomous: AutonomousMode::Flag("--print"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "antigravity",
        binary: Binary::Resolved(antigravity_executable),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--conversation"),
        autonomous: AutonomousMode::Flag("--print"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "opencode",
        binary: Binary::Named("opencode"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--session"),
        autonomous: AutonomousMode::Subcommand("run"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "reasonix",
        binary: Binary::Named("reasonix"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--resume"),
        autonomous: AutonomousMode::Positional,
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "grok",
        binary: Binary::Named("grok"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--resume"),
        autonomous: AutonomousMode::FlagWithPrompt("--single"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "qwen",
        binary: Binary::Named("qwen"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--resume"),
        autonomous: AutonomousMode::FlagWithPrompt("--prompt"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "aider",
        binary: Binary::Named("aider"),
        base_args: &[],
        resume: ResumeMode::FlagOnly("--restore-chat-history"),
        autonomous: AutonomousMode::FlagWithPrompt("--message"),
        model_arg: Some("--model"),
    },
    ProviderSpec {
        id: "pi",
        binary: Binary::Named("pi"),
        base_args: &[],
        resume: ResumeMode::FlagWithId("--session"),
        autonomous: AutonomousMode::Flag("--print"),
        model_arg: Some("--model"),
    },
];

fn find_provider(id: &str) -> Option<&'static ProviderSpec> {
    PROVIDERS.iter().find(|spec| spec.id == id)
}

fn sanitize_provider_environment(command: &mut CommandBuilder) {
    const CODEX_CONTROL_ENV: [&str; 5] = [
        "CODEX_CI",
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
        "CODEX_PERMISSION_PROFILE",
        "CODEX_SHELL",
        "CODEX_THREAD_ID",
    ];

    for key in CODEX_CONTROL_ENV {
        command.env_remove(key);
    }
    for (key, _) in env::vars_os() {
        if key
            .to_str()
            .is_some_and(|name| name.starts_with("CODEX_") && name != "CODEX_HOME")
        {
            command.env_remove(key);
        }
    }
}

fn provider_command(request: &StartSessionRequest) -> Result<CommandBuilder, String> {
    let spec = find_provider(&request.provider)
        .ok_or_else(|| format!("unsupported provider: {}", request.provider))?;
    let mut command = spec.binary.resolve().command_builder();
    let autonomous_prompt = request
        .initial_prompt
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if autonomous_prompt.is_some() {
        match spec.autonomous {
            AutonomousMode::Subcommand(subcommand) => command.arg(subcommand),
            AutonomousMode::Flag(flag) => command.arg(flag),
            AutonomousMode::FlagWithPrompt(_) | AutonomousMode::Positional => {}
        };
    } else if let Some(resume_id) = &request.resume_id {
        match spec.resume {
            ResumeMode::SubcommandPositional(subcommand) => {
                command.arg(subcommand);
                command.arg(resume_id);
            }
            ResumeMode::FlagWithId(flag) => {
                command.arg(flag);
                command.arg(resume_id);
            }
            ResumeMode::FlagOnly(flag) => {
                command.arg(flag);
            }
        }
    }
    for arg in spec.base_args {
        command.arg(arg);
    }
    if let Some(model) = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        && let Some(flag) = spec.model_arg
    {
        command.arg(flag);
        command.arg(model.trim());
    }
    match request.mode.as_deref().unwrap_or("interactive") {
        "interactive" => {}
        "plan" => match request.provider.as_str() {
            "codex" => {
                command.args(["--sandbox", "read-only"]);
            }
            "claude" | "grok" => {
                command.args(["--permission-mode", "plan"]);
            }
            "antigravity" => {
                command.args(["--mode", "plan"]);
            }
            _ => {}
        },
        "auto" => match request.provider.as_str() {
            "codex" => {
                command.args([
                    "--sandbox",
                    "workspace-write",
                    "--ask-for-approval",
                    "on-request",
                ]);
            }
            "claude" => {
                command.args(["--permission-mode", "acceptEdits"]);
            }
            "antigravity" => {
                command.args(["--mode", "accept-edits"]);
            }
            "opencode" => {
                command.arg("--auto");
            }
            "grok" => {
                command.args(["--permission-mode", "auto"]);
            }
            _ => {}
        },
        "full_access" => match request.provider.as_str() {
            "codex" => {
                command.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            "claude" => {
                command.arg("--dangerously-skip-permissions");
            }
            "antigravity" => {
                command.arg("--dangerously-skip-permissions");
            }
            "opencode" => {
                command.arg("--auto");
            }
            "grok" => {
                command.args(["--permission-mode", "bypassPermissions"]);
            }
            _ => {}
        },
        mode => return Err(format!("unsupported session mode: {mode}")),
    }
    if let Some(prompt) = autonomous_prompt {
        if let AutonomousMode::FlagWithPrompt(flag) = spec.autonomous {
            command.arg(flag);
        }
        command.arg(prompt);
    }
    sanitize_provider_environment(&mut command);
    command.cwd(&request.cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    Ok(command)
}

#[tauri::command]
fn start_session(
    request: StartSessionRequest,
    on_event: Channel<PtyEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(existing) = state.sessions.sessions.lock().get_mut(&request.session_id) {
        existing.listeners.lock().push(on_event);
        return Ok(());
    }
    if !PathBuf::from(&request.cwd).is_dir() {
        return Err(format!("working directory does not exist: {}", request.cwd));
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: request.rows.unwrap_or(32).max(2),
            cols: request.cols.unwrap_or(120).max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let command = provider_command(&request)?;
    let transcript_path = history::transcript_path(&state.app_data_dir, &request.session_id);
    let previous_transcript = fs::read(&transcript_path).unwrap_or_default();
    if !previous_transcript.is_empty() {
        let _ = on_event.send(PtyEvent::Output {
            bytes: previous_transcript.clone(),
        });
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let child: SharedChild = Arc::new(Mutex::new(child));
    let listeners = Arc::new(Mutex::new(vec![on_event]));
    let scrollback = Arc::new(Mutex::new(previous_transcript));
    state.sessions.sessions.lock().insert(
        request.session_id.clone(),
        SessionHandle {
            writer,
            master: pair.master,
            child: child.clone(),
            listeners: listeners.clone(),
            scrollback: scrollback.clone(),
        },
    );
    let read_listeners = listeners.clone();
    let read_scrollback = scrollback.clone();
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        let mut last_persisted = Instant::now() - Duration::from_millis(750);
        let mut pending_bytes = 0_usize;
        loop {
            match std::io::Read::read(&mut reader, &mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let bytes = buffer[..count].to_vec();
                    {
                        let mut history = read_scrollback.lock();
                        history.extend_from_slice(&bytes);
                        if history.len() > 1_048_576 {
                            let drain = history.len() - 1_048_576;
                            history.drain(..drain);
                        }
                        pending_bytes += count;
                        if pending_bytes >= 64 * 1024
                            || last_persisted.elapsed() >= Duration::from_millis(750)
                        {
                            let _ = history::persist_transcript(&transcript_path, &history);
                            pending_bytes = 0;
                            last_persisted = Instant::now();
                        }
                    }
                    read_listeners.lock().retain(|channel| {
                        channel
                            .send(PtyEvent::Output {
                                bytes: bytes.clone(),
                            })
                            .is_ok()
                    });
                }
                Err(error) => {
                    let message = error.to_string();
                    read_listeners.lock().retain(|channel| {
                        channel
                            .send(PtyEvent::Error {
                                message: message.clone(),
                            })
                            .is_ok()
                    });
                    break;
                }
            }
        }
        let history = read_scrollback.lock();
        let _ = history::persist_transcript(&transcript_path, &history);
    });
    let watch_child = child.clone();
    let watch_listeners = listeners;
    let sessions = state.sessions.sessions.clone();
    let session_id = request.session_id;
    thread::spawn(move || {
        loop {
            match watch_child.lock().try_wait() {
                Ok(Some(status)) => {
                    let code = Some(status.exit_code());
                    watch_listeners
                        .lock()
                        .retain(|channel| channel.send(PtyEvent::Exit { code }).is_ok());
                    let mut sessions = sessions.lock();
                    if sessions
                        .get(&session_id)
                        .is_some_and(|session| Arc::ptr_eq(&session.child, &watch_child))
                    {
                        sessions.remove(&session_id);
                    }
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(250)),
                Err(error) => {
                    let message = error.to_string();
                    watch_listeners.lock().retain(|channel| {
                        channel
                            .send(PtyEvent::Error {
                                message: message.clone(),
                            })
                            .is_ok()
                    });
                    let mut sessions = sessions.lock();
                    if sessions
                        .get(&session_id)
                        .is_some_and(|session| Arc::ptr_eq(&session.child, &watch_child))
                    {
                        sessions.remove(&session_id);
                    }
                    break;
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn attach_session(
    session_id: String,
    on_event: Channel<PtyEvent>,
    state: State<'_, AppState>,
) -> bool {
    let mut sessions = state.sessions.sessions.lock();
    let Some(session) = sessions.get_mut(&session_id) else {
        return false;
    };
    let history = session.scrollback.lock().clone();
    if !history.is_empty() {
        let _ = on_event.send(PtyEvent::Output { bytes: history });
    }
    session.listeners.lock().push(on_event);
    true
}

#[tauri::command]
fn write_session(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.sessions.lock();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session is not running".to_string())?;
    session
        .writer
        .write_all(&data)
        .and_then(|_| session.writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_session(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.sessions.lock();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "session is not running".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(session) = state.sessions.sessions.lock().remove(&session_id) {
        session
            .child
            .lock()
            .kill()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn prepare_handoff_history(
    request: history::PrepareHistoryRequest,
    state: State<'_, AppState>,
) -> history::HistoryPreview {
    history::prepare_history(&state.app_data_dir, &request)
}

#[tauri::command]
fn delete_session_transcript(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    history::remove_transcript(&state.app_data_dir, &session_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    provider: String,
    installed: bool,
    version: Option<String>,
    authenticated: Option<bool>,
}

fn tool_status(provider: &str, binary: ResolvedBinary) -> ToolStatus {
    let result = binary.std_command().arg("--version").output();
    match result {
        Ok(output) if output.status.success() => ToolStatus {
            provider: provider.to_string(),
            installed: true,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            authenticated: None,
        },
        _ => ToolStatus {
            provider: provider.to_string(),
            installed: false,
            version: None,
            authenticated: None,
        },
    }
}

#[tauri::command]
fn detect_tools() -> Vec<ToolStatus> {
    let mut tools: Vec<ToolStatus> = PROVIDERS
        .iter()
        .map(|spec| tool_status(spec.id, spec.binary.resolve()))
        .collect();
    tools.push(tool_status("github", resolve_named_binary("gh")));
    tools
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRecord {
    id: String,
    name: String,
    path: String,
    color: String,
    last_opened_at: i64,
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectRecord>, String> {
    let connection = state.database.lock();
    let mut statement = connection
        .prepare(
            "SELECT id,name,path,color,last_opened_at FROM projects ORDER BY last_opened_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let records = statement
        .query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    records
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(project: ProjectRecord, state: State<'_, AppState>) -> Result<(), String> {
    state.database.lock().execute(
        "INSERT INTO projects(id,name,path,color,last_opened_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,color=excluded.color,last_opened_at=excluded.last_opened_at",
        params![project.id, project.name, project.path, project.color, project.last_opened_at],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    let connection = state.database.lock();
    let result = connection.query_row(
        "SELECT snapshot_json FROM workspace_state WHERE id = 1",
        [],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_workspace(snapshot: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    let json = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
    state.database.lock().execute(
        "INSERT INTO workspace_state(id,snapshot_json,updated_at) VALUES (1,?1,unixepoch('now') * 1000) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at",
        params![json],
    ).map(|_| ()).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryCommit {
    hash: String,
    subject: String,
    author: String,
    timestamp: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestSummary {
    number: u64,
    title: String,
    url: String,
    state: String,
    checks: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryOverview {
    is_repository: bool,
    branch: Option<String>,
    dirty: Option<bool>,
    ahead: Option<i64>,
    behind: Option<i64>,
    remote: Option<String>,
    commits: Vec<RepositoryCommit>,
    pull_requests: Vec<PullRequestSummary>,
    github_authenticated: bool,
    error: Option<String>,
}

fn command_text(program: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn inspect_repository(path: String) -> RepositoryOverview {
    let cwd = PathBuf::from(path);
    let empty = || RepositoryOverview {
        is_repository: false,
        branch: None,
        dirty: None,
        ahead: None,
        behind: None,
        remote: None,
        commits: vec![],
        pull_requests: vec![],
        github_authenticated: false,
        error: None,
    };
    if command_text("git", &["rev-parse", "--is-inside-work-tree"], &cwd)
        .ok()
        .as_deref()
        != Some("true")
    {
        return empty();
    }
    let branch = command_text("git", &["branch", "--show-current"], &cwd).ok();
    let dirty = command_text("git", &["status", "--porcelain"], &cwd)
        .ok()
        .map(|v| !v.is_empty());
    let remote = command_text("git", &["remote", "get-url", "origin"], &cwd).ok();
    let counts = command_text(
        "git",
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        &cwd,
    )
    .ok();
    let (behind, ahead) = counts
        .as_deref()
        .and_then(|value| {
            let mut parts = value.split_whitespace();
            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
        })
        .unwrap_or((0, 0));
    let commits = command_text(
        "git",
        &["log", "-5", "--format=%h%x1f%s%x1f%an%x1f%ct"],
        &cwd,
    )
    .unwrap_or_default()
    .lines()
    .filter_map(|line| {
        let mut p = line.split('\u{1f}');
        Some(RepositoryCommit {
            hash: p.next()?.into(),
            subject: p.next()?.into(),
            author: p.next()?.into(),
            timestamp: p.next()?.parse::<i64>().ok()? * 1000,
        })
    })
    .collect();
    let github_authenticated = Command::new("gh")
        .args(["auth", "status"])
        .current_dir(&cwd)
        .output()
        .is_ok_and(|o| o.status.success());
    let pull_requests = if github_authenticated {
        command_text(
            "gh",
            &[
                "pr",
                "list",
                "--limit",
                "5",
                "--json",
                "number,title,url,state,statusCheckRollup",
            ],
            &cwd,
        )
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<serde_json::Value>>(&json).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            Some(PullRequestSummary {
                number: item.get("number")?.as_u64()?,
                title: item.get("title")?.as_str()?.into(),
                url: item.get("url")?.as_str()?.into(),
                state: item.get("state")?.as_str()?.into(),
                checks: item
                    .get("statusCheckRollup")
                    .and_then(|v| v.as_array())
                    .map(|v| format!("{} checks", v.len()))
                    .unwrap_or_else(|| "No checks".into()),
            })
        })
        .collect()
    } else {
        vec![]
    };
    RepositoryOverview {
        is_repository: true,
        branch,
        dirty,
        ahead: Some(ahead),
        behind: Some(behind),
        remote,
        commits,
        pull_requests,
        github_authenticated,
        error: None,
    }
}

#[tauri::command]
fn browser_control(
    label: String,
    action: String,
    url: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    if !label.starts_with("browser-") {
        return Err("invalid browser label".into());
    }
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser preview is not available".to_string())?;
    match action.as_str() {
        "navigate" => {
            let raw = url.ok_or_else(|| "navigation URL is required".to_string())?;
            let target = tauri::Url::parse(&raw).map_err(|error| error.to_string())?;
            if !matches!(target.scheme(), "http" | "https") {
                return Err("only HTTP and HTTPS previews are supported".into());
            }
            webview.navigate(target).map_err(|error| error.to_string())
        }
        "back" => webview
            .eval("window.history.back()")
            .map_err(|error| error.to_string()),
        "forward" => webview
            .eval("window.history.forward()")
            .map_err(|error| error.to_string()),
        "reload" => webview.reload().map_err(|error| error.to_string()),
        _ => Err("unsupported browser action".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let database_path = app.path().app_local_data_dir()?.join("codes.db");
            let state = AppState::new(database_path).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            attach_session,
            write_session,
            resize_session,
            stop_session,
            prepare_handoff_history,
            delete_session_transcript,
            detect_tools,
            list_projects,
            save_project,
            load_workspace,
            save_workspace,
            inspect_repository,
            browser_control
        ])
        .run(tauri::generate_context!())
        .expect("error while running CoDes");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_versioned_database() {
        let directory = tempfile::tempdir().expect("temp directory");
        let state = AppState::new(directory.path().join("codes.db")).expect("database");
        let version: i64 = state
            .database
            .lock()
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration version");
        assert_eq!(version, 3);
    }

    #[test]
    fn persists_workspace_snapshot_document() {
        let directory = tempfile::tempdir().expect("temp directory");
        let state = AppState::new(directory.path().join("codes.db")).expect("database");
        let document =
            serde_json::json!({ "projects": [], "settings": { "restoreWorkspace": true } });
        let json = serde_json::to_string(&document).expect("snapshot json");
        state
            .database
            .lock()
            .execute(
                "INSERT INTO workspace_state(id,snapshot_json,updated_at) VALUES (1,?1,1)",
                params![json],
            )
            .expect("save snapshot");
        let stored: String = state
            .database
            .lock()
            .query_row(
                "SELECT snapshot_json FROM workspace_state WHERE id=1",
                [],
                |row| row.get(0),
            )
            .expect("load snapshot");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored).expect("parse snapshot"),
            document
        );
    }

    #[test]
    fn provider_command_rejects_unknown_provider() {
        let request = StartSessionRequest {
            session_id: "test".into(),
            provider: "unknown".into(),
            cwd: ".".into(),
            resume_id: None,
            mode: None,
            model: None,
            initial_prompt: None,
            cols: None,
            rows: None,
        };
        assert!(provider_command(&request).is_err());
    }

    #[test]
    fn provider_command_supports_every_registered_provider() {
        for spec in PROVIDERS {
            let request = StartSessionRequest {
                session_id: "test".into(),
                provider: spec.id.into(),
                cwd: ".".into(),
                resume_id: Some("session-id".into()),
                mode: None,
                model: None,
                initial_prompt: None,
                cols: Some(80),
                rows: Some(24),
            };
            assert!(
                provider_command(&request).is_ok(),
                "{} adapter should build",
                spec.id
            );
        }
    }

    #[test]
    fn codex_uses_full_screen_terminal_rendering() {
        let spec = find_provider("codex").expect("codex provider");

        assert!(!spec.base_args.contains(&"--no-alt-screen"));
    }

    #[test]
    fn detect_tools_reports_one_entry_per_provider() {
        assert_eq!(detect_tools().len(), PROVIDERS.len() + 1);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_provider_resolution_ignores_extensionless_shims() {
        let directory = tempfile::tempdir().expect("temp directory");
        fs::write(directory.path().join("agent"), "#!/bin/sh").expect("posix shim");
        fs::write(directory.path().join("agent.exe"), b"").expect("native binary");

        let resolved = resolve_windows_named_from("agent", &[directory.path().to_path_buf()]);

        assert_eq!(resolved.program, directory.path().join("agent.exe"));
        assert!(resolved.prefix_args.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_provider_resolution_wraps_command_scripts() {
        let directory = tempfile::tempdir().expect("temp directory");
        let script = directory.path().join("agent.cmd");
        fs::write(&script, "@echo off\r\n").expect("command shim");

        let resolved = resolve_windows_named_from("agent", &[directory.path().to_path_buf()]);

        assert_eq!(
            resolved.program,
            env::var_os("COMSPEC")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("cmd.exe"))
        );
        assert_eq!(
            resolved.prefix_args,
            vec![
                OsString::from("/D"),
                OsString::from("/S"),
                OsString::from("/C"),
                script.into_os_string(),
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn every_detected_provider_launcher_spawns_in_a_windows_pty() {
        for spec in PROVIDERS {
            let resolved = spec.binary.resolve();
            let detected = resolved
                .std_command()
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success());
            if !detected {
                continue;
            }

            let mut command = resolved.command_builder();
            command.arg("--version");
            let pair = native_pty_system()
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("open Windows PTY");
            let mut child = pair.slave.spawn_command(command).unwrap_or_else(|error| {
                panic!("{} should launch in a Windows PTY: {error}", spec.id)
            });
            drop(pair.slave);
            // Spawning is the boundary under test: CreateProcessW must receive a real Win32
            // executable, not an extensionless npm shim. Some CLIs intentionally remain
            // interactive even for --version once attached to a PTY, so do not wait on them.
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    #[test]
    fn provider_environment_does_not_inherit_codex_control_state() {
        let mut command = CommandBuilder::new("codex");
        command.env("CODEX_CI", "1");
        command.env("CODEX_SHELL", "1");
        command.env("CODEX_HOME", "test-home");

        sanitize_provider_environment(&mut command);

        assert_eq!(command.get_env("CODEX_CI"), None);
        assert_eq!(command.get_env("CODEX_SHELL"), None);
        assert_eq!(
            command
                .get_env("CODEX_HOME")
                .and_then(|value| value.to_str()),
            Some("test-home")
        );
    }
}
