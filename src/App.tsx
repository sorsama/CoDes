import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { z } from "zod";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  Activity,
  Blocks,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Clipboard,
  Columns2,
  Copy,
  ExternalLink,
  Gauge,
  GitCommit,
  GitPullRequest,
  GripVertical,
  Grid2X2,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Menu,
  MonitorDot,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "./components/Icon";
import { BrowserWorkspace } from "./components/BrowserWorkspace";
import { AppDialogHost } from "./components/AppDialogHost";
import { OverlayHub } from "./components/OverlayHub";
import { ProviderIcon } from "./components/ProviderIcon";
import { ProjectManagerDialog } from "./components/ProjectManagerDialog";
import { TerminalPane } from "./components/TerminalPane";
import {
  openProviderHandoffMenu,
  openSessionMenu,
  SessionContextMenu,
  type SessionMenuState,
} from "./components/SessionContextMenu";
import { TimelineEventIcon } from "./components/TimelineEventIcon";
import { WorkspaceSwitcher } from "./components/WorkspaceHub";
import {
  cachedTools,
  chooseDirectory,
  deleteSessionTranscript,
  detectTools,
  inspectRepository,
  isTauri,
  launchUrl,
} from "./lib/native";
import { initializePersistence } from "./lib/persistence";
import { appPrompt } from "./lib/dialogs";
import { providerMeta, PROVIDER_IDS } from "./lib/providers";
import { sessionRuntime } from "./lib/sessionRuntime";
import { dispatchBoardTask } from "./lib/taskAutomation";
import { LiveShareSession, type ShareSnapshot } from "./sharing/client";
import { activeTheme, darkTheme, lightTheme, useCoDesStore } from "./store";
import type {
  AppTheme,
  BoardTask,
  HistoryTransferMode,
  RepositoryOverview,
  SessionMode,
  SystemTool,
  ViewId,
} from "./types";
import "./App.css";

const nav: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> =
  [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "sessions", label: "Sessions", icon: TerminalSquare },
    { id: "board", label: "Task board", icon: KanbanSquare },
    { id: "browser", label: "Browser", icon: MonitorDot },
    { id: "inspector", label: "Inspector", icon: Activity },
    { id: "sharing", label: "Live share", icon: Share2 },
  ];
function ProviderGlyph({ provider }: { provider: string }) {
  return <ProviderIcon provider={provider} />;
}

