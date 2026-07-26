# Database Schema

CoDes uses a WAL-backed SQLite database for persistent state. The database is created automatically on first launch at the platform-specific application data directory.

## Connection

- **Journal mode**: WAL (Write-Ahead Logging) for concurrent read performance
- **Foreign keys**: Enforced (`PRAGMA foreign_keys=ON`)
- **Migrations**: Version-tracked via `schema_migrations` table

## Migration System

```sql
CREATE TABLE IF NOT EXISTS schema_migrations(
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
```

Each migration is a numbered version. On startup, CoDes reads the latest applied version and runs any pending migrations in order.

## Tables

### `projects`

Tracks project references (your files stay on disk).

```sql
CREATE TABLE IF NOT EXISTS projects(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    last_opened_at INTEGER NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT | Human-readable project name |
| `path` | TEXT UNIQUE | Absolute path to the project directory |
| `color` | TEXT | Display color (HEX or OKLCH) |
| `last_opened_at` | INTEGER | Unix timestamp of last access |

### `sessions`

Records of launched PTY sessions.

```sql
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
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `project_id` | TEXT FK → projects | Parent project |
| `title` | TEXT | Session display title |
| `provider` | TEXT | Provider identifier (e.g., "codex", "claude") |
| `status` | TEXT | Current status: waiting, working, input_required, completed, failed, disconnected |
| `cwd` | TEXT | Working directory at launch |
| `resume_id` | TEXT | Provider-specific resume identifier (nullable) |
| `layout_json` | TEXT | JSON-encoded layout state (pane position, size) |
| `created_at` | INTEGER | Unix timestamp of creation |

### `tasks`

Kanban board tasks.

```sql
CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    column_id TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    provider TEXT,
    mode TEXT,
    model TEXT,
    autonomous INTEGER NOT NULL DEFAULT 0,
    execution_kind TEXT DEFAULT 'single',
    workflow_template_id TEXT,
    workflow_run_id TEXT,
    workflow_overrides_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `project_id` | TEXT FK → projects | Parent project |
| `title` | TEXT | Task title |
| `description` | TEXT | Detailed description |
| `column_id` | TEXT | Board column: backlog, ready, working, done |
| `tags_json` | TEXT | JSON array of tag strings |
| `position` | INTEGER | Sort position within the column |
| `session_id` | TEXT | Linked session ID (nullable) |
| `provider` | TEXT | Provider override for task execution |
| `mode` | TEXT | Session mode override |
| `model` | TEXT | Model override |
| `autonomous` | INTEGER | Boolean: enable Autopilot for this task |
| `execution_kind` | TEXT | `single` or `workflow` |
| `workflow_template_id` | TEXT | Workflow template reference |
| `workflow_run_id` | TEXT | Active workflow run reference |
| `workflow_overrides_json` | TEXT | JSON: per-stage overrides |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Last modification timestamp |

### `telemetry`

Usage telemetry data from provider sessions.

```sql
CREATE TABLE IF NOT EXISTS telemetry(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_tokens INTEGER,
    cost_amount REAL,
    cost_currency TEXT DEFAULT 'USD',
    source TEXT NOT NULL DEFAULT 'local',
    captured_at INTEGER NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `session_id` | TEXT FK → sessions | Source session |
| `provider` | TEXT | Provider identifier |
| `input_tokens` | INTEGER | Input token count |
| `output_tokens` | INTEGER | Output token count |
| `cached_tokens` | INTEGER | Cached/context tokens |
| `reasoning_tokens` | INTEGER | Reasoning tokens (if reported) |
| `total_tokens` | INTEGER | Total token count |
| `cost_amount` | REAL | Estimated or official cost |
| `cost_currency` | TEXT | Currency code (default USD) |
| `source` | TEXT | `local` (parsed) or `api` (official connector) |
| `captured_at` | INTEGER | Unix timestamp |

### `themes`

Custom theme storage.

```sql
CREATE TABLE IF NOT EXISTS themes(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'dark',
    version INTEGER NOT NULL DEFAULT 1,
    built_in INTEGER NOT NULL DEFAULT 0,
    tokens_json TEXT NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Theme identifier |
| `name` | TEXT | Display name |
| `mode` | TEXT | `dark` or `light` |
| `version` | INTEGER | Schema version for migration |
| `built_in` | INTEGER | Boolean: 1 for built-in themes (read-only) |
| `tokens_json` | TEXT | JSON: semantic token values |

### `app_settings`

Application-wide settings stored as key-value pairs.

```sql
CREATE TABLE IF NOT EXISTS app_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | Setting name |
| `value` | TEXT | JSON-encoded value |

### `workflows`

Workflow run records.

```sql
CREATE TABLE IF NOT EXISTS workflows(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage_runs_json TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `project_id` | TEXT FK → projects | Parent project |
| `template_id` | TEXT | Workflow template identifier |
| `status` | TEXT | queued, preflight, running, waiting_input, repairing, passed, failed, paused, cancelled |
| `stage_runs_json` | TEXT | JSON array of stage run records |
| `started_at` | INTEGER | Unix timestamp |
| `completed_at` | INTEGER | Unix timestamp |
| `created_at` | INTEGER | Unix timestamp |

### `workflow_templates`

Reusable workflow template definitions.

```sql
CREATE TABLE IF NOT EXISTS workflow_templates(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    stages_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 or well-known ID |
| `name` | TEXT | Template name |
| `description` | TEXT | Description |
| `stages_json` | TEXT | JSON array of stage definitions (provider, model, mode, prompt, timeout, retries, etc.) |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

## Entity Relationships

```
projects ──┬── sessions
           ├── tasks
           ├── telemetry (via session)
           └── workflows

sessions ──┬── telemetry
           └── tasks (via session_id, nullable)

workflow_templates ──── workflows (via template_id)

themes ──── (standalone, referenced by app_settings)

app_settings ──── (standalone, key-value store)
```

## See Also

- [Rust Backend](rust-backend.md) — database initialization and migration
- [IPC Commands](ipc-commands.md) — commands that read/write these tables
