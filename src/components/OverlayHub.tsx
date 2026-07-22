import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  Command,
  FileText,
  FolderOpen,
  Search,
  TerminalSquare,
  Trash2,
  X,
} from "./Icon";
import { PROVIDER_IDS, providerMeta } from "../lib/providers";
import { cachedTools, detectTools } from "../lib/native";
import { sessionRuntime } from "../lib/sessionRuntime";
import { dispatchBoardTask } from "../lib/taskAutomation";
import { appConfirm } from "../lib/dialogs";
import { ProviderIcon } from "./ProviderIcon";
import { useCoDesStore } from "../store";
import { WorkspaceAvatar, WorkspaceManager } from "./WorkspaceHub";
import type { BoardTask, Provider, SessionMode, SystemTool } from "../types";

const SESSION_MODES: Array<{ id: SessionMode; label: string; detail: string }> =
  [
    {
      id: "interactive",
      label: "Ask",
      detail: "Normal provider prompts and approvals",
    },
    {
      id: "auto",
      label: "Auto",
      detail: "Work autonomously inside the workspace",
    },
    {
      id: "plan",
      label: "Plan",
      detail: "Read and plan without changing files",
    },
    {
      id: "full_access",
      label: "Full access",
      detail: "Bypass permissions and sandboxing",
    },
  ];

function ModePicker({
  value,
  onChange,
}: {
  value: SessionMode;
  onChange: (mode: SessionMode) => void;
}) {
  return (
    <fieldset className="mode-picker">
      <legend>Execution mode</legend>
      {SESSION_MODES.map((mode) => (
        <label className={value === mode.id ? "active" : ""} key={mode.id}>
          <input
            type="radio"
            checked={value === mode.id}
            onChange={() => onChange(mode.id)}
          />
          <span>
            <strong>{mode.label}</strong>
            <small>{mode.detail}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Backdrop({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const close = useCoDesStore((s) => s.setOverlay);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);
  return (
    <div
      className="overlay-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
    >
      <aside
        className="overlay-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </aside>
    </div>
  );
}

function CommandPalette() {
  const state = useCoDesStore();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      [
        ...state.workspaces
          .filter((item) => !item.archivedAt)
          .map((item) => ({
            id: `w-${item.id}`,
            title: item.name,
            detail: `${state.projects.filter((project) => project.workspaceId === item.id).length} projects · Workspace`,
            icon: FolderOpen,
            workspace: item,
            action: () => state.setActiveWorkspace(item.id),
          })),
        ...state.projects.map((item) => ({
          id: `p-${item.id}`,
          title: item.name,
          detail: item.path,
          icon: FolderOpen,
          action: () => state.setActiveProject(item.id),
        })),
        ...state.sessions.map((item) => ({
          id: `s-${item.id}`,
          title: item.title,
          detail: providerMeta(item.provider).label,
          icon: TerminalSquare,
          action: () => state.setActiveSession(item.id),
        })),
        ...state.tasks.map((item) => ({
          id: `t-${item.id}`,
          title: item.title,
          detail: `Task · ${item.column}`,
          icon: FileText,
          action: () => {
            state.setActiveProject(item.projectId);
            state.setView("board");
            state.setOverlay("task", item.id);
          },
        })),
        ...([
          {
            id: "a-session",
            title: "New agent session",
            detail: "Action",
            icon: Bot,
            action: () => state.setOverlay("session"),
          },
          {
            id: "a-settings",
            title: "Open settings",
            detail: "Action",
            icon: Command,
            action: () => state.setView("settings"),
          },
        ] as const),
      ]
        .filter(
          (item) =>
            !q || `${item.title} ${item.detail}`.toLowerCase().includes(q),
        )
        .slice(0, 14),
    [q, state.workspaces, state.projects, state.sessions, state.tasks],
  );
  const open = (result: (typeof results)[number]) => {
    result.action();
    if (result.id !== "a-session") state.setOverlay(null);
  };
  return (
    <Backdrop label="Search workspace">
      <header className="overlay-heading">
        <div>
          <span>Command palette</span>
          <h2>Go anywhere</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => state.setOverlay(null)}
          aria-label="Close"
        >
          <X />
        </button>
      </header>
      <label className="palette-search">
        <Search />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              open(results[0]);
            }
          }}
          placeholder="Workspaces, projects, sessions, tasks…"
        />
      </label>
      <div className="command-results">
        {results.map((result) => {
          const { id, title, detail, icon: Icon } = result;
          const workspace = id.startsWith("w-")
            ? state.workspaces.find((item) => `w-${item.id}` === id)
            : undefined;
          return (
            <button key={id} onClick={() => open(result)}>
              {workspace ? (
                <WorkspaceAvatar workspace={workspace} size="small" />
              ) : (
                <Icon />
              )}
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </button>
          );
        })}
        {!results.length && (
          <div className="overlay-empty">No matching workspace item.</div>
        )}
      </div>
      <footer className="overlay-hint">
        <kbd>Esc</kbd> close <kbd>↵</kbd> open first result
      </footer>
    </Backdrop>
  );
}

