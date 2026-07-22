import type { Provider } from "./lib/providers";

export type { Provider };
export type SessionStatus =
  | "waiting"
  | "working"
  | "input_required"
  | "completed"
  | "failed"
  | "disconnected";
export type HistoryTransferMode = "conversation" | "visible" | "recent";
export type SessionMode = "interactive" | "auto" | "plan" | "full_access";
export type ViewId =
  | "dashboard"
  | "sessions"
  | "board"
  | "browser"
  | "inspector"
  | "themes"
  | "sharing"
  | "settings";

export interface Workspace {
  id: string;
  name: string;
  color: string;
  iconDataUrl?: string;
  position: number;
  lastOpenedAt: number;
  archivedAt?: number;
  lastProjectId?: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  color: string;
  position: number;
  lastOpenedAt: number;
}

export interface AgentSession {
  id: string;
  projectId: string;
  title: string;
  provider: Provider;
  status: SessionStatus;
  cwd: string;
  createdAt: number;
  unread: boolean;
  resumeId?: string;
  startedAt?: number;
  exitedAt?: number;
  cost?: number;
  contextPercent?: number;
  providerSessionId?: string;
  historySource?: string;
  mode?: SessionMode;
  model?: string;
  initialPrompt?: string;
  autonomousTaskId?: string;
}

export interface BoardTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: "backlog" | "ready" | "working" | "done";
  tags: string[];
  position: number;
  sessionId?: string;
  failure?: string;
  provider?: Provider;
  mode?: SessionMode;
  model?: string;
  autonomous?: boolean;
}

export interface TimelineEvent {
  id: string;
  sessionId: string;
  type: "prompt" | "tool" | "approval" | "failure" | "status";
  title: string;
  detail: string;
  timestamp: number;
  durationMs?: number;
}

export interface WorkspaceAlert {
  id: string;
  sessionId?: string;
  projectId: string;
  kind: "approval" | "completed" | "failed" | "info";
  title: string;
  detail: string;
  createdAt: number;
  read: boolean;
}

export interface ThemeTokens {
  background: string;
  sidebar: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  radius: number;
  density: "compact" | "comfortable";
  font: string;
  mono: string;
  fontScale: number;
}

export interface AppTheme {
  id: string;
  name: string;
  mode: "dark" | "light";
  version: 1;
  tokens: ThemeTokens;
  builtIn?: boolean;
  updatedAt?: number;
}

export interface AppSettings {
  notifications: boolean;
  restoreWorkspace: boolean;
  detailedTelemetry: boolean;
  telemetryLimit: number;
  defaultProvider: Provider;
  defaultSessionMode: SessionMode;
  taskBoardAutonomy: boolean;
  taskConcurrency: number;
  relayUrl: string;
  iceServers: RTCIceServer[];
  browserUrl: string;
  handoffHistoryMode: HistoryTransferMode;
  handoffRecentTurns: number;
  handoffMaxChars: number;
  handoffRedactSecrets: boolean;
}

export interface SystemTool {
  provider: Provider | "github";
  installed: boolean;
  version?: string;
  authenticated?: boolean;
}

export interface RepositoryCommit {
  hash: string;
  subject: string;
  author: string;
  timestamp: number;
}
export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  checks: string;
}
export interface RepositoryOverview {
  isRepository: boolean;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  remote?: string;
  commits: RepositoryCommit[];
  pullRequests: PullRequestSummary[];
  githubAuthenticated: boolean;
  error?: string;
}

export interface WorkspaceSnapshot {
  snapshotVersion: number;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: Project[];
  sessions: AgentSession[];
  tasks: BoardTask[];
  events: TimelineEvent[];
  alerts: WorkspaceAlert[];
  themes: AppTheme[];
  settings: AppSettings;
  activeProjectId: string;
  activeSessionId: string;
  activeThemeId: string;
  sessionLayout: "tabs" | "split" | "swarm";
}

export type SharePermission = "read" | "write-pending" | "write-approved";
export type ShareConnectionState =
  "idle" | "connecting" | "waiting" | "connected" | "failed" | "expired";
