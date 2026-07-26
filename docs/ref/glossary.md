# Glossary

| Term | Definition |
|---|---|
| **Agent CLI** | A command-line tool powered by an LLM that can perform coding tasks (e.g., Codex, Claude Code, Aider). |
| **Autopilot** | A CoDes feature that automatically picks tasks from the Kanban "Ready" column and executes them as provider sessions. |
| **CLI Profile** | A saved configuration for launching a provider CLI with custom executable path, arguments, model, and environment. |
| **Connector** | A module in the Usage Inspector that fetches token/cost data from official provider APIs. |
| **Dashboard** | The main project overview view showing recent sessions, task flow, and Git activity. |
| **Deep link** | A `codes://` URL scheme that allows external applications to open specific views or projects in CoDes. |
| **Handoff** | The process of transferring session context (conversation history, terminal output) from one session to another. |
| **Hunk** | A contiguous block of changed lines in a diff. CoDes supports staging individual hunks within a file. |
| **Inspector** | See **Usage Inspector**. |
| **IPC** | Inter-Process Communication — the mechanism CoDes uses for frontend (React) to backend (Rust) calls via Tauri. |
| **Kanban** | A project management method using columns (Backlog, Ready, Working, Done) to visualize task progress. |
| **PTY** | Pseudo-terminal — a software emulation of a physical terminal that allows CoDes to run CLI programs in a controlled environment. |
| **Provider** | A coding-agent CLI that CoDes can launch and manage (e.g., Codex, Claude, Aider). |
| **Relay** | The WebSocket signaling server that facilitates initial peer discovery for encrypted sharing. |
| **Repair loop** | A workflow recovery mechanism: when a stage fails, a repair stage retries with the failure context. |
| **Resume** | Reconnecting to a previous session using a provider-specific resume identifier. |
| **Room** | A temporary, encrypted communication channel for sharing sessions between two CoDes instances. |
| **Schema migration** | A version-tracked database schema change applied automatically on startup. |
| **Session** | An instance of a provider CLI running in a PTY terminal within CoDes. |
| **Session mode** | The interaction model for a session: Interactive, Auto, Plan, or Full Access. |
| **Signaling** | The WebRTC peer discovery process, facilitated by the relay, that allows two CoDes instances to establish a direct encrypted connection. |
| **Stage** | A single step in a multi-CLI workflow, run by one provider with specific configuration. |
| **Swarm** | A layout mode that tiles all active sessions in a grid for simultaneous monitoring. |
| **Template** | A reusable workflow definition with ordered stages, prompts, and configuration. |
| **Theme Studio** | The built-in live theme editor for customizing CoDes appearance via semantic tokens. |
| **Token** | A unit of text processed by an LLM. The Usage Inspector tracks token consumption for cost analysis. |
| **Usage Inspector** | The feature that tracks token and cost evidence from local provider records and official API connectors. |
| **View** | A top-level navigation section in CoDes (Sessions, Git, Board, Workflows, etc.). |
| **WAL** | Write-Ahead Logging — a SQLite journal mode that allows concurrent reads during writes. |
| **WebRTC** | Web Real-Time Communication — a protocol for peer-to-peer data channels used by CoDes sharing. |
| **Workflow** | An automated multi-CLI pipeline with ordered stages, retries, and repair loops. |
| **Workspace** | A top-level container that holds multiple projects. Users can have multiple workspaces. |
| **xterm.js** | The terminal emulation library CoDes uses to render PTY output in the browser. |

## See Also

- [Architecture](../dev/architecture.md) — system design and component relationships
- [FAQ](faq.md) — frequently asked questions