function AlertsPanel() {
  const state = useCoDesStore();
  return (
    <Backdrop label="Workspace alerts">
      <header className="overlay-heading">
        <div>
          <span>Local activity</span>
          <h2>Alerts</h2>
        </div>
        <button className="text-button" onClick={state.markAllAlertsRead}>
          Mark all read
        </button>
        <button
          className="icon-button"
          onClick={() => state.setOverlay(null)}
          aria-label="Close"
        >
          <X />
        </button>
      </header>
      <div className="alert-list">
        {state.alerts.map((alert) => (
          <button
            key={alert.id}
            className={alert.read ? "read" : ""}
            onClick={() => {
              state.markAlertRead(alert.id);
              if (alert.sessionId) state.setActiveSession(alert.sessionId);
              state.setOverlay(null);
            }}
          >
            <span className={`alert-icon ${alert.kind}`}>
              {alert.kind === "failed" ? (
                <AlertTriangle />
              ) : alert.kind === "completed" ? (
                <Check />
              ) : (
                <Bell />
              )}
            </span>
            <span>
              <strong>{alert.title}</strong>
              <small>{alert.detail}</small>
              <time>{new Date(alert.createdAt).toLocaleString()}</time>
            </span>
          </button>
        ))}
        {!state.alerts.length && (
          <div className="overlay-empty">
            <Bell />
            Nothing needs your attention.
          </div>
        )}
      </div>
    </Backdrop>
  );
}

function SessionCreator() {
  const state = useCoDesStore();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const [provider, setProvider] = useState<Provider>(
    state.settings.defaultProvider,
  );
  const [title, setTitle] = useState("New agent session");
  const [cwd, setCwd] = useState(project?.path ?? "");
  const [resumeId, setResumeId] = useState("");
  const [mode, setMode] = useState<SessionMode>(
    state.settings.defaultSessionMode,
  );
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<SystemTool[]>(() => cachedTools() ?? []);
  const [error, setError] = useState("");
  useEffect(() => {
    void detectTools()
      .then(setTools)
      .catch((e) => setError(String(e)));
  }, []);
  const installed =
    tools.find((tool) => tool.provider === provider)?.installed ?? false;
  async function create() {
    setError("");
    const id = state.addSession(
      provider,
      title.trim() || providerMeta(provider).label,
      {
        cwd: cwd.trim(),
        resumeId: resumeId.trim() || undefined,
        mode,
        model: model.trim() || undefined,
      },
    );
    const session = useCoDesStore.getState().sessions.find((s) => s.id === id);
    if (!session) return;
    try {
      await sessionRuntime.ensure(session);
      state.setOverlay(null);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Backdrop label="New agent session">
      <header className="overlay-heading">
        <div>
          <span>Launch provider</span>
          <h2>New session</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => state.setOverlay(null)}
          aria-label="Close"
        >
          <X />
        </button>
      </header>
      <div className="form-stack">
        <label>
          <span>Provider</span>
          <div className="provider-select">
            <ProviderIcon provider={provider} />
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {providerMeta(id).label}
                </option>
              ))}
            </select>
          </div>
          <small>
            {tools.length
              ? installed
                ? "Installed and ready"
                : `${providerMeta(provider).install} · installation required`
              : "Checking local tools…"}
          </small>
        </label>
        <label>
          <span>Session title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <ModePicker value={mode} onChange={setMode} />
        <label>
          <span>
            Model <em>optional</em>
          </span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Use provider default"
          />
        </label>
        <label>
          <span>Working directory</span>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} />
        </label>
        <label>
          <span>
            Resume identifier <em>optional</em>
          </span>
          <input
            value={resumeId}
            onChange={(e) => setResumeId(e.target.value)}
            placeholder="Provider session ID"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer className="sheet-actions">
        <button
          className="secondary-button"
          onClick={() => state.setOverlay(null)}
        >
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={!cwd.trim() || (tools.length > 0 && !installed)}
          onClick={() => void create()}
        >
          Start session
        </button>
      </footer>
    </Backdrop>
  );
}

