# IPC Commands

CoDes uses Tauri's IPC mechanism for frontend-backend communication. Commands are defined as Rust functions with the `#[tauri::command]` attribute and invoked from TypeScript via `@tauri-apps/api/core`'s `invoke()`.

## Command Categories

### Session Management

| Command | Signature | Description |
|---|---|---|
| `launch_session` | `(app, state, project_id, provider, cwd, mode?, model?, resume_id?, initial_prompt?, cli_profile_id?) → Result<String>` | Launch a new PTY session. Returns the session ID. |
| `write_session` | `(state, session_id, data) → Result<()>` | Write data (stdin) to a running session |
| `resize_session` | `(state, session_id, cols, rows) → Result<()>` | Resize the PTY dimensions |
| `stop_session` | `(state, session_id) → Result<()>` | Stop a running session (kill child process) |
| `attach_session` | `(state, session_id, channel) → Result<()>` | Subscribe a Tauri channel to PTY output events |
| `detach_session` | `(state, session_id, channel) → Result<()>` | Unsubscribe a channel from PTY output |

### Provider Detection

| Command | Signature | Description |
|---|---|---|
| `detect_providers` | `(state) → Result<Vec<ProviderInfo>>` | Scan for installed provider CLIs |
| `probe_cli` | `(state, provider, executable_path?, extra_args?) → Result<CliInfo>` | Probe a specific CLI for version and capability info |
| `detect_tools` | `(force_refresh) → Result<ToolChain>` | Detect development tools (Git, Node, Rust, etc.) |

### Git Workbench

| Command | Signature | Description |
|---|---|---|
| `git_status` | `(state, project_path) → Result<GitStatus>` | Get repository status (changed files, branch) |
| `git_diff` | `(state, project_path, file?, staged?) → Result<Vec<Diff>>` | Get diff for files or hunks |
| `git_stage` | `(state, project_path, files?, hunks?) → Result<()>` | Stage files or specific hunks |
| `git_unstage` | `(state, project_path, files?, hunks?) → Result<()>` | Unstage files or hunks |
| `git_commit` | `(state, project_path, message) → Result<CommitResult>` | Create a commit |
| `git_branches` | `(state, project_path) → Result<Vec<Branch>>` | List branches |
| `git_switch_branch` | `(state, project_path, name, create?) → Result<()>` | Switch to a branch (optionally create) |
| `git_stashes` | `(state, project_path) → Result<Vec<Stash>>` | List stashes |
| `git_stash` | `(state, project_path, message?) → Result<()>` | Stash working changes |
| `git_stash_pop` | `(state, project_path, index?) → Result<()>` | Apply and drop a stash |
| `git_tags` | `(state, project_path) → Result<Vec<Tag>>` | List tags |
| `git_remotes` | `(state, project_path) → Result<Vec<Remote>>` | List remotes |
| `git_fetch` | `(state, project_path, remote?) → Result<()>` | Fetch from remote |
| `git_pull` | `(state, project_path, remote?, branch?) → Result<()>` | Pull from remote |
| `git_push` | `(state, project_path, remote?, branch?) → Result<()>` | Push to remote |
| `git_create_pr` | `(state, project_path, title, body, head, base?) → Result<PrResult>` | Create a GitHub pull request |
| `git_list_prs` | `(state, project_path) → Result<Vec<PullRequest>>` | List open pull requests |
| `git_ai_proposal` | `(state, project_path, provider?, mode?) → Result<String>` | Generate an AI commit message proposal |

### Workflows

| Command | Signature | Description |
|---|---|---|
| `start_workflow` | `(state, project_id, template_id, task_id?) → Result<String>` | Start a workflow run |
| `pause_workflow` | `(state, workflow_run_id) → Result<()>` | Pause a running workflow |
| `resume_workflow` | `(state, workflow_run_id) → Result<()>` | Resume a paused workflow |
| `cancel_workflow` | `(state, workflow_run_id) → Result<()>` | Cancel a workflow run |
| `get_workflow_templates` | `(state) → Result<Vec<WorkflowTemplate>>` | List available templates |
| `save_workflow_template` | `(state, template) → Result<()>` | Create or update a template |
| `write_workflow_report` | `(state, run_id, project_path) → Result<String>` | Generate a Markdown report for a run |

