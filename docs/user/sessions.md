# Sessions

Sessions are real PTY terminals running agent CLIs inside CoDes.

## Session Lifecycle

### Creating a Session

1. Navigate to the **Sessions** view
2. Click **New Session**
3. Configure:
   - **Provider** — choose from detected agent CLIs
   - **Working directory** — defaults to the project root
   - **Mode** — see below
   - **Model** — optional override (if the provider supports it)
   - **CLI Profile** — optional pre-configured launch profile
   - **Initial prompt** — sent immediately on launch
4. Click **Launch**

### Session Modes

| Mode | Description |
|---|---|
| **Interactive** | Full terminal — you type, the agent responds. Default. |
| **Auto** | The agent runs autonomously with minimal prompts. |
| **Plan** | Read-only planning mode — useful for AI commit proposals or dry-run reviews. |
| **Full Access** | Maps to each provider's bypass flag (e.g., `--yes`, `--no-confirm`). Use only in trusted or sandboxed environments. |

### Session Status

| Status | Meaning |
|---|---|
| `waiting` | Session created but not yet started |
| `working` | Actively running |
| `input_required` | Agent is waiting for user input |
| `completed` | Process exited successfully |
| `failed` | Process exited with an error |
| `disconnected` | PTY connection lost |

### Stopping a Session

Click the stop button on the session tab or use the context menu. CoDes sends a termination signal to the underlying PTY process.

## Terminal Layout

### Tabs

Each session opens as a tab. Tabs show the provider icon, session title, and status indicator. Unread output is highlighted.

### Split Panes

Split a session pane vertically or horizontally to view multiple terminals side by side. Drag dividers to resize.

### Swarm Layout

The swarm layout tiles all active sessions in a grid. Useful for monitoring multiple agents at once.

### Terminal Features

- **xterm.js** with full VT100/xterm escape sequence support
- **Binary output streaming** — handles ANSI colors, progress bars, and interactive TUI apps
- **Search** — find text in terminal output
- **Clickable links** — URLs and file paths are detected and clickable
- **Copy/Paste** — standard clipboard integration

## Session Context Menus

Right-click a session tab or entry to:
- Rename the session
- Change the session mode
- Clone the session
- Open the containing project folder
- Copy session ID or details
- Stop / Kill the session

## Session History & Handoff

CoDes captures terminal output and can import structured conversation history from supported providers.

### Available History Sources

- **Codex** — structured history files
- **Claude Code** — conversation logs
- **OpenCode** — session transcripts
- **Grok Build** — run records
- **Pi** — conversation data

For other providers, CoDes falls back to bounded terminal capture.

### Handoff

The handoff dialog lets you transfer context from a completed session to a new one:

1. Open the **Handoff** dialog from the session context menu or toolbar
2. Choose the source session
3. Select transfer mode:
   - **Conversation only** — structured history if available
   - **Full visible** — everything visible in the terminal
   - **Recent context** — last N lines of output
4. Preview the content before sending
5. Launch the new session with the context prepopulated

### Resume

If a provider supports resume IDs, CoDes can reconnect to a previous session. Resume is automatic when available.

## Notifications

CoDes can send desktop notifications when sessions complete or fail. Enable notifications in **Settings**.

## See Also

- [Quickstart](quickstart.md) — first session walkthrough
- [Provider Setup](provider-setup.md) — install and authenticate CLIs
- [Workflows](workflows.md) — orchestrate sessions in pipelines
- [Kanban Tasks](kanban-tasks.md) — link sessions to tasks
