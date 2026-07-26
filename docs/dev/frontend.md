# Frontend

The frontend is a React 19 + TypeScript application built with Vite, running inside a Tauri webview.

## Technology Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 |
| Language | TypeScript (strict mode) |
| Build Tool | Vite 8.x |
| State Management | Zustand with persist middleware |
| Terminal Emulator | xterm.js |
| Desktop IPC | @tauri-apps/api (invoke, listen, event) |
| Testing | Vitest |

## Entry Point

### `src/main.tsx`

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

## Application Component

### `src/App.tsx`

The root component (~68Kb) handles:

- **Workspace layout** — sidebar, main area, bottom panel
- **View routing** — dashboard, sessions, board, workflows, git, browser, inspector, themes, sharing, settings
- **Drag-and-drop** — pane splitting, tab reordering, task board
- **Deep link handling** — `codes://` protocol scheme
- **Provider UI** — launcher, status indicators
- **Theme application** — CSS custom properties from active theme

### View Registration

Each view is a component selected by the active `ViewId`:

```typescript
type ViewId =
  | "dashboard"
  | "sessions"
  | "board"
  | "workflows"
  | "git"
  | "browser"
  | "inspector"
  | "themes"
  | "sharing"
  | "settings";
```

## State Management

### `src/store.ts`

A Zustand store (~40Kb) with persist middleware manages:

| Slice | State |
|---|---|
| **Workspace** | Workspaces list, active workspace ID |
| **Projects** | Projects per workspace, active project ID |
| **Sessions** | Active sessions, session status, active session ID |
| **Tasks** | Kanban tasks per project |
| **Workflows** | Workflow runs and templates |
| **Themes** | Available themes, active theme ID |
| **UI** | Sidebar state, alert notifications, view selection |
| **Settings** | App-wide preferences |

### Store Actions

Actions are defined as methods on the store:

```typescript
interface CoDesStore {
  // Workspace
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;

  // Sessions
  addSession: (session: AgentSession) => void;
  updateSession: (id: string, patch: Partial<AgentSession>) => void;
  removeSession: (id: string) => void;

  // Tasks
  addTask: (task: BoardTask) => void;
  moveTask: (id: string, column: string) => void;
  updateTask: (id: string, patch: Partial<BoardTask>) => void;

  // ... more actions
}
```

### Persistence

Non-critical state uses Zustand's `persist` middleware with `localStorage` fallback. Critical state (projects, sessions) is persisted to SQLite via Rust commands.

## IPC Layer

### `src/lib/native.ts`

Typed wrappers around Tauri IPC:

```typescript
// Invoke a command and get a typed result
export async function startNativeSession(params: StartSessionParams): Promise<string>
export async function writeNativeSession(sessionId: string, data: string): Promise<void>
export async function stopNativeSession(sessionId: string): Promise<void>
export async function resizeNativeSession(sessionId: string, cols: number, rows: number): Promise<void>

// Listen for events
export async function attachNativeSession(
  sessionId: string,
  onEvent: (event: PtyEvent) => void
): Promise<() => void>
```

## Component Architecture

### `src/components/`

| Component | Purpose |
|---|---|
| **TerminalPane.tsx** | xterm.js terminal with PTY integration, search, links |
| **WorkspaceHub.tsx** | Workspace layout with sidebar and pane management |
| **GitWorkspace.tsx** | Full Git workbench UI (~50Kb) |
| **OverlayHub.tsx** | Modal/dialog overlay manager |
| **WorkflowHub.tsx** | Workflow template editor and run monitor |
| **UsageInspector.tsx** | Usage data dashboard with filters and charts |
| **BrowserWorkspace.tsx** | Webview/iframe browser preview |
| **ProjectManagerDialog.tsx** | Project create/edit dialog |
| **HandoffDialog.tsx** | Session handoff transfer dialog |
| **SessionContextMenu.tsx** | Right-click context menu for sessions |
| **AppDialogHost.tsx** | App-level dialog container |
| **Icon.tsx** | Reusable SVG/icon component |
| **ProviderIcon.tsx** | Provider-specific icon renderer |

### Session Runtime

`src/lib/sessionRuntime.ts` manages runtime session state outside the Zustand store:

- PTY event listeners (output stream, status changes)
- Binary data decoding
- Output buffering for history handoff
- Desktop notifications on session events
- Usage data accumulation

### Workflow Automation

`src/lib/workflowAutomation.ts` implements the multi-CLI workflow engine:

- Stage orchestration (order, preflight, execution)
- Artifact passing between stages
- Crash retry logic
- Repair loop management
- Pause/cancel/resume controls
- Markdown report generation

### Task Automation

`src/lib/taskAutomation.ts` implements Autopilot:

- Scans Ready column for tasks
- Respects per-task provider/mode/model settings
- Configurable parallel worker limit
- Transitions tasks through Working to Done

## Styling

### CSS Custom Properties

The active theme is applied as CSS custom properties on the root element:

```css
:root {
  --background: oklch(14% 0.008 255);
  --sidebar: oklch(17% 0.012 255);
  --surface: oklch(19% 0.01 255);
  --text: oklch(94% 0.006 80);
  --accent: oklch(72% 0.14 65);
  /* ... more tokens */
}
```

`src/App.css` (~114Kb) contains all component styles using these variables.

## Type Definitions

### `src/types.ts`

Core TypeScript interfaces:

```typescript
interface Workspace { id, name, color, position, lastOpenedAt }
interface Project { id, workspaceId, name, path, color, position }
interface AgentSession { id, projectId, title, provider, status, cwd, mode, ... }
interface BoardTask { id, projectId, title, description, column, tags, ... }
interface WorkflowRun { id, projectId, templateId, status, stageRuns, ... }
interface WorkflowTemplate { id, name, stages, ... }
interface AppTheme { id, name, mode, tokens, ... }
```

## See Also

- [Architecture](architecture.md) — component interaction and data flow
- [Session Runtime](../user/sessions.md) — user guide for session management
- [IPC Commands](ipc-commands.md) — Tauri command reference
