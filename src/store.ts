import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type {
  AgentSession,
  AppSettings,
  AppTheme,
  BoardTask,
  Project,
  TimelineEvent,
  ViewId,
  Workspace,
  WorkspaceAlert,
  WorkspaceSnapshot,
} from "./types";
import type { Provider } from "./lib/providers";

export const darkTheme: AppTheme = {
  id: "codes-dark",
  name: "CoDes Dark",
  mode: "dark",
  version: 1,
  builtIn: true,
  tokens: {
    background: "oklch(14% 0.008 255)",
    sidebar: "oklch(17% 0.012 255)",
    surface: "oklch(19% 0.01 255)",
    surfaceRaised: "oklch(23% 0.012 255)",
    text: "oklch(94% 0.006 80)",
    muted: "oklch(66% 0.012 255)",
    border: "oklch(28% 0.012 255)",
    accent: "oklch(72% 0.14 65)",
    success: "oklch(72% 0.13 150)",
    warning: "oklch(77% 0.14 80)",
    danger: "oklch(67% 0.18 25)",
    radius: 14,
    density: "compact",
    font: "'Instrument Sans', 'Segoe UI', sans-serif",
    mono: "'Geist Mono', 'Cascadia Code', monospace",
    fontScale: 1,
  },
};
export const lightTheme: AppTheme = {
  ...darkTheme,
  id: "codes-light",
  name: "CoDes Light",
  mode: "light",
  tokens: {
    ...darkTheme.tokens,
    background: "oklch(96% 0.008 80)",
    sidebar: "oklch(93% 0.01 80)",
    surface: "oklch(99% 0.004 80)",
    surfaceRaised: "oklch(98% 0.004 80)",
    text: "oklch(22% 0.015 255)",
    muted: "oklch(48% 0.015 255)",
    border: "oklch(86% 0.012 80)",
    accent: "oklch(57% 0.16 55)",
  },
};
export const defaultWorkspace: Workspace = {
  id: "workspace-default",
  name: "My Workspace",
  color: "#e39b4a",
  position: 0,
  lastOpenedAt: Date.now(),
  lastProjectId: "codes",
};
const defaultProject: Project = {
  id: "codes",
  workspaceId: defaultWorkspace.id,
  name: "CoDes",
  path: "G:\\LAB\\codes",
  color: "#e39b4a",
  position: 0,
  lastOpenedAt: Date.now(),
};
export const defaultSettings: AppSettings = {
  notifications: true,
  restoreWorkspace: true,
  detailedTelemetry: true,
  telemetryLimit: 1000,
  defaultProvider: "codex",
  defaultSessionMode: "interactive",
  taskBoardAutonomy: true,
  taskConcurrency: 2,
  relayUrl: "ws://localhost:8787/signal",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  browserUrl: "http://localhost:1420",
  handoffHistoryMode: "conversation",
  handoffRecentTurns: 10,
  handoffMaxChars: 64_000,
  handoffRedactSecrets: true,
};

