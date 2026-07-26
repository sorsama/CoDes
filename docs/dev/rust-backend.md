# Rust Backend

The Rust backend is the core of CoDes, responsible for PTY session management, SQLite persistence, Git operations, provider detection, history parsing, and usage data collection.

## Entry Point

### `main.rs`

```rust
fn main() {
    codes_lib::run();
}
```

The binary entry simply calls `codes_lib::run()`.

### `lib.rs` — `run()` function

Sets up Tauri with:
- SQLite database initialization (WAL mode, migrations)
- AppState registration
- Tauri command handlers
- Plugin registration (notification, updater, etc.)

## AppState

`AppState` is the singleton holding all shared state:

```rust
pub(crate) struct AppState {
    sessions: SessionManager,
    pub(crate) database: Mutex<Connection>,
    app_data_dir: PathBuf,
}
```

- **`sessions`** — manages active PTY sessions
- **`database`** — WAL-backed SQLite connection protected by a Mutex
- **`app_data_dir`** — resolved application data directory

## Session Management

### SessionManager

```rust
#[derive(Default)]
struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
}
```

A thread-safe map of session IDs to active session handles.

### SessionHandle

```rust
struct SessionHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: SharedChild,
    listeners: Arc<Mutex<Vec<Channel<PtyEvent>>>>,
    scrollback: Arc<Mutex<Vec<u8>>>,
}
```

- **`writer`** — stdin writer to the PTY
- **`master`** — PTY master end (for resize operations)
- **`child`** — child process handle (for termination)
- **`listeners`** — Tauri event channels streaming output to the frontend
- **`scrollback`** — captured output buffer

### PTY Lifecycle

1. **Launch** — `launch_session` command creates a PTY via `portable-pty`, spawns the provider CLI, starts a reader thread that forwards output to listeners
2. **Write** — `write_session` command writes stdin bytes to the PTY writer
3. **Resize** — `resize_session` command resizes the PTY dimensions
4. **Stop** — `stop_session` command kills the child process and cleans up the handle

### Binary Output

PTY output is streamed as binary via Tauri channels. The frontend receives raw bytes and renders them through xterm.js, preserving ANSI sequences, colors, and Unicode.

## SQLite Database

### Schema

The database uses WAL journal mode for concurrent read performance. Key tables:

| Table | Purpose |
|---|---|
| `schema_migrations` | Version-tracked migration history |
| `projects` | Project references (id, name, path, color) |
| `sessions` | Session records (provider, status, layout) |
| `tasks` | Kanban tasks (column, tags, linked session) |
| `telemetry` | Usage telemetry data |
| `themes` | Custom theme storage |
| `app_settings` | Application settings |
| `workflows` | Workflow run records |
| `workflow_templates` | Workflow template definitions |

### Migrations

Migrations are version-tracked in `schema_migrations`. Each migration increments the version and is applied in order on startup.

See [Database Schema](database-schema.md) for full table definitions.

## Provider Registry

The `PROVIDERS` constant defines all supported agent CLIs:

```rust
pub(crate) const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec { binary: "codex", label: "Codex", ... },
    ProviderSpec { binary: "claude", label: "Claude Code", ... },
    // ... 9 providers total
];
```

Detection scans `PATH` for each binary on startup. Only detected providers are exposed to the frontend.

## Git Manager

`git_manager.rs` implements the full Git workbench:

### Key Operations

| Operation | Description |
|---|---|
| `diff` | File and hunk diffs against index/HEAD |
| `stage` | Stage files or individual hunks |
| `unstage` | Unstage files or hunks |
| `commit` | Create a commit with message |
| `branch` | List, create, switch, delete branches |
| `stash` | Stash/unstash working changes |
| `tag` | List, create, delete tags |
| `remote` | Add, remove, list remotes |
| `fetch` / `pull` / `push` | Remote synchronization |
| `pr_create` | Create GitHub PR |
| `pr_list` | List open PRs |
| `conflict_resolve` | Help resolve merge conflicts |

### Safety

Git commands use structured arguments inside a validated repository root. Force push, hard reset, and automatic conflict resolution are intentionally unavailable.

## History Parsers

`history.rs` contains per-provider parsers for local conversation history:

| Provider | Parser |
|---|---|
| Codex | Structured session log reader |
| Claude Code | Conversation transcript parser |
| OpenCode | Session transcript reader |
| Grok Build | Run record parser |
| Pi | Conversation data reader |

Parsers handle:
- Reading provider-specific file locations
- Extracting messages, tokens, and metadata
- Redacting likely credentials by default
- Reporting unavailable or malformed data gracefully

## Usage Connectors

`usage.rs` implements data connectors for official usage APIs:

| Connector | Source | Auth |
|---|---|---|
| OpenAI | Usage API | OS credential vault |
| Anthropic | Usage API | OS credential vault |
| GitHub | Copilot API | GitHub token |
| Google | Vertex AI API | Service account |

Connectors are optional and run only when the user configures authentication.

## Key Dependencies

| Crate | Purpose |
|---|---|
| `tauri` 2 | Desktop app framework |
| `portable-pty` | Cross-platform PTY creation |
| `rusqlite` | SQLite with WAL mode |
| `reqwest` | HTTP client (API connectors) |
| `keyring` | OS credential vault access |
| `serde` / `serde_json` | Serialization |
| `uuid` | Unique ID generation |
| `chrono` | Date/time handling |
| `regex` | Pattern matching |
| `walkdir` | Directory traversal |

## See Also

- [Architecture](architecture.md) — high-level system design
- [Database Schema](database-schema.md) — SQLite table definitions
- [IPC Commands](ipc-commands.md) — Tauri command reference
- [Adding a Provider](adding-a-provider.md) — extend the provider registry