function Sidebar() {
  const state = useCoDesStore();
  const activeSessions = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  );
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>();
  const [managedProjectId, setManagedProjectId] = useState<string>();
  const workspaceProjects = state.projects
    .filter((project) => project.workspaceId === state.activeWorkspaceId)
    .sort((a, b) => a.position - b.position);
  async function addProject() {
    const path = await chooseDirectory();
    if (!path) return;
    const duplicate = state.projects.find(
      (p) => p.path.toLowerCase() === path.toLowerCase(),
    );
    if (duplicate) {
      if (duplicate.workspaceId !== state.activeWorkspaceId)
        state.moveProject(duplicate.id, state.activeWorkspaceId);
      state.setActiveProject(duplicate.id);
      state.setMessage(
        duplicate.workspaceId === state.activeWorkspaceId
          ? "That project is already in this workspace."
          : "Project moved into this workspace.",
      );
      return;
    }
    const parts = path.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] ?? "Project";
    state.addProject({
      id: crypto.randomUUID(),
      workspaceId: state.activeWorkspaceId,
      name,
      path,
      color: `hsl(${Math.floor(Math.random() * 360)} 55% 58%)`,
      position: workspaceProjects.length,
      lastOpenedAt: Date.now(),
    });
  }
  if (!state.sidebarOpen)
    return (
      <button
        className="sidebar-restore"
        onClick={state.toggleSidebar}
        aria-label="Show sidebar"
      >
        <PanelLeftOpen size={16} />
      </button>
    );
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" />
          <strong>CoDes</strong>
          <button
            className="icon-button collapse"
            onClick={state.toggleSidebar}
            aria-label="Hide sidebar"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        <nav className="primary-nav" aria-label="Workspace">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={state.view === id ? "active" : ""}
              onClick={() => state.setView(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {id === "sessions" && <em>{activeSessions.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="section-label">
            <span>Projects</span>
            <button
              className="icon-button"
              aria-label="Add project"
              onClick={() => void addProject()}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="project-list">
            {workspaceProjects.map((project) => (
              <div className="project-entry" key={project.id}>
                <button
                  className={
                    state.activeProjectId === project.id ? "active" : ""
                  }
                  onClick={() => state.setActiveProject(project.id)}
                >
                  <span
                    className="project-swatch"
                    style={{ background: project.color }}
                  />
                  <span>{project.name}</span>
                  <ChevronRight size={13} />
                </button>
                <button
                  className="project-more"
                  aria-label={`Manage ${project.name}`}
                  onClick={() => setManagedProjectId(project.id)}
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>
            ))}
            {!workspaceProjects.length && (
              <button
                className="sidebar-empty-project"
                onClick={() => void addProject()}
              >
                <Plus />
                Add your first project
              </button>
            )}
          </div>
        </div>
        <div className="sidebar-section sessions-list">
          <div className="section-label">
            <span>Recent sessions</span>
          </div>
          {activeSessions.map((session) => (
            <button
              key={session.id}
              onClick={() => state.setActiveSession(session.id)}
              onContextMenu={(event) =>
                openSessionMenu(event, session, setSessionMenu)
              }
              className="recent-session"
            >
              <span className={`status-dot ${session.status}`} />
              <span>
                <strong>{session.title}</strong>
                <small>{providerMeta(session.provider).label}</small>
              </span>
              {session.unread && <i />}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button onClick={() => state.setView("themes")}>
            <Palette size={15} />
            Themes
          </button>
          <button onClick={() => state.setView("settings")}>
            <Settings size={15} />
            Settings
          </button>
          <WorkspaceSwitcher />
        </div>
        <SessionContextMenu
          menu={sessionMenu}
          onClose={() => setSessionMenu(undefined)}
        />
      </aside>
      {managedProjectId && (
        <ProjectManagerDialog
          projectId={managedProjectId}
          onClose={() => setManagedProjectId(undefined)}
        />
      )}
    </>
  );
}

function Topbar({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const state = useCoDesStore();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const unread = state.alerts.filter((a) => !a.read).length;
  return (
    <header className="topbar">
      <div className="title-block">
        {eyebrow && <span>{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{project?.path}</p>
      </div>
      <div className="top-actions">
        <button
          className="icon-button"
          aria-label="Search"
          onClick={() => state.setOverlay("search")}
        >
          <Search size={16} />
        </button>
        <button
          className="secondary-button"
          onClick={() => state.setOverlay("alerts")}
        >
          <Inbox size={15} />
          Alerts{unread > 0 && <span className="count-badge">{unread}</span>}
        </button>
        <button
          className="primary-button"
          disabled={!project}
          onClick={() => state.setOverlay("session")}
        >
          <Plus size={15} />
          New session
        </button>
      </div>
    </header>
  );
}

function RepositoryWidget({ path }: { path: string }) {
  const [repo, setRepo] = useState<RepositoryOverview>();
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    void inspectRepository(path)
      .then(setRepo)
      .finally(() => setLoading(false));
  };
  useEffect(load, [path]);
  return (
    <article
      className="widget github-widget"
      style={{ "--i": 3 } as React.CSSProperties}
    >
      <div className="widget-heading">
        <div>
          <span className="eyebrow">Repository</span>
          <h2>GitHub activity</h2>
        </div>
        <button
          className="icon-button"
          onClick={load}
          aria-label="Refresh repository"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading ? (
        <div className="widget-empty">
          <RefreshCw className="spin" />
          <strong>Reading repository</strong>
        </div>
      ) : !repo?.isRepository ? (
        <div className="widget-empty">
          <GitPullRequest />
          <strong>Not a Git repository</strong>
          <span>
            {repo?.error ??
              "Initialize Git to see branch and pull request activity."}
          </span>
        </div>
      ) : (
        <div className="repo-summary">
          <div>
            <strong>{repo.branch || "detached HEAD"}</strong>
            <span className={repo.dirty ? "dirty" : "clean"}>
              {repo.dirty ? "Uncommitted changes" : "Working tree clean"}
            </span>
            <small>
              ↑ {repo.ahead ?? 0} · ↓ {repo.behind ?? 0}
            </small>
          </div>
          {repo.pullRequests.map((pr) => (
            <button key={pr.number} onClick={() => void launchUrl(pr.url)}>
              <GitPullRequest />
              <span>
                <strong>
                  #{pr.number} {pr.title}
                </strong>
                <small>
                  {pr.state} · {pr.checks}
                </small>
              </span>
            </button>
          ))}
          {!repo.pullRequests.length && (
            <small>
              {repo.githubAuthenticated
                ? "No open pull requests."
                : "Run gh auth login to load pull requests."}
            </small>
          )}
          {repo.commits.slice(0, 2).map((commit) => (
            <div className="repo-commit" key={commit.hash}>
              <GitCommit />
              <span>
                <strong>{commit.subject}</strong>
                <small>
                  {commit.hash} · {commit.author}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function WorkspaceSnapshot() {
  const state = useCoDesStore();
  const sessionCount = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  ).length;
  const taskCount = state.tasks.filter(
    (t) => t.projectId === state.activeProjectId && t.column !== "done",
  ).length;
  return (
    <div className="readiness">
      <div
        className="readiness-ring"
        style={
          {
            "--score": `${Math.min(100, sessionCount * 20 + taskCount * 10)}%`,
          } as React.CSSProperties
        }
      >
        <strong>{sessionCount}</strong>
        <span>sessions</span>
      </div>
      <div>
        <h3>Workspace overview</h3>
        <p>Live counts from the current project.</p>
        <ul>
          <li>
            <TerminalSquare />
            {sessionCount} open sessions
          </li>
          <li>
            <KanbanSquare />
            {taskCount} open tasks
          </li>
          <li>
            <ShieldCheck />
            Provider credentials stay local
          </li>
        </ul>
      </div>
    </div>
  );
}
function Dashboard() {
  const state = useCoDesStore();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const workspace = state.workspaces.find(
    (item) => item.id === state.activeWorkspaceId,
  );
  const sessions = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  );
  const tasks = state.tasks.filter(
    (t) => t.projectId === state.activeProjectId,
  );
  if (!project)
    return (
      <main className="main-scroll">
        <Topbar title={workspace?.name ?? "Workspace"} eyebrow="CoDes" />
        <section className="workspace-empty-dashboard">
          <span className="empty-orbit">
            <Plus />
          </span>
          <p>Empty workspace</p>
          <h2>
            Bring a project into
            <br />
            your new space.
          </h2>
          <span>
            Choose a local folder. Its files stay where they are; CoDes only
            remembers the connection.
          </span>
          <button
            className="primary-button"
            onClick={() => state.setOverlay("workspaces")}
          >
            <Plus />
            Add a project
          </button>
        </section>
      </main>
    );
  return (
    <main className="main-scroll">
      <Topbar title={workspace?.name ?? "Workspace"} eyebrow="CoDes" />
      <section className="dashboard-grid stagger-group">
        <article
          className="widget readiness-widget"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <WorkspaceSnapshot />
        </article>
        <article
          className="widget status-widget"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <div className="widget-heading">
            <div>
              <span className="eyebrow">Current project</span>
              <h2>Agent sessions</h2>
            </div>
            <button onClick={() => state.setView("sessions")}>
              View all <ExternalLink />
            </button>
          </div>
          <div className="session-summary">
            {sessions.length ? (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => state.setActiveSession(session.id)}
                >
                  <ProviderGlyph provider={session.provider} />
                  <span>
                    <strong>{session.title}</strong>
                    <small>
                      {providerMeta(session.provider).label}
                      {session.contextPercent === undefined
                        ? ""
                        : ` · ${session.contextPercent}% context`}
                    </small>
                  </span>
                  <span className={`state-label ${session.status}`}>
                    {session.status.replace("_", " ")}
                  </span>
                </button>
              ))
            ) : (
              <div className="widget-empty">
                <TerminalSquare />
                <strong>No sessions yet</strong>
                <span>Start a provider session when you are ready.</span>
              </div>
            )}
          </div>
        </article>
        <article
          className="widget board-widget"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="widget-heading">
            <div>
              <span className="eyebrow">Current project</span>
              <h2>Task flow</h2>
            </div>
            <button onClick={() => state.setView("board")}>
              Open board <ExternalLink />
            </button>
          </div>
          <div className="mini-board">
            {(["backlog", "ready", "working", "done"] as const).map(
              (column) => {
                const count = tasks.filter((t) => t.column === column).length;
                return (
                  <div key={column}>
                    <span>{column}</span>
                    <strong>{count}</strong>
                    <i>
                      <b style={{ width: `${Math.min(100, count * 25)}%` }} />
                    </i>
                  </div>
                );
              },
            )}
          </div>
        </article>
        <RepositoryWidget path={project.path} />
        <article
          className="widget quick-widget"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          <div className="widget-heading">
            <div>
              <span className="eyebrow">Tools</span>
              <h2>Quick actions</h2>
            </div>
          </div>
          <div className="quick-actions">
            <button onClick={() => state.setView("browser")}>
              <MonitorDot />
              <span>
                <strong>Preview app</strong>
                <small>Inspect localhost</small>
              </span>
            </button>
            <button onClick={() => state.setView("sharing")}>
              <Share2 />
              <span>
                <strong>Share session</strong>
                <small>Encrypted P2P</small>
              </span>
            </button>
            <button onClick={() => state.setView("themes")}>
              <Palette />
              <span>
                <strong>Tune interface</strong>
                <small>Theme Studio</small>
              </span>
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}

function Sessions() {
  const state = useCoDesStore();
  const [maximized, setMaximized] = useState<string>();
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>();
  const list = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  );
  const active = list.find((s) => s.id === state.activeSessionId) ?? list[0];
  const theme = activeTheme(state);
  const rename = async (session: (typeof list)[number]) => {
    const title = (
      await appPrompt({
        title: "Rename session",
        inputLabel: "Session title",
        inputValue: session.title,
        confirmLabel: "Rename",
      })
    )?.trim();
    if (title) state.updateSession(session.id, { title });
  };
  let visible =
    state.sessionLayout === "tabs"
      ? active
        ? [active]
        : []
      : state.sessionLayout === "split"
        ? list.slice(0, 2)
        : list;
  if (maximized) visible = visible.filter((s) => s.id === maximized);
  return (
    <main className="session-main">
      <div className="session-top">
        <div className="session-tabs" role="tablist">
          {list.map((session) => (
            <div
              className={`session-tab ${session.id === active?.id ? "active" : ""}`}
              key={session.id}
              onContextMenu={(event) =>
                openSessionMenu(event, session, setSessionMenu)
              }
            >
              <button
                role="tab"
                aria-selected={session.id === active?.id}
                className="session-tab-select"
                onClick={() => state.setActiveSession(session.id)}
                onDoubleClick={() => void rename(session)}
              >
                <span className={`status-dot ${session.status}`} />
                <span>{session.title}</span>
                {session.unread && <i />}
              </button>
              <button
                className="session-tab-close"
                aria-label={`Close ${session.title}`}
                onClick={() =>
                  void sessionRuntime
                    .stop(session.id)
                    .then(() => deleteSessionTranscript(session.id))
                    .finally(() => state.closeSession(session.id))
                }
              >
                <X />
              </button>
            </div>
          ))}
          <button
            className="add-tab"
            onClick={() => state.setOverlay("session")}
            aria-label="New session"
          >
            <Plus />
          </button>
        </div>
        <div className="layout-picker">
          <button
            className={state.sessionLayout === "tabs" ? "active" : ""}
            onClick={() => state.setSessionLayout("tabs")}
            title="Tabs"
          >
            <Menu />
          </button>
          <button
            className={state.sessionLayout === "split" ? "active" : ""}
            onClick={() => state.setSessionLayout("split")}
            title="Split"
          >
            <Columns2 />
          </button>
          <button
            className={state.sessionLayout === "swarm" ? "active" : ""}
            onClick={() => state.setSessionLayout("swarm")}
            title="Swarm"
          >
            <Grid2X2 />
          </button>
        </div>
      </div>
      <div
        className={`terminal-layout ${maximized ? "pane-maximized" : state.sessionLayout}`}
      >
        {visible.length ? (
          visible.map((session) => (
            <TerminalPane
              key={session.id}
              session={session}
              theme={theme}
              compact={state.sessionLayout === "swarm"}
              maximized={maximized === session.id}
              onToggleMaximize={() =>
                setMaximized((v) => (v === session.id ? undefined : session.id))
              }
              onContinueWithProvider={(event) =>
                openProviderHandoffMenu(event, session, setSessionMenu)
              }
            />
          ))
        ) : (
          <div className="session-empty">
            <TerminalSquare />
            <strong>No open sessions</strong>
            <span>Start a real provider PTY to continue.</span>
            <button
              className="primary-button"
              onClick={() => state.setOverlay("session")}
            >
              <Plus />
              New session
            </button>
          </div>
        )}
      </div>
      <SessionContextMenu
        menu={sessionMenu}
        onClose={() => setSessionMenu(undefined)}
      />
    </main>
  );
}

const columns: Array<{ id: BoardTask["column"]; label: string; tone: string }> =
  [
    { id: "backlog", label: "Backlog", tone: "muted" },
    { id: "ready", label: "Ready", tone: "ready" },
    { id: "working", label: "In progress", tone: "working" },
    { id: "done", label: "Done", tone: "done" },
  ];
function SortableTask({ task }: { task: BoardTask }) {
  const state = useCoDesStore();
  const sortable = useSortable({ id: task.id, data: { task } });
  return (
    <article
      ref={sortable.setNodeRef}
      className={`task-card ${sortable.isDragging ? "dragging" : ""} ${task.failure ? "task-failed" : ""}`}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      onDoubleClick={() => state.setOverlay("task", task.id)}
    >
      <button
        className="drag-handle"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Move ${task.title}`}
      >
        <GripVertical />
      </button>
      <div className="task-tags">
        {task.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <h3>{task.title}</h3>
      <p>{task.description || "No description"}</p>
      {task.failure && <small className="task-error">{task.failure}</small>}
      <footer>
        {task.sessionId ? (
          <span>
            <Bot />
            Agent linked
          </span>
        ) : (
          <span>
            {task.autonomous ? <Zap /> : <CircleDot />}
            {task.autonomous
              ? `${providerMeta(task.provider ?? state.settings.defaultProvider).label} · ${(task.mode ?? state.settings.defaultSessionMode).replace("_", " ")}`
              : "Unassigned"}
          </span>
        )}
        <button
          aria-label={`Edit ${task.title}`}
          onClick={() => state.setOverlay("task", task.id)}
        >
          <MoreHorizontal />
        </button>
      </footer>
    </article>
  );
}
function BoardColumn({
  column,
  items,
}: {
  column: (typeof columns)[number];
  items: BoardTask[];
}) {
  const state = useCoDesStore();
  const drop = useDroppable({ id: column.id });
  return (
    <div
      ref={drop.setNodeRef}
      className={`kanban-column ${drop.isOver ? "drop-target" : ""}`}
    >
      <header>
        <span className={`column-dot ${column.tone}`} />
        <strong>{column.label}</strong>
        <em>{items.length}</em>
        <button
          className="icon-button"
          aria-label={`Add ${column.label} task`}
          onClick={() => state.setOverlay("task")}
        >
          <Plus />
        </button>
      </header>
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="task-stack">
          {items.map((task) => (
            <SortableTask key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
function TaskBoard() {
  const state = useCoDesStore();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const projectTasks = state.tasks.filter(
    (t) => t.projectId === state.activeProjectId,
  );
  const tags = [...new Set(projectTasks.flatMap((t) => t.tags))];
  const filtered = projectTasks
    .filter(
      (t) =>
        (!query ||
          `${t.title} ${t.description}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!tag || t.tags.includes(tag)),
    )
    .sort((a, b) => a.position - b.position);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function onDragEnd(event: DragEndEvent) {
    const target = event.over?.id?.toString();
    if (!target) return;
    const targetTask = filtered.find((t) => t.id === target);
    const column =
      columns.find((c) => c.id === target)?.id ?? targetTask?.column;
    if (column)
      state.moveTask(event.active.id.toString(), column, targetTask?.position);
  }
  return (
    <main className="main-scroll">
      <Topbar title="Task board" eyebrow="Plan and dispatch" />
      <div className="board-toolbar">
        <label>
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tasks"
          />
        </label>
        <label className="tag-filter">
          <Blocks />
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          className={`autopilot-toggle ${state.settings.taskBoardAutonomy ? "active" : ""}`}
          onClick={() =>
            state.updateSettings({
              taskBoardAutonomy: !state.settings.taskBoardAutonomy,
            })
          }
          title="Automatically run ready tasks"
        >
          <Zap />
          Autopilot {state.settings.taskBoardAutonomy ? "on" : "off"}
        </button>
        <label className="worker-limit">
          <span>Workers</span>
          <select
            value={state.settings.taskConcurrency}
            onChange={(e) =>
              state.updateSettings({ taskConcurrency: Number(e.target.value) })
            }
          >
            {[1, 2, 3, 4, 6, 8].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button"
          onClick={() => state.setOverlay("task")}
        >
          <Plus />
          Add task
        </button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <section className="kanban">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              items={filtered.filter((task) => task.column === column.id)}
            />
          ))}
        </section>
      </DndContext>
    </main>
  );
}

function Inspector() {
  const state = useCoDesStore();
  const [sessionId, setSessionId] = useState("");
  const [type, setType] = useState("");
  const sessions = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  );
  const ids = new Set(sessions.map((s) => s.id));
  const events = state.events
    .filter(
      (e) =>
        ids.has(e.sessionId) &&
        (!sessionId || e.sessionId === sessionId) &&
        (!type || e.type === type),
    )
    .sort((a, b) => b.timestamp - a.timestamp);
  const contexts = sessions.flatMap((s) =>
    s.contextPercent === undefined ? [] : [s.contextPercent],
  );
  const context = contexts.length
    ? Math.round(contexts.reduce((a, b) => a + b, 0) / contexts.length)
    : undefined;
  const tools = events.filter((e) => e.type === "tool");
  const costs = sessions.flatMap((s) => (s.cost === undefined ? [] : [s.cost]));
  return (
    <main className="main-scroll">
      <Topbar title="Session inspector" eyebrow="Truthful local telemetry" />
      <section className="inspector-layout">
        <div className="telemetry-strip">
          <div>
            <Gauge />
            <span>Context</span>
            <strong>{context === undefined ? "—" : `${context}%`}</strong>
            <i>
              <b style={{ width: `${context ?? 0}%` }} />
            </i>
          </div>
          <div>
            <Zap />
            <span>Events</span>
            <strong>{events.length}</strong>
            <small>recorded locally</small>
          </div>
          <div>
            <Activity />
            <span>Tool calls</span>
            <strong>{tools.length}</strong>
            <small>confidently parsed only</small>
          </div>
          <div>
            <CircleDot />
            <span>Cost</span>
            <strong>
              {costs.length
                ? `$${costs.reduce((a, b) => a + b, 0).toFixed(2)}`
                : "—"}
            </strong>
            <small>provider reported only</small>
          </div>
        </div>
        <div className="timeline">
          <header>
            <h2>Event timeline</h2>
            <div className="timeline-filters">
              <select
                aria-label="Filter by session"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">All sessions</option>
                {sessions.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by event type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">All events</option>
                {["prompt", "tool", "approval", "failure", "status"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </div>
          </header>
          {events.length ? (
            events.map((event) => (
              <article key={event.id}>
                <div className={`timeline-icon ${event.type}`}>
                  <TimelineEventIcon type={event.type} />
                </div>
                <div>
                  <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                  <h3>{event.title}</h3>
                  <p>{event.detail}</p>
                  {event.durationMs && <small>{event.durationMs} ms</small>}
                </div>
              </article>
            ))
          ) : (
            <div className="widget-empty timeline-empty">
              <Activity />
              <strong>No matching telemetry</strong>
              <span>
                Lifecycle and confidently parsed provider events appear here.
              </span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const themeSchema = z.object({
  name: z.string().min(1).max(80),
  mode: z.enum(["dark", "light"]),
  version: z.literal(1),
  tokens: z.object({
    background: z.string().min(1),
    sidebar: z.string().min(1),
    surface: z.string().min(1),
    surfaceRaised: z.string().min(1),
    text: z.string().min(1),
    muted: z.string().min(1),
    border: z.string().min(1),
    accent: z.string().min(1),
    success: z.string().min(1),
    warning: z.string().min(1),
    danger: z.string().min(1),
    radius: z.number().min(0).max(32),
    density: z.enum(["compact", "comfortable"]),
    font: z.string(),
    mono: z.string(),
    fontScale: z.number().min(0.7).max(1.4),
  }),
});
function ThemeStudio() {
  const state = useCoDesStore();
  const theme = activeTheme(state);
  const fileRef = useRef<HTMLInputElement>(null);
  const history = useRef<AppTheme["tokens"][]>([]);
  const apply = (key: keyof AppTheme["tokens"], value: string | number) => {
    history.current.push({ ...theme.tokens });
    state.updateTheme(theme.id, { [key]: value });
  };
  async function importTheme(file?: File) {
    if (!file) return;
    try {
      const parsed = themeSchema.parse(JSON.parse(await file.text()));
      state.addTheme({
        ...parsed,
        id: crypto.randomUUID(),
        builtIn: false,
        updatedAt: Date.now(),
      });
      state.setMessage("Theme imported.");
    } catch (e) {
      state.setMessage(
        `Invalid theme: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  function exportTheme() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${theme.name.toLowerCase().replace(/\s+/g, "-")}.codes-theme.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  const fields: Array<[keyof AppTheme["tokens"], string]> = [
    ["background", "Canvas"],
    ["sidebar", "Sidebar"],
    ["surface", "Surface"],
    ["surfaceRaised", "Raised"],
    ["text", "Text"],
    ["muted", "Muted"],
    ["border", "Border"],
    ["accent", "Accent"],
    ["success", "Success"],
    ["warning", "Warning"],
    ["danger", "Danger"],
  ];
  return (
    <main className="main-scroll">
      <Topbar title="Theme Studio" eyebrow="Make CoDes yours" />
      <section className="theme-layout">
        <aside className="theme-presets">
          <h2>Library</h2>
          {state.themes.map((item) => (
            <button
              className={item.id === theme.id ? "active" : ""}
              key={item.id}
              onClick={() => state.setActiveTheme(item.id)}
            >
              <span className="theme-swatch">
                <i style={{ background: item.tokens.sidebar }} />
                <i style={{ background: item.tokens.surface }} />
                <i style={{ background: item.tokens.accent }} />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.mode} · {item.tokens.density}
                </small>
              </span>
              {item.id === theme.id && <Check />}
            </button>
          ))}
          <button
            className="new-theme"
            onClick={() =>
              state.addTheme({
                ...theme,
                id: crypto.randomUUID(),
                name: `${theme.name} copy`,
                builtIn: false,
                tokens: { ...theme.tokens },
              })
            }
          >
            <Copy />
            Duplicate theme
          </button>
        </aside>
        <div className="theme-editor">
          <div className="editor-header">
            <div>
              <input
                className="theme-name"
                value={theme.name}
                onChange={(e) => state.renameTheme(theme.id, e.target.value)}
              />
              <p>Changes apply instantly across the workspace and terminals.</p>
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => void importTheme(e.target.files?.[0])}
              />
              <button
                className="secondary-button"
                onClick={() => fileRef.current?.click()}
              >
                Import
              </button>
              <button className="secondary-button" onClick={exportTheme}>
                Export
              </button>
              {!theme.builtIn && (
                <button
                  className="danger-button"
                  onClick={() => state.removeTheme(theme.id)}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          </div>
          <section className="token-section">
            <h3>Semantic color</h3>
            <div className="color-grid">
              {fields.map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <div>
                    <i style={{ background: theme.tokens[key] as string }} />
                    <input
                      value={theme.tokens[key] as string}
                      onChange={(e) => apply(key, e.target.value)}
                    />
                  </div>
                </label>
              ))}
            </div>
          </section>
          <section className="token-section controls-grid">
            <label>
              <span>Corner radius</span>
              <input
                type="range"
                min="4"
                max="24"
                value={theme.tokens.radius}
                onChange={(e) => apply("radius", Number(e.target.value))}
              />
              <strong>{theme.tokens.radius}px</strong>
            </label>
            <label>
              <span>Type scale</span>
              <input
                type="range"
                min="0.85"
                max="1.2"
                step="0.05"
                value={theme.tokens.fontScale}
                onChange={(e) => apply("fontScale", Number(e.target.value))}
              />
              <strong>{theme.tokens.fontScale}×</strong>
            </label>
            <label>
              <span>Density</span>
              <select
                value={theme.tokens.density}
                onChange={(e) => apply("density", e.target.value)}
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </label>
          </section>
          <div className="theme-utility">
            <button
              onClick={() => {
                const previous = history.current.pop();
                if (previous) state.updateTheme(theme.id, previous);
              }}
            >
              Undo
            </button>
            {theme.builtIn && (
              <button
                onClick={() =>
                  state.updateTheme(theme.id, {
                    ...(theme.id === "codes-light"
                      ? lightTheme.tokens
                      : darkTheme.tokens),
                  })
                }
              >
                Reset preset
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Sharing() {
  const state = useCoDesStore();
  const live = useRef(new LiveShareSession());
  const [snapshot, setSnapshot] = useState<ShareSnapshot>(
    live.current.snapshot,
  );
  const [mode, setMode] = useState<"read" | "write">("read");
  const [tab, setTab] = useState<"host" | "join">(
    state.pendingInvite ? "join" : "host",
  );
  const [invite, setInvite] = useState(state.pendingInvite ?? "");
  const [sessionId, setSessionId] = useState(state.activeSessionId);
  const [input, setInput] = useState("");
  useEffect(() => live.current.subscribe(setSnapshot), []);
  useEffect(() => {
    if (!state.pendingInvite) return;
    setTab("join");
    setInvite(state.pendingInvite);
    void live.current
      .join(
        state.settings.relayUrl,
        state.settings.iceServers,
        state.pendingInvite,
      )
      .finally(() => state.setPendingInvite(undefined));
  }, [state.pendingInvite]);
  const sessions = state.sessions.filter(
    (s) => s.projectId === state.activeProjectId,
  );
  async function host() {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      state.setMessage("Choose a session to share.");
      return;
    }
    try {
      await live.current.host(
        state.settings.relayUrl,
        state.settings.iceServers,
        session,
        mode === "write",
      );
    } catch (e) {
      state.setMessage(String(e));
    }
  }
  async function join() {
    try {
      await live.current.join(
        state.settings.relayUrl,
        state.settings.iceServers,
        invite.trim(),
      );
    } catch (e) {
      state.setMessage(String(e));
    }
  }
  return (
    <main className="main-scroll">
      <Topbar title="Live share" eyebrow="Encrypted peer to peer" />
      <section className="sharing-layout">
        <div className="share-hero">
          <div className="share-tabs">
            <button
              className={tab === "host" ? "active" : ""}
              onClick={() => setTab("host")}
            >
              Host
            </button>
            <button
              className={tab === "join" ? "active" : ""}
              onClick={() => setTab("join")}
            >
              Join
            </button>
          </div>
          <span className="eyebrow">Private by design</span>
          <h2>
            Pair on the work,
            <br />
            not the screen share.
          </h2>
          <p>
            The relay sees encrypted negotiation only. Terminal data travels
            through the peer connection.
          </p>
          {tab === "host" ? (
            <>
              <label className="share-select">
                <span>Session</span>
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                >
                  <option value="">Choose a session</option>
                  {sessions.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="permission-choice">
                <button
                  className={mode === "read" ? "active" : ""}
                  onClick={() => setMode("read")}
                >
                  <MonitorDot />
                  <span>
                    <strong>Read only</strong>
                    <small>Watch output, no input</small>
                  </span>
                </button>
                <button
                  className={mode === "write" ? "active" : ""}
                  onClick={() => setMode("write")}
                >
                  <TerminalSquare />
                  <span>
                    <strong>Request write</strong>
                    <small>Host must approve</small>
                  </span>
                </button>
              </div>
              <button
                className="primary-button share-create"
                onClick={() => void host()}
              >
                <Radio />
                {snapshot.state === "idle"
                  ? "Create invitation"
                  : "Rotate invitation"}
              </button>
            </>
          ) : (
            <>
              <label className="share-select">
                <span>Invitation</span>
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="codes://share/…"
                />
              </label>
              <button
                className="primary-button share-create"
                onClick={() => void join()}
              >
                <Share2 />
                Join session
              </button>
            </>
          )}
        </div>
        <aside className="invite-panel">
          <header>
            <span
              className={`status-dot ${snapshot.state === "connected" ? "working" : "disconnected"}`}
            />
            <strong>{snapshot.state.replace("_", " ")}</strong>
          </header>
          {snapshot.error && <p className="share-error">{snapshot.error}</p>}
          {snapshot.pin && (
            <>
              <span className="invite-label">Confirmation PIN</span>
              <div className="pin-code">
                {snapshot.pin.split("").map((v, i) => (
                  <b key={i}>{v}</b>
                ))}
              </div>
            </>
          )}
          {snapshot.invite && snapshot.role === "host" && (
            <>
              <span className="invite-label">Private invite</span>
              <div className="invite-link">
                <code>{snapshot.invite.slice(0, 38)}…</code>
                <button
                  onClick={() =>
                    void navigator.clipboard.writeText(snapshot.invite!)
                  }
                >
                  <Clipboard />
                </button>
              </div>
            </>
          )}
          {snapshot.role === "host" &&
            snapshot.peerConnected &&
            snapshot.permission === "write-pending" && (
              <button
                className="primary-button"
                onClick={() => live.current.approveWrite()}
              >
                Approve remote input
              </button>
            )}
          {snapshot.role === "host" &&
            snapshot.permission === "write-approved" && (
              <button
                className="secondary-button"
                onClick={() => live.current.revokeWrite()}
              >
                Return to read only
              </button>
            )}
          {snapshot.role === "guest" && (
            <>
              <pre className="shared-terminal">
                {snapshot.output || "Waiting for terminal output…"}
              </pre>
              {snapshot.permission === "write-approved" && (
                <form
                  className="share-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    live.current.sendInput(`${input}\r`);
                    setInput("");
                  }}
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Send terminal input"
                  />
                  <button>
                    <Send />
                  </button>
                </form>
              )}
            </>
          )}
          {snapshot.state !== "idle" && (
            <button
              className="danger-button"
              onClick={() => live.current.close()}
            >
              Leave and revoke
            </button>
          )}
        </aside>
      </section>
    </main>
  );
}

function SettingsView() {
  const state = useCoDesStore();
  const [tools, setTools] = useState<SystemTool[]>(() => cachedTools() ?? []);
  const [checking, setChecking] = useState(false);
  const [iceText, setIceText] = useState(() =>
    JSON.stringify(state.settings.iceServers, null, 2),
  );
  const [iceError, setIceError] = useState("");
  const loadTools = (force = false) => {
    setChecking(true);
    void detectTools(force)
      .then(setTools)
      .catch((e) => state.setMessage(String(e)))
      .finally(() => setChecking(false));
  };
  useEffect(() => loadTools(false), []);
  function commitIce() {
    try {
      const value = JSON.parse(iceText) as RTCIceServer[];
      if (
        !Array.isArray(value) ||
        value.some((item) => !item || !("urls" in item))
      )
        throw new Error("Expected an array of RTCIceServer objects.");
      state.updateSettings({ iceServers: value });
      setIceError("");
    } catch (error) {
      setIceError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <main className="main-scroll">
      <Topbar title="Settings" eyebrow="Local configuration" />
      <section className="settings-layout">
        <div>
          <div className="settings-heading">
            <div>
              <h2>Provider tools</h2>
              <p>
                Existing CLI authentication is reused; passwords are never
                stored.
              </p>
            </div>
            <button
              className="icon-button"
              onClick={() => loadTools(true)}
              aria-label="Reload provider tools"
              title="Reload provider tools"
            >
              <RefreshCw className={checking ? "spin" : ""} />
            </button>
          </div>
          {tools.map((tool) => (
            <div className="tool-row" key={tool.provider}>
              <ProviderGlyph provider={tool.provider} />
              <span>
                <strong>{providerMeta(tool.provider).label}</strong>
                <small>{tool.version ?? "Not found"}</small>
              </span>
              {tool.installed ? (
                <em className="ok">Ready</em>
              ) : (
                <div className="tool-actions">
                  <button
                    className="tool-install"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        providerMeta(tool.provider).install,
                      );
                      state.setMessage("Install command copied.");
                    }}
                  >
                    Copy install
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${providerMeta(tool.provider).label} documentation`}
                    onClick={() =>
                      void launchUrl(providerMeta(tool.provider).docs)
                    }
                  >
                    <ExternalLink />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div>
          <h2>Workspace behavior</h2>
          <label className="setting-toggle">
            <span>
              <strong>Desktop notifications</strong>
              <small>Approvals, completion, and failures</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.notifications}
              onChange={(e) =>
                state.updateSettings({ notifications: e.target.checked })
              }
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>Restore last workspace</strong>
              <small>Reopen tabs without relaunching processes</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.restoreWorkspace}
              onChange={(e) =>
                state.updateSettings({ restoreWorkspace: e.target.checked })
              }
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>Detailed local telemetry</strong>
              <small>Retain lifecycle and parsed events on this device</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.detailedTelemetry}
              onChange={(e) =>
                state.updateSettings({ detailedTelemetry: e.target.checked })
              }
            />
          </label>
          <label className="setting-field">
            <span>Default provider</span>
            <select
              value={state.settings.defaultProvider}
              onChange={(e) =>
                state.updateSettings({
                  defaultProvider: e.target
                    .value as typeof state.settings.defaultProvider,
                })
              }
            >
              {PROVIDER_IDS.map((id) => (
                <option value={id} key={id}>
                  {providerMeta(id).label}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>Default execution mode</span>
            <select
              value={state.settings.defaultSessionMode}
              onChange={(e) =>
                state.updateSettings({
                  defaultSessionMode: e.target.value as SessionMode,
                })
              }
            >
              <option value="interactive">Ask for approval</option>
              <option value="auto">Auto</option>
              <option value="plan">Plan only</option>
              <option value="full_access">
                Full access (bypass permissions)
              </option>
            </select>
          </label>
          <h2 className="settings-subheading">Task board autonomy</h2>
          <label className="setting-toggle">
            <span>
              <strong>Autopilot</strong>
              <small>Start autonomous tasks when they enter Ready</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.taskBoardAutonomy}
              onChange={(e) =>
                state.updateSettings({ taskBoardAutonomy: e.target.checked })
              }
            />
          </label>
          <label className="setting-field">
            <span>Parallel workers</span>
            <input
              type="number"
              min="1"
              max="8"
              value={state.settings.taskConcurrency}
              onChange={(e) =>
                state.updateSettings({
                  taskConcurrency: Math.max(
                    1,
                    Math.min(8, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          </label>
          <h2 className="settings-subheading">Provider handoff</h2>
          <label className="setting-field">
            <span>Default history</span>
            <select
              value={state.settings.handoffHistoryMode}
              onChange={(e) =>
                state.updateSettings({
                  handoffHistoryMode: e.target.value as HistoryTransferMode,
                })
              }
            >
              <option value="conversation">Conversation only</option>
              <option value="visible">Full visible history</option>
              <option value="recent">Recent history</option>
            </select>
            <small>Every handoff can override this choice.</small>
          </label>
          <label className="setting-field">
            <span>Recent turns</span>
            <input
              type="number"
              min="1"
              max="50"
              value={state.settings.handoffRecentTurns}
              onChange={(e) =>
                state.updateSettings({
                  handoffRecentTurns: Math.max(
                    1,
                    Math.min(50, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          </label>
          <label className="setting-field">
            <span>Character limit</span>
            <input
              type="number"
              min="1024"
              max="250000"
              step="1000"
              value={state.settings.handoffMaxChars}
              onChange={(e) =>
                state.updateSettings({
                  handoffMaxChars: Math.max(
                    1024,
                    Math.min(250000, Number(e.target.value) || 1024),
                  ),
                })
              }
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>Redact likely credentials</strong>
              <small>
                Mask tokens, authorization headers, cookies, and private keys
              </small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.handoffRedactSecrets}
              onChange={(e) =>
                state.updateSettings({ handoffRedactSecrets: e.target.checked })
              }
            />
          </label>
          <h2 className="settings-subheading">Connectivity</h2>
          <label className="setting-field">
            <span>Signaling relay</span>
            <input
              value={state.settings.relayUrl}
              onChange={(e) =>
                state.updateSettings({ relayUrl: e.target.value })
              }
            />
            <small>Use wss:// outside local development.</small>
          </label>
          <label className="setting-field">
            <span>ICE servers (JSON)</span>
            <textarea
              rows={4}
              value={iceText}
              onChange={(e) => setIceText(e.target.value)}
              onBlur={commitIce}
            />
            {iceError && <small className="form-error">{iceError}</small>}
          </label>
        </div>
      </section>
    </main>
  );
}

function App() {
  const state = useCoDesStore();
  const theme = activeTheme(state);
  const launchingTasks = useRef(new Set<string>());
  useEffect(() => {
    void initializePersistence().catch((e) =>
      state.setMessage(`Could not load workspace: ${String(e)}`),
    );
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.tokens).forEach(([key, value]) =>
      root.style.setProperty(
        `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
        String(value),
      ),
    );
    root.dataset.theme = theme.mode;
    root.dataset.density = theme.tokens.density;
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        state.setOverlay("search");
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrent().then((urls) => {
      const invite = urls?.find((url) => url.startsWith("codes://share/"));
      if (invite) state.setPendingInvite(invite);
    });
    void onOpenUrl((urls) => {
      const invite = urls.find((url) => url.startsWith("codes://share/"));
      if (invite) state.setPendingInvite(invite);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    if (!state.hydrated || !state.settings.taskBoardAutonomy || !isTauri())
      return;
    const activeCount = state.tasks.filter((task) => {
      if (!task.autonomous || task.column !== "working" || !task.sessionId)
        return false;
      const session = state.sessions.find((item) => item.id === task.sessionId);
      return (
        session &&
        !["completed", "failed", "disconnected"].includes(session.status)
      );
    }).length;
    const capacity = Math.max(0, state.settings.taskConcurrency - activeCount);
    const queued = state.tasks
      .filter(
        (task) =>
          task.autonomous &&
          task.column === "ready" &&
          !task.sessionId &&
          !task.failure &&
          !launchingTasks.current.has(task.id),
      )
      .sort((a, b) => a.position - b.position)
      .slice(0, capacity);
    queued.forEach((task) => {
      launchingTasks.current.add(task.id);
      void dispatchBoardTask(task.id)
        .catch((error) =>
          useCoDesStore.getState().updateTask(task.id, {
            failure: String(error),
            column: "ready",
          }),
        )
        .finally(() => launchingTasks.current.delete(task.id));
    });
  }, [
    state.hydrated,
    state.settings.taskBoardAutonomy,
    state.settings.taskConcurrency,
    state.tasks,
    state.sessions,
  ]);
  const content =
    state.view === "sessions" ? (
      <Sessions />
    ) : state.view === "board" ? (
      <TaskBoard />
    ) : state.view === "inspector" ? (
      <Inspector />
    ) : state.view === "themes" ? (
      <ThemeStudio />
    ) : state.view === "sharing" ? (
      <Sharing />
    ) : state.view === "settings" ? (
      <SettingsView />
    ) : (
      <Dashboard />
    );
  return (
    <div className={`app-shell ${state.sidebarOpen ? "sidebar-visible" : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <Sidebar />
      <section id="workspace" className="workspace">
        {state.view !== "browser" && content}
        <BrowserWorkspace
          active={state.view === "browser"}
          topbar={<Topbar title="Browser" eyebrow="Inspect and prompt" />}
        />
      </section>
      <OverlayHub />
      <AppDialogHost />
    </div>
  );
}
export default App;