export interface CoDesState extends WorkspaceSnapshot {
  view: ViewId;
  sidebarOpen: boolean;
  hydrated: boolean;
  overlay: "search" | "alerts" | "session" | "task" | "workspaces" | null;
  editingTaskId?: string;
  message?: string;
  pendingInvite?: string;
  setView: (view: ViewId) => void;
  toggleSidebar: () => void;
  hydrate: (snapshot: unknown) => void;
  setOverlay: (overlay: CoDesState["overlay"], editingTaskId?: string) => void;
  setMessage: (message?: string) => void;
  setPendingInvite: (invite?: string) => void;
  setActiveWorkspace: (id: string) => void;
  addWorkspace: (workspace: Workspace) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  moveWorkspace: (id: string, position: number) => void;
  duplicateWorkspace: (id: string) => string;
  archiveWorkspace: (id: string) => void;
  unarchiveWorkspace: (id: string) => void;
  removeWorkspace: (id: string) => void;
  setActiveProject: (id: string) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  moveProject: (id: string, workspaceId: string, position?: number) => void;
  moveProjectWithinWorkspace: (id: string, position: number) => void;
  removeProject: (id: string) => void;
  setActiveSession: (id: string) => void;
  setSessionLayout: (layout: CoDesState["sessionLayout"]) => void;
  addSession: (
    provider?: Provider,
    title?: string,
    options?: Partial<AgentSession>,
  ) => string;
  closeSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<AgentSession>) => void;
  addTask: (column?: BoardTask["column"], patch?: Partial<BoardTask>) => string;
  updateTask: (id: string, patch: Partial<BoardTask>) => void;
  deleteTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  moveTask: (
    id: string,
    column: BoardTask["column"],
    position?: number,
  ) => void;
  addEvent: (
    event: Omit<TimelineEvent, "id" | "timestamp"> &
      Partial<Pick<TimelineEvent, "id" | "timestamp">>,
  ) => void;
  addAlert: (
    alert: Omit<WorkspaceAlert, "id" | "createdAt" | "read"> &
      Partial<Pick<WorkspaceAlert, "id" | "createdAt" | "read">>,
  ) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  updateTheme: (id: string, patch: Partial<AppTheme["tokens"]>) => void;
  renameTheme: (id: string, name: string) => void;
  addTheme: (theme: AppTheme) => void;
  removeTheme: (id: string) => void;
  setActiveTheme: (id: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const initial: WorkspaceSnapshot = {
  snapshotVersion: 7,
  workspaces: [defaultWorkspace],
  activeWorkspaceId: defaultWorkspace.id,
  projects: [defaultProject],
  sessions: [],
  tasks: [],
  events: [],
  alerts: [],
  themes: [darkTheme, lightTheme],
  settings: defaultSettings,
  activeProjectId: "codes",
  activeSessionId: "",
  activeThemeId: darkTheme.id,
  sessionLayout: "tabs",
};
const noStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
const fallbackStorage = () =>
  typeof window === "undefined" || "__TAURI_INTERNALS__" in window
    ? noStorage
    : window.localStorage;
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

export function normalizeWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  const source = asRecord(input);
  const now = Date.now();
  let workspaces: Workspace[] = asArray<Partial<Workspace>>(source.workspaces)
    .filter(
      (item) => typeof item.id === "string" && typeof item.name === "string",
    )
    .map((item, index) => ({
      id: item.id!,
      name: item.name!.trim() || `Workspace ${index + 1}`,
      color: typeof item.color === "string" ? item.color : "#e39b4a",
      iconDataUrl:
        typeof item.iconDataUrl === "string" ? item.iconDataUrl : undefined,
      position: typeof item.position === "number" ? item.position : index,
      lastOpenedAt:
        typeof item.lastOpenedAt === "number" ? item.lastOpenedAt : now,
      archivedAt:
        typeof item.archivedAt === "number" ? item.archivedAt : undefined,
      lastProjectId:
        typeof item.lastProjectId === "string" ? item.lastProjectId : undefined,
    }));
  if (!workspaces.length)
    workspaces = [{ ...defaultWorkspace, lastOpenedAt: now }];
  const workspaceIds = new Set(workspaces.map((item) => item.id));
  const legacyProjects = asArray<
    Partial<Project> & Pick<Project, "id" | "name" | "path">
  >(source.projects);
  const preferredWorkspaceId =
    typeof source.activeWorkspaceId === "string" &&
    workspaceIds.has(source.activeWorkspaceId)
      ? source.activeWorkspaceId
      : (workspaces.find((item) => !item.archivedAt)?.id ?? workspaces[0].id);
  const projects: Project[] = legacyProjects
    .filter(
      (item) =>
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.path === "string",
    )
    .map((item, index) => ({
      id: item.id,
      workspaceId:
        typeof item.workspaceId === "string" &&
        workspaceIds.has(item.workspaceId)
          ? item.workspaceId
          : preferredWorkspaceId,
      name: item.name,
      path: item.path,
      color: typeof item.color === "string" ? item.color : "#e39b4a",
      position: typeof item.position === "number" ? item.position : index,
      lastOpenedAt:
        typeof item.lastOpenedAt === "number" ? item.lastOpenedAt : now,
    }));
  workspaces = workspaces.map((workspace) => ({
    ...workspace,
    lastProjectId: projects.some(
      (project) =>
        project.id === workspace.lastProjectId &&
        project.workspaceId === workspace.id,
    )
      ? workspace.lastProjectId
      : projects
          .filter((project) => project.workspaceId === workspace.id)
          .sort((a, b) => a.position - b.position)[0]?.id,
  }));
  const activeWorkspaceId = workspaces.some(
    (item) => item.id === preferredWorkspaceId && !item.archivedAt,
  )
    ? preferredWorkspaceId
    : (workspaces.find((item) => !item.archivedAt)?.id ?? workspaces[0].id);
  const activeWorkspace = workspaces.find(
    (item) => item.id === activeWorkspaceId,
  )!;
  const requestedProjectId =
    typeof source.activeProjectId === "string" ? source.activeProjectId : "";
  const activeProjectId = projects.some(
    (item) =>
      item.id === requestedProjectId && item.workspaceId === activeWorkspaceId,
  )
    ? requestedProjectId
    : (activeWorkspace.lastProjectId ?? "");
  const projectIds = new Set(projects.map((item) => item.id));
  const sessions = asArray<AgentSession>(source.sessions)
    .filter((item) => projectIds.has(item.projectId))
    .map((item) => ({ ...item, mode: item.mode ?? "interactive" }));
  const sessionIds = new Set(sessions.map((item) => item.id));
  const events = asArray<TimelineEvent>(source.events).filter((item) =>
    sessionIds.has(item.sessionId),
  );
  const recoveredAt = new Map<string, number>();
  events.forEach((event) => {
    if (
      event.type === "status" &&
      (event.title === "working" || event.title === "Session started")
    )
      recoveredAt.set(
        event.sessionId,
        Math.max(recoveredAt.get(event.sessionId) ?? 0, event.timestamp),
      );
  });
  const tasks = asArray<BoardTask>(source.tasks).filter((item) =>
    projectIds.has(item.projectId),
  );
  const alerts = asArray<WorkspaceAlert>(source.alerts)
    .filter((item) => projectIds.has(item.projectId))
    .map((alert) =>
      alert.kind === "failed" &&
      alert.sessionId &&
      (recoveredAt.get(alert.sessionId) ?? 0) >= alert.createdAt
        ? { ...alert, read: true }
        : alert,
    );
  const themes = asArray<AppTheme>(source.themes);
  const settings = {
    ...defaultSettings,
    ...asRecord(source.settings),
  } as AppSettings;
  if (
    !(["conversation", "visible", "recent"] as const).includes(
      settings.handoffHistoryMode,
    )
  )
    settings.handoffHistoryMode = defaultSettings.handoffHistoryMode;
  settings.handoffRecentTurns = Math.max(
    1,
    Math.min(
      50,
      Number(settings.handoffRecentTurns) || defaultSettings.handoffRecentTurns,
    ),
  );
  settings.handoffMaxChars = Math.max(
    1_024,
    Math.min(
      250_000,
      Number(settings.handoffMaxChars) || defaultSettings.handoffMaxChars,
    ),
  );
  settings.handoffRedactSecrets = settings.handoffRedactSecrets !== false;
  if (
    !(["interactive", "auto", "plan", "full_access"] as const).includes(
      settings.defaultSessionMode,
    )
  )
    settings.defaultSessionMode = defaultSettings.defaultSessionMode;
  settings.taskBoardAutonomy = settings.taskBoardAutonomy !== false;
  settings.taskConcurrency = Math.max(
    1,
    Math.min(8, Number(settings.taskConcurrency) || 2),
  );
  return {
    snapshotVersion: 7,
    workspaces,
    activeWorkspaceId,
    projects,
    sessions,
    tasks,
    events,
    alerts,
    themes: themes.length ? themes : [darkTheme, lightTheme],
    settings,
    activeProjectId,
    activeSessionId:
      typeof source.activeSessionId === "string" &&
      sessionIds.has(source.activeSessionId)
        ? source.activeSessionId
        : "",
    activeThemeId:
      typeof source.activeThemeId === "string" &&
      themes.some((item) => item.id === source.activeThemeId)
        ? source.activeThemeId
        : darkTheme.id,
    sessionLayout:
      source.sessionLayout === "split" || source.sessionLayout === "swarm"
        ? source.sessionLayout
        : "tabs",
  };
}