function TaskEditor() {
  const state = useCoDesStore();
  const existing = state.tasks.find((t) => t.id === state.editingTaskId);
  const [draft, setDraft] = useState<BoardTask>(
    () =>
      existing ?? {
        id: crypto.randomUUID(),
        projectId: state.activeProjectId,
        title: "",
        description: "",
        column: "ready",
        tags: [],
        position: state.tasks.length,
        provider: state.settings.defaultProvider,
        mode: state.settings.defaultSessionMode,
        autonomous: true,
      },
  );
  const [error, setError] = useState("");
  const patch = <K extends keyof BoardTask>(key: K, value: BoardTask[K]) =>
    setDraft((v) => ({ ...v, [key]: value }));
  function save() {
    if (!draft.title.trim()) {
      setError("Give the task a title.");
      return;
    }
    if (existing) state.updateTask(existing.id, draft);
    else state.addTask(draft.column, draft);
    state.setOverlay(null);
  }
  async function dispatch() {
    if (!draft.title.trim()) {
      setError("Give the task a title before dispatching it.");
      return;
    }
    const taskId =
      existing?.id ?? state.addTask("ready", { ...draft, column: "ready" });
    if (existing) {
      const linked = state.sessions.find(
        (session) => session.id === existing.sessionId,
      );
      if (
        linked &&
        !["failed", "completed", "disconnected"].includes(linked.status)
      ) {
        setError("This task already has a running session.");
        return;
      }
      state.updateTask(taskId, {
        ...draft,
        sessionId: undefined,
        failure: undefined,
      });
    }
    try {
      await dispatchBoardTask(taskId, {
        provider: draft.provider,
        mode: draft.mode,
        model: draft.model,
      });
      state.setOverlay(null);
    } catch (e) {
      setError(String(e));
    }
  }
  const projectSessions = state.sessions.filter(
    (session) => session.projectId === draft.projectId,
  );
  return (
    <Backdrop label={existing ? "Edit task" : "New task"}>
      <header className="overlay-heading">
        <div>
          <span>{existing ? "Task details" : "Plan work"}</span>
          <h2>{existing ? "Edit task" : "New task"}</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => state.setOverlay(null)}
          aria-label="Close"
        >
          <X />
        </button>
      </header>
      <div className="form-stack">
        <label>
          <span>Title</span>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </label>
        <label>
          <span>Description</span>
          <textarea
            rows={6}
            value={draft.description}
            onChange={(e) => patch("description", e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            <span>Column</span>
            <select
              value={draft.column}
              onChange={(e) =>
                patch("column", e.target.value as BoardTask["column"])
              }
            >
              <option value="backlog">Backlog</option>
              <option value="ready">Ready</option>
              <option value="working">In progress</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label>
            <span>Tags</span>
            <input
              value={draft.tags.join(", ")}
              onChange={(e) =>
                patch(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                )
              }
              placeholder="frontend, urgent"
            />
          </label>
        </div>
        <label>
          <span>Linked session</span>
          <select
            value={draft.sessionId ?? ""}
            onChange={(e) => patch("sessionId", e.target.value || undefined)}
          >
            <option value="">Unassigned</option>
            {projectSessions.map((session) => (
              <option value={session.id} key={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Dispatch provider</span>
          <div className="provider-select">
            <ProviderIcon
              provider={draft.provider ?? state.settings.defaultProvider}
            />
            <select
              value={draft.provider ?? state.settings.defaultProvider}
              onChange={(e) => patch("provider", e.target.value as Provider)}
            >
              {PROVIDER_IDS.map((id) => (
                <option value={id} key={id}>
                  {providerMeta(id).label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <ModePicker
          value={draft.mode ?? state.settings.defaultSessionMode}
          onChange={(mode) => patch("mode", mode)}
        />
        <label>
          <span>
            Model <em>optional</em>
          </span>
          <input
            value={draft.model ?? ""}
            onChange={(e) => patch("model", e.target.value || undefined)}
            placeholder="Use provider default"
          />
        </label>
        <label className="automation-toggle">
          <input
            type="checkbox"
            checked={draft.autonomous ?? false}
            onChange={(e) => patch("autonomous", e.target.checked)}
          />
          <span>
            <strong>Run automatically when ready</strong>
            <small>
              The board starts this task when a worker slot is available.
            </small>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer className="sheet-actions">
        {existing && (
          <>
            <button
              className="danger-button"
              onClick={() =>
                void appConfirm({
                  title: `Delete ${existing.title}?`,
                  detail:
                    "This removes the task from the board. Its linked session remains available.",
                  confirmLabel: "Delete task",
                  tone: "danger",
                }).then((confirmed) => {
                  if (confirmed) {
                    state.deleteTask(existing.id);
                    state.setOverlay(null);
                  }
                })
              }
            >
              <Trash2 />
              Delete
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                state.duplicateTask(existing.id);
                state.setOverlay(null);
              }}
            >
              <FileText />
              Duplicate
            </button>
          </>
        )}
        <span />
        <button className="secondary-button" onClick={save}>
          Save
        </button>
        <button className="primary-button" onClick={() => void dispatch()}>
          <Bot />
          Dispatch
        </button>
      </footer>
    </Backdrop>
  );
}

export function OverlayHub() {
  const state = useCoDesStore();
  useEffect(() => {
    if (!state.message) return;
    const timer = window.setTimeout(() => state.setMessage(undefined), 3500);
    return () => window.clearTimeout(timer);
  }, [state.message]);
  return (
    <>
      {state.overlay === "search" && <CommandPalette />}
      {state.overlay === "alerts" && <AlertsPanel />}
      {state.overlay === "session" && <SessionCreator />}
      {state.overlay === "task" && <TaskEditor />}
      {state.overlay === "workspaces" && <WorkspaceManager />}
      {state.message && (
        <div className="toast" role="status">
          {state.message}
          <button onClick={() => state.setMessage(undefined)}>
            <X />
          </button>
        </div>
      )}
    </>
  );
}
