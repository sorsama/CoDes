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
  | "workflows"
  | "git"
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
  workflowRunId?: string;
  workflowStageRunId?: string;
  cliProfileId?: string;
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
  executionKind?: "single" | "workflow";
  workflowTemplateId?: string;
  workflowRunId?: string;
  workflowOverrides?: Record<string, Partial<WorkflowStage>>;
}

export type WorkflowStageRole = "plan" | "implement" | "verify";
export type WorkflowRunStatus =
  | "queued"
  | "preflight"
  | "running"
  | "waiting_input"
  | "repairing"
  | "passed"
  | "failed"
  | "paused"
  | "interrupted"
  | "cancelled";
export type WorkflowStageStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "needs_review"
  | "cancelled";

export interface CliEnvironmentOverride {
  name: string;
  source: "literal" | "inherit";
  value?: string;
  secret?: boolean;
}

export interface CliProfile {
  id: string;
  name: string;
  provider: Provider;
  executablePath?: string;
  extraArgs: string[];
  environment: CliEnvironmentOverride[];
}

export interface WorkflowStage {
  id: string;
  name: string;
  role: WorkflowStageRole;
  provider: Provider;
  mode: SessionMode;
  model?: string;
  promptTemplate: string;
  timeoutMinutes: number;
  retryCount: number;
  cliProfileId?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
  maxRepairCycles: number;
  reportPathTemplate: string;
  writeReport: boolean;
  builtIn?: boolean;
  updatedAt?: number;
}

export interface WorkflowArtifact {
  summary: string;
  content: string;
  verdict?: "passed" | "failed" | "blocked";
  findings?: string;
  tests?: string[];
  reportMarkdown?: string;
}

export interface WorkflowStageRun {
  id: string;
  stageId: string;
  name: string;
  role: WorkflowStageRole;
  provider: Provider;
  status: WorkflowStageStatus;
  attempt: number;
  cycle: number;
  sessionId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  artifact?: WorkflowArtifact;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  taskId: string;
  projectId: string;
  templateId: string;
  templateName: string;
  status: WorkflowRunStatus;
  currentStageId?: string;
  cycle: number;
  pauseAfterStage: boolean;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  stageRuns: WorkflowStageRun[];
  plan?: string;
  implementation?: string;
  verification?: string;
  reportMarkdown?: string;
  reportPath?: string;
  error?: string;
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
  defaultWorkflowTemplateId: string;
  gitAutomationMode: "verify_first" | "full_auto";
  gitDefaultProvider: Provider;
  gitDefaultProfileId?: string;
  gitProtectedBranches: string[];
  usageRefreshMinutes: number;
  usageBudgetUsd?: number;
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
  parents?: string[];
  decorations?: string[];
}
export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  checks: string;
  draft?: boolean;
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

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "unknown";

export interface GitChangedFile {
  path: string;
  oldPath?: string;
  indexStatus: GitFileStatus;
  worktreeStatus: GitFileStatus;
  staged: boolean;
  partiallyStaged: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitStash {
  index: number;
  reference: string;
  message: string;
}

export interface GitTag {
  name: string;
  target: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitRepositoryState {
  isRepository: boolean;
  root?: string;
  head?: string;
  detached: boolean;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  cherryPickInProgress: boolean;
  revertInProgress: boolean;
  files: GitChangedFile[];
  branches: GitBranch[];
  stashes: GitStash[];
  tags: GitTag[];
  remotes: GitRemote[];
  commits: RepositoryCommit[];
  pullRequests: PullRequestSummary[];
  githubAuthenticated: boolean;
  error?: string;
}

export interface GitDiff {
  path?: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  content: string;
}

export type GitOperation =
  | { kind: "init" }
  | { kind: "stage"; paths: string[] }
  | { kind: "unstage"; paths: string[] }
  | { kind: "stage_patch"; patch: string }
  | { kind: "unstage_patch"; patch: string }
  | { kind: "commit"; message: string; amend?: boolean }
  | { kind: "create_branch"; name: string; startPoint?: string }
  | { kind: "switch_branch"; name: string }
  | { kind: "rename_branch"; name: string }
  | { kind: "delete_branch"; name: string }
  | { kind: "fetch"; remote?: string }
  | { kind: "pull"; remote?: string; branch?: string; rebase?: boolean }
  | { kind: "push"; remote: string; branch: string; setUpstream?: boolean }
  | { kind: "stash"; message?: string; includeUntracked?: boolean }
  | { kind: "stash_apply"; index: number; pop?: boolean }
  | { kind: "create_tag"; name: string; target?: string; message?: string }
  | { kind: "delete_tag"; name: string }
  | { kind: "merge"; branch: string }
  | { kind: "rebase"; branch: string }
  | { kind: "cherry_pick"; revision: string }
  | { kind: "revert"; revision: string }
  | { kind: "continue"; operation: "merge" | "rebase" | "cherry_pick" | "revert" }
  | { kind: "abort"; operation: "merge" | "rebase" | "cherry_pick" | "revert" }
  | { kind: "add_remote"; name: string; url: string }
  | { kind: "remove_remote"; name: string }
  | {
      kind: "create_pr";
      title: string;
      body: string;
      base?: string;
      draft?: boolean;
    }
  | { kind: "checkout_pr"; number: number }
  | { kind: "mark_pr_ready"; number: number };

export interface GitProposal {
  repositoryRoot: string;
  snapshotId: string;
  provider: Provider;
  summary: string;
  findings: string[];
  commitGroups: Array<{ paths: string[]; message: string }>;
  branchAction?: { kind: "create" | "switch"; name: string };
  pushTarget?: { remote: string; branch: string };
  pullRequest?: { title: string; body: string; base?: string; draft: boolean };
}

export type UsageSourceKind =
  | "local_structured"
  | "local_terminal"
  | "official_api";
export type UsageConfidence = "exact" | "provider_reported" | "partial";

export interface UsageRecord {
  id: string;
  externalId?: string;
  provider: string;
  product: string;
  model?: string;
  workspaceId?: string;
  projectId?: string;
  sessionId?: string;
  startedAt: number;
  endedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  requestCount?: number;
  costAmount?: number;
  costCurrency?: string;
  nativeUnit?: string;
  nativeQuantity?: number;
  source: string;
  sourceKind: UsageSourceKind;
  confidence: UsageConfidence;
  syncedAt: number;
}

export interface UsageAggregate {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requestCount: number;
  costUsd: number;
  records: number;
}

export type UsageConnectorKind =
  | "openai"
  | "anthropic"
  | "github"
  | "google";
export interface UsageConnector {
  id: string;
  kind: UsageConnectorKind;
  label: string;
  enabled: boolean;
  accountId?: string;
  projectId?: string;
  organizationId?: string;
  hasCredential: boolean;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface UsageSyncStatus {
  connectorId: string;
  status: "idle" | "syncing" | "ready" | "partial" | "error";
  recordsImported: number;
  lastSyncedAt?: number;
  detail?: string;
}

export interface UsageQuery {
  provider?: string;
  sourceKind?: UsageSourceKind;
  projectId?: string;
  startAt?: number;
  endAt?: number;
  limit?: number;
}

export interface WorkspaceSnapshot {
  snapshotVersion: number;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: Project[];
  sessions: AgentSession[];
  tasks: BoardTask[];
  workflowTemplates: WorkflowTemplate[];
  workflowRuns: WorkflowRun[];
  cliProfiles: CliProfile[];
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