### Tasks

| Command | Signature | Description |
|---|---|---|
| `create_task` | `(state, project_id, title, description?, column?, tags?, provider?, mode?, model?) → Result<String>` | Create a new task |
| `update_task` | `(state, task_id, patch) → Result<()>` | Update task fields |
| `move_task` | `(state, task_id, column) → Result<()>` | Move task to a different column |
| `delete_task` | `(state, task_id) → Result<()>` | Delete a task |
| `run_task_autopilot` | `(state, project_id) → Result<()>` | Trigger Autopilot scan for Ready tasks |

### Usage Inspector

| Command | Signature | Description |
|---|---|---|
| `get_usage_data` | `(state, project_id?, provider?, time_range?, source?) → Result<Vec<UsageRecord>>` | Query usage telemetry |
| `get_usage_summary` | `(state, project_id?, provider?, time_range?) → Result<UsageSummary>` | Get aggregated usage totals |
| `refresh_api_connector` | `(state, provider) → Result<()>` | Force-refresh an official API connector |
| `set_budget_alert` | `(state, project_id?, threshold, limit_type, value) → Result<()>` | Configure a budget alert |
| `get_connector_status` | `(state) → Result<Vec<ConnectorStatus>>` | Check connector health and freshness |

### Sharing

| Command | Signature | Description |
|---|---|---|
| `create_room` | `(state, session_id) → Result<String>` | Create a sharing room, return invite token |
| `join_room` | `(state, invite_token) → Result<()>` | Join a sharing room |
| `set_write_permission` | `(state, room_id, allowed) → Result<()>` | Grant or revoke peer write access |
| `leave_room` | `(state, room_id) → Result<()>` | Leave a sharing room |

### Themes

| Command | Signature | Description |
|---|---|---|
| `get_themes` | `(state) → Result<Vec<AppTheme>>` | List all themes |
| `save_theme` | `(state, theme) → Result<()>` | Create or update a custom theme |
| `delete_theme` | `(state, theme_id) → Result<()>` | Delete a custom theme |
| `import_theme` | `(state, theme_json) → Result<String>` | Import a theme from JSON |
| `export_theme` | `(state, theme_id) → Result<String>` | Export a theme as JSON |
| `apply_theme` | `(state, theme_id) → Result<()>` | Set the active theme |

### Projects & Workspaces

| Command | Signature | Description |
|---|---|---|
| `create_project` | `(state, workspace_id, name, path, color?) → Result<String>` | Add a project |
| `update_project` | `(state, project_id, patch) → Result<()>` | Update project fields |
| `delete_project` | `(state, project_id) → Result<()>` | Remove a project reference |
| `list_projects` | `(state) → Result<Vec<Project>>` | List all projects |
| `list_workspaces` | `(state) → Result<Vec<Workspace>>` | List all workspaces |
| `save_workspace` | `(state, workspace) → Result<()>` | Create or update a workspace |
| `delete_workspace` | `(state, workspace_id) → Result<()>` | Delete a workspace |

### Events

The backend emits events to the frontend via Tauri channels:

| Event | Payload | Description |
|---|---|---|
| `pty-output` | `PtyEvent { session_id, data: Vec<u8> }` | Binary PTY output |
| `session-status` | `{ session_id, status }` | Session status change |
| `workflow-status` | `{ run_id, status }` | Workflow run status change |
| `alert` | `Alert` | Workspace notification alert |

Frontend code subscribes via `@tauri-apps/api/event`'s `listen()`.

## See Also

- [Rust Backend](rust-backend.md) — command implementations
- [Frontend](frontend.md) — `native.ts` IPC wrapper usage
- [Architecture](architecture.md) — IPC data flow