const reindex = <T extends { position: number }>(items: T[]) =>
  items.map((item, position) => ({ ...item, position }));

export const useCoDesStore = create<CoDesState>()(
  persist(
    (set, get) => ({
      ...initial,
      view: "dashboard",
      sidebarOpen: true,
      hydrated: false,
      overlay: null,
      setView: (view) => set({ view }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setOverlay: (overlay, editingTaskId) => set({ overlay, editingTaskId }),
      setMessage: (message) => set({ message }),
      setPendingInvite: (pendingInvite) =>
        set({ pendingInvite, view: pendingInvite ? "sharing" : get().view }),
      hydrate: (snapshot) => {
        const normalized = normalizeWorkspaceSnapshot(snapshot);
        set({
          ...normalized,
          activeSessionId: normalized.settings.restoreWorkspace
            ? normalized.activeSessionId
            : "",
          sessionLayout: normalized.settings.restoreWorkspace
            ? normalized.sessionLayout
            : "tabs",
          sessions: normalized.sessions.map((session) => ({
            ...session,
            status: "disconnected",
          })),
          hydrated: true,
        });
      },
      setActiveWorkspace: (id) =>
        set((s) => {
          const workspace = s.workspaces.find(
            (item) => item.id === id && !item.archivedAt,
          );
          if (!workspace) return {};
          const projects = s.projects
            .filter((item) => item.workspaceId === id)
            .sort((a, b) => a.position - b.position);
          const activeProjectId = projects.some(
            (item) => item.id === workspace.lastProjectId,
          )
            ? workspace.lastProjectId!
            : (projects[0]?.id ?? "");
          return {
            activeWorkspaceId: id,
            activeProjectId,
            activeSessionId: "",
            view: "dashboard",
            workspaces: s.workspaces.map((item) =>
              item.id === id
                ? {
                    ...item,
                    lastOpenedAt: Date.now(),
                    lastProjectId: activeProjectId || undefined,
                  }
                : item,
            ),
          };
        }),
      addWorkspace: (workspace) =>
        set((s) => ({
          workspaces: [
            ...s.workspaces,
            { ...workspace, position: s.workspaces.length },
          ],
          activeWorkspaceId: workspace.id,
          activeProjectId: "",
          activeSessionId: "",
          view: "dashboard",
        })),
      updateWorkspace: (id, patch) =>
        set((s) => ({
          workspaces: s.workspaces.map((item) =>
            item.id === id ? { ...item, ...patch, id: item.id } : item,
          ),
        })),
      moveWorkspace: (id, position) =>
        set((s) => {
          const ordered = [...s.workspaces].sort(
            (a, b) => a.position - b.position,
          );
          const current = ordered.findIndex((item) => item.id === id);
          if (current < 0) return {};
          const [moving] = ordered.splice(current, 1);
          ordered.splice(
            Math.max(0, Math.min(position, ordered.length)),
            0,
            moving,
          );
          return { workspaces: reindex(ordered) };
        }),
      duplicateWorkspace: (id) => {
        const source = get().workspaces.find((item) => item.id === id);
        if (!source) return "";
        const duplicate: Workspace = {
          ...source,
          id: crypto.randomUUID(),
          name: `${source.name} copy`,
          position: get().workspaces.length,
          lastOpenedAt: Date.now(),
          archivedAt: undefined,
          lastProjectId: undefined,
        };
        get().addWorkspace(duplicate);
        return duplicate.id;
      },
      archiveWorkspace: (id) =>
        set((s) => {
          const workspace = s.workspaces.find((item) => item.id === id);
          const available = s.workspaces
            .filter((item) => item.id !== id && !item.archivedAt)
            .sort((a, b) => a.position - b.position);
          if (!workspace || !available.length) return {};
          if (s.activeWorkspaceId !== id)
            return {
              workspaces: s.workspaces.map((item) =>
                item.id === id ? { ...item, archivedAt: Date.now() } : item,
              ),
            };
          const next = available[0];
          const project =
            s.projects
              .filter((item) => item.workspaceId === next.id)
              .sort((a, b) => a.position - b.position)
              .find((item) => item.id === next.lastProjectId) ??
            s.projects
              .filter((item) => item.workspaceId === next.id)
              .sort((a, b) => a.position - b.position)[0];
          return {
            workspaces: s.workspaces.map((item) =>
              item.id === id ? { ...item, archivedAt: Date.now() } : item,
            ),
            activeWorkspaceId: next.id,
            activeProjectId: project?.id ?? "",
            activeSessionId: "",
            view: "dashboard",
          };
        }),
      unarchiveWorkspace: (id) =>
        set((s) => ({
          workspaces: s.workspaces.map((item) =>
            item.id === id ? { ...item, archivedAt: undefined } : item,
          ),
        })),
      removeWorkspace: (id) =>
        set((s) =>
          s.activeWorkspaceId === id ||
          s.projects.some((project) => project.workspaceId === id) ||
          s.workspaces.length <= 1
            ? {}
            : {
                workspaces: reindex(
                  s.workspaces
                    .filter((item) => item.id !== id)
                    .sort((a, b) => a.position - b.position),
                ),
              },
        ),
      setActiveProject: (id) =>
        set((s) => {
          const project = s.projects.find((item) => item.id === id);
          if (!project) return {};
          return {
            activeProjectId: id,
            activeWorkspaceId: project.workspaceId,
            view: "dashboard",
            projects: s.projects.map((item) =>
              item.id === id ? { ...item, lastOpenedAt: Date.now() } : item,
            ),
            workspaces: s.workspaces.map((item) =>
              item.id === project.workspaceId
                ? { ...item, lastProjectId: id, lastOpenedAt: Date.now() }
                : item,
            ),
          };
        }),
      addProject: (project) =>
        set((s) => {
          const workspaceId = s.workspaces.some(
            (item) => item.id === project.workspaceId,
          )
            ? project.workspaceId
            : s.activeWorkspaceId;
          const projectInWorkspace = {
            ...project,
            workspaceId,
            position: s.projects.filter(
              (item) => item.workspaceId === workspaceId,
            ).length,
          };
          return {
            projects: [
              ...s.projects.filter(
                (item) =>
                  item.path.toLowerCase() !== project.path.toLowerCase(),
              ),
              projectInWorkspace,
            ],
            activeWorkspaceId: workspaceId,
            activeProjectId: project.id,
            workspaces: s.workspaces.map((item) =>
              item.id === workspaceId
                ? {
                    ...item,
                    lastProjectId: project.id,
                    lastOpenedAt: Date.now(),
                  }
                : item,
            ),
            view: "dashboard",
          };
        }),
      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((item) =>
            item.id === id ? { ...item, ...patch, id: item.id } : item,
          ),
        })),
      moveProject: (id, workspaceId, position) =>
        set((s) => {
          if (!s.workspaces.some((item) => item.id === workspaceId)) return {};
          const moving = s.projects.find((item) => item.id === id);
          if (!moving) return {};
          const destination = s.projects
            .filter(
              (item) => item.workspaceId === workspaceId && item.id !== id,
            )
            .sort((a, b) => a.position - b.position);
          destination.splice(
            Math.max(
              0,
              Math.min(position ?? destination.length, destination.length),
            ),
            0,
            { ...moving, workspaceId },
          );
          const updated = reindex(destination);
          const old =
            moving.workspaceId === workspaceId
              ? []
              : reindex(
                  s.projects
                    .filter(
                      (item) =>
                        item.workspaceId === moving.workspaceId &&
                        item.id !== id,
                    )
                    .sort((a, b) => a.position - b.position),
                );
          const untouched = s.projects.filter(
            (item) =>
              item.workspaceId !== moving.workspaceId &&
              item.workspaceId !== workspaceId,
          );
          return {
            projects: [...untouched, ...old, ...updated],
            activeWorkspaceId:
              s.activeProjectId === id ? workspaceId : s.activeWorkspaceId,
            workspaces: s.workspaces.map((item) =>
              item.id === workspaceId && s.activeProjectId === id
                ? { ...item, lastProjectId: id }
                : item,
            ),
          };
        }),
      moveProjectWithinWorkspace: (id, position) => {
        const project = get().projects.find((item) => item.id === id);
        if (project) get().moveProject(id, project.workspaceId, position);
      },
      removeProject: (id) =>
        set((s) => {
          const removed = s.projects.find((item) => item.id === id);
          if (!removed) return {};
          const removedSessionIds = new Set(
            s.sessions
              .filter((item) => item.projectId === id)
              .map((item) => item.id),
          );
          const projects = s.projects.filter((item) => item.id !== id);
          const sessions = s.sessions.filter((item) => item.projectId !== id);
          const next = projects
            .filter((item) => item.workspaceId === removed.workspaceId)
            .sort((a, b) => a.position - b.position)[0];
          return {
            projects,
            sessions,
            tasks: s.tasks.filter((item) => item.projectId !== id),
            alerts: s.alerts.filter((item) => item.projectId !== id),
            events: s.events.filter(
              (item) => !removedSessionIds.has(item.sessionId),
            ),
            activeProjectId:
              s.activeProjectId === id ? (next?.id ?? "") : s.activeProjectId,
            activeSessionId: removedSessionIds.has(s.activeSessionId)
              ? ""
              : s.activeSessionId,
            workspaces: s.workspaces.map((item) =>
              item.id === removed.workspaceId && item.lastProjectId === id
                ? { ...item, lastProjectId: next?.id }
                : item,
            ),
          };
        }),
      setActiveSession: (activeSessionId) =>
        set((s) => {
          const session = s.sessions.find(
            (item) => item.id === activeSessionId,
          );
          const project =
            session && s.projects.find((item) => item.id === session.projectId);
          return {
            activeSessionId,
            activeProjectId: project?.id ?? s.activeProjectId,
            activeWorkspaceId: project?.workspaceId ?? s.activeWorkspaceId,
            view: "sessions",
            sessions: s.sessions.map((item) =>
              item.id === activeSessionId ? { ...item, unread: false } : item,
            ),
            workspaces: project
              ? s.workspaces.map((item) =>
                  item.id === project.workspaceId
                    ? {
                        ...item,
                        lastProjectId: project.id,
                        lastOpenedAt: Date.now(),
                      }
                    : item,
                )
              : s.workspaces,
          };
        }),
      setSessionLayout: (sessionLayout) => set({ sessionLayout }),
      addSession: (
        provider = get().settings.defaultProvider,
        title = "New agent session",
        options = {},
      ) => {
        const id = options.id ?? crypto.randomUUID();
        const project =
          get().projects.find(
            (item) => item.id === (options.projectId ?? get().activeProjectId),
          ) ??
          get().projects.find(
            (item) => item.workspaceId === get().activeWorkspaceId,
          );
        if (!project) return "";
        set((s) => ({
          sessions: [
            ...s.sessions,
            {
              id,
              projectId: project.id,
              title,
              provider,
              status: "waiting",
              cwd: project.path,
              createdAt: Date.now(),
              unread: false,
              mode: get().settings.defaultSessionMode,
              ...options,
            },
          ],
          activeSessionId: id,
          activeProjectId: project.id,
          activeWorkspaceId: project.workspaceId,
          view: "sessions",
        }));
        return id;
      },
      closeSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((item) => item.id !== id),
          activeSessionId:
            s.activeSessionId === id
              ? (s.sessions.find(
                  (item) =>
                    item.id !== id && item.projectId === s.activeProjectId,
                )?.id ?? "")
              : s.activeSessionId,
        })),
      updateSession: (id, patch) =>
        set((s) => {
          const sessions = s.sessions.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          );
          const next = sessions.find((item) => item.id === id);
          const tasks =
            next?.status === "completed"
              ? s.tasks.map((task) =>
                  task.sessionId === id
                    ? { ...task, column: "done" as const, failure: undefined }
                    : task,
                )
              : next?.status === "failed"
                ? s.tasks.map((task) =>
                    task.sessionId === id
                      ? { ...task, failure: "Linked session failed" }
                      : task,
                  )
                : s.tasks;
          return { sessions, tasks };
        }),
      addTask: (column = "backlog", patch = {}) => {
        const id = patch.id ?? crypto.randomUUID();
        set((s) => ({
          tasks: [
            ...s.tasks,
            {
              id,
              projectId: s.activeProjectId,
              title: "Untitled task",
              description: "",
              column,
              tags: [],
              position: s.tasks.filter((task) => task.column === column).length,
              ...patch,
            },
          ],
        }));
        return id;
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      deleteTask: (id) =>
        set((s) => ({ tasks: s.tasks.filter((item) => item.id !== id) })),
      duplicateTask: (id) =>
        set((s) => {
          const source = s.tasks.find((item) => item.id === id);
          return source
            ? {
                tasks: [
                  ...s.tasks,
                  {
                    ...source,
                    id: crypto.randomUUID(),
                    title: `${source.title} copy`,
                    sessionId: undefined,
                    position: source.position + 1,
                  },
                ],
              }
            : {};
        }),
      moveTask: (id, column, position) =>
        set((s) => {
          const moving = s.tasks.find((task) => task.id === id);
          if (!moving) return {};
          const untouched = s.tasks.filter(
            (task) => task.id !== id && task.column !== column,
          );
          const destination = s.tasks
            .filter((task) => task.id !== id && task.column === column)
            .sort((a, b) => a.position - b.position);
          destination.splice(
            Math.max(
              0,
              Math.min(position ?? destination.length, destination.length),
            ),
            0,
            { ...moving, column },
          );
          return {
            tasks: [
              ...untouched,
              ...destination.map((task, index) => ({
                ...task,
                position: index,
              })),
            ],
          };
        }),
      addEvent: (event) =>
        set((s) =>
          !s.settings.detailedTelemetry &&
          (event.type === "prompt" || event.type === "tool")
            ? {}
            : {
                events: [
                  ...s.events,
                  {
                    id: event.id ?? crypto.randomUUID(),
                    timestamp: event.timestamp ?? Date.now(),
                    ...event,
                  },
                ].slice(-s.settings.telemetryLimit),
              },
        ),
      addAlert: (alert) =>
        set((s) => ({
          alerts: [
            {
              id: alert.id ?? crypto.randomUUID(),
              createdAt: alert.createdAt ?? Date.now(),
              read: alert.read ?? false,
              ...alert,
            },
            ...s.alerts,
          ].slice(0, 250),
        })),
      markAlertRead: (id) =>
        set((s) => ({
          alerts: s.alerts.map((item) =>
            item.id === id ? { ...item, read: true } : item,
          ),
        })),
      markAllAlertsRead: () =>
        set((s) => ({
          alerts: s.alerts.map((item) => ({ ...item, read: true })),
        })),
      updateTheme: (id, patch) =>
        set((s) => ({
          themes: s.themes.map((item) =>
            item.id === id
              ? {
                  ...item,
                  tokens: { ...item.tokens, ...patch },
                  updatedAt: Date.now(),
                }
              : item,
          ),
        })),
      renameTheme: (id, name) =>
        set((s) => ({
          themes: s.themes.map((item) =>
            item.id === id ? { ...item, name } : item,
          ),
        })),
      addTheme: (theme) =>
        set((s) => ({ themes: [...s.themes, theme], activeThemeId: theme.id })),
      removeTheme: (id) =>
        set((s) => ({
          themes: s.themes.filter((item) => item.id !== id || item.builtIn),
          activeThemeId:
            s.activeThemeId === id ? darkTheme.id : s.activeThemeId,
        })),
      setActiveTheme: (activeThemeId) => set({ activeThemeId }),
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: "codes-workspace-v4",
      version: 7,
      storage: createJSONStorage(fallbackStorage),
      migrate: (persisted) => normalizeWorkspaceSnapshot(persisted),
      partialize: (s) => ({
        ...s,
        view: undefined,
        sidebarOpen: undefined,
        hydrated: undefined,
        overlay: undefined,
        editingTaskId: undefined,
        message: undefined,
        pendingInvite: undefined,
      }),
    },
  ),
);

export function activeTheme(
  state: Pick<CoDesState, "themes" | "activeThemeId">,
) {
  return (
    state.themes.find((theme) => theme.id === state.activeThemeId) ?? darkTheme
  );
}
export function workspaceSnapshot(state: CoDesState): WorkspaceSnapshot {
  const {
    snapshotVersion,
    workspaces,
    activeWorkspaceId,
    projects,
    sessions,
    tasks,
    events,
    alerts,
    themes,
    settings,
    activeProjectId,
    activeSessionId,
    activeThemeId,
    sessionLayout,
  } = state;
  return {
    snapshotVersion,
    workspaces,
    activeWorkspaceId,
    projects,
    sessions,
    tasks,
    events,
    alerts,
    themes,
    settings,
    activeProjectId,
    activeSessionId,
    activeThemeId,
    sessionLayout,
  };
}
