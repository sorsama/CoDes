import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type {
  HistoryTransferMode,
  Provider,
  RepositoryOverview,
  SystemTool,
  WorkspaceSnapshot,
  CliEnvironmentOverride,
  GitDiff,
  GitOperation,
  GitRepositoryState,
  UsageConnector,
  UsageQuery,
  UsageRecord,
  UsageSyncStatus,
} from "../types";
import { PROVIDER_IDS } from "./providers";

export const isTauri = () => "__TAURI_INTERNALS__" in window;
export type PtyEvent =
  | { event: "output"; data: { bytes: number[] } }
  | { event: "exit"; data: { code: number | null } }
  | { event: "error"; data: { message: string } };
export interface HandoffHistoryRequest {
  sessionId: string;
  provider: Provider;
  cwd: string;
  startedAt: number;
  providerSessionId?: string;
  mode: HistoryTransferMode;
  recentTurns: number;
  maxChars: number;
  redactSecrets: boolean;
}
export interface HandoffHistoryPreview {
  status:
    "ready" | "unavailable" | "ambiguous" | "malformed" | "permission_denied";
  source: string;
  sourceLabel: string;
  conversationAvailable: boolean;
  providerSessionId?: string;
  content: string;
  charCount: number;
  messageCount: number;
  redactionCount: number;
  omittedCount: number;
  warning?: string;
  detail?: string;
}

export async function startNativeSession(
  input: {
    sessionId: string;
    provider: Provider;
    cwd: string;
    resumeId?: string;
    mode?: import("../types").SessionMode;
    model?: string;
    initialPrompt?: string;
    cols: number;
    rows: number;
    cliOverrides?: {
      executablePath?: string;
      extraArgs: string[];
      environment: CliEnvironmentOverride[];
    };
  },
  onEvent: (event: PtyEvent) => void,
) {
  if (!isTauri()) return false;
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return invoke<boolean>("start_session", { request: input, onEvent: channel });
}
export async function probeCli(input: {
  provider: Provider;
  executablePath?: string;
  extraArgs?: string[];
}) {
  if (!isTauri())
    return { provider: input.provider, installed: false } satisfies SystemTool;
  return invoke<SystemTool>("probe_cli", {
    provider: input.provider,
    executablePath: input.executablePath,
    extraArgs: input.extraArgs ?? [],
  });
}
export async function writeWorkflowReport(
  projectRoot: string,
  relativePath: string,
  content: string,
) {
  if (!isTauri()) return relativePath;
  return invoke<string>("write_workflow_report", {
    projectRoot,
    relativePath,
    content,
  });
}
export async function attachNativeSession(
  sessionId: string,
  onEvent: (event: PtyEvent) => void,
) {
  if (!isTauri()) return false;
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return invoke<boolean>("attach_session", { sessionId, onEvent: channel });
}
export async function writeNativeSession(sessionId: string, data: string) {
  if (!isTauri()) return;
  await invoke("write_session", {
    sessionId,
    data: Array.from(new TextEncoder().encode(data)),
  });
}
export async function resizeNativeSession(
  sessionId: string,
  cols: number,
  rows: number,
) {
  if (isTauri()) await invoke("resize_session", { sessionId, cols, rows });
}
export async function stopNativeSession(sessionId: string) {
  if (isTauri()) await invoke("stop_session", { sessionId });
}
export async function prepareHandoffHistory(
  request: HandoffHistoryRequest,
): Promise<HandoffHistoryPreview> {
  if (!isTauri())
    return {
      status: "unavailable",
      source: "none",
      sourceLabel: "No history source",
      conversationAvailable: false,
      content: "",
      charCount: 0,
      messageCount: 0,
      redactionCount: 0,
      omittedCount: 0,
      detail: "Conversation handoff requires the desktop app.",
    };
  return invoke("prepare_handoff_history", { request });
}
export async function deleteSessionTranscript(sessionId: string) {
  if (isTauri()) await invoke("delete_session_transcript", { sessionId });
}

let toolCache: SystemTool[] | undefined;
let toolRequest: Promise<SystemTool[]> | undefined;

export function cachedTools() {
  return toolCache;
}

export async function detectTools(force = false): Promise<SystemTool[]> {
  if (!force && toolCache) return toolCache;
  if (!force && toolRequest) return toolRequest;
  const request = isTauri()
    ? invoke<SystemTool[]>("detect_tools")
    : Promise.resolve([
        ...PROVIDER_IDS.map((provider) => ({ provider, installed: false })),
        { provider: "github" as const, installed: false },
      ]);
  toolRequest = request;
  try {
    const tools = await request;
    if (toolRequest === request) {
      toolCache = tools;
      toolRequest = undefined;
    }
    return tools;
  } catch (error) {
    if (toolRequest === request) toolRequest = undefined;
    throw error;
  }
}
export async function loadWorkspace(): Promise<WorkspaceSnapshot | null> {
  return isTauri() ? invoke("load_workspace") : null;
}
export async function saveWorkspace(snapshot: WorkspaceSnapshot) {
  if (isTauri()) await invoke("save_workspace", { snapshot });
}
export async function inspectRepository(
  path: string,
): Promise<RepositoryOverview> {
  if (!isTauri())
    return {
      isRepository: false,
      commits: [],
      pullRequests: [],
      githubAuthenticated: false,
      error: "Repository inspection requires the desktop app.",
    };
  return invoke("inspect_repository", { path });
}

const GIT_REPOSITORY_CACHE_MS = 15_000;
const gitRepositoryCache = new Map<
  string,
  { state: GitRepositoryState; loadedAt: number }
>();
const gitRepositoryRequests = new Map<
  string,
  Promise<GitRepositoryState>
>();

function gitRepositoryCacheKey(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function cachedGitRepository(path: string) {
  return gitRepositoryCache.get(gitRepositoryCacheKey(path))?.state;
}

export function cacheGitRepository(path: string, state: GitRepositoryState) {
  gitRepositoryCache.set(gitRepositoryCacheKey(path), {
    state,
    loadedAt: Date.now(),
  });
}

export async function loadGitRepository(
  path: string,
  force = false,
): Promise<GitRepositoryState> {
  if (!isTauri())
    return {
      isRepository: false,
      detached: false,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      rebaseInProgress: false,
      cherryPickInProgress: false,
      revertInProgress: false,
      files: [],
      branches: [],
      stashes: [],
      tags: [],
      remotes: [],
      commits: [],
      pullRequests: [],
      githubAuthenticated: false,
      error: "Git management requires the desktop app.",
    };
  const key = gitRepositoryCacheKey(path);
  const cached = gitRepositoryCache.get(key);
  if (!force && cached && Date.now() - cached.loadedAt < GIT_REPOSITORY_CACHE_MS)
    return cached.state;
  const pending = gitRepositoryRequests.get(key);
  if (pending) return pending;
  const request = invoke<GitRepositoryState>("git_repository_state", { path })
    .then((state) => {
      cacheGitRepository(path, state);
      return state;
    })
    .finally(() => {
      if (gitRepositoryRequests.get(key) === request)
        gitRepositoryRequests.delete(key);
    });
  gitRepositoryRequests.set(key, request);
  return request;
}
export async function loadGitDiff(
  path: string,
  file?: string,
  staged = false,
): Promise<GitDiff> {
  if (!isTauri())
    return {
      path: file,
      staged,
      binary: false,
      truncated: false,
      content: "",
    };
  return invoke("git_diff", { path, file, staged });
}
export async function runGitOperation(path: string, operation: GitOperation) {
  if (!isTauri()) throw new Error("Git management requires the desktop app.");
  const result = await invoke<{ output: string; state: GitRepositoryState }>(
    "git_execute",
    {
      path,
      operation,
    },
  );
  cacheGitRepository(path, result.state);
  return result;
}
export async function createGitReviewPrompt(path: string, content: string) {
  if (!isTauri()) throw new Error("AI Git review requires the desktop app.");
  return invoke<string>("git_create_review_prompt", { path, content });
}
export async function deleteGitReviewPrompt(
  path: string,
  promptPath: string,
) {
  if (isTauri())
    await invoke("git_delete_review_prompt", { path, promptPath });
}
export async function loadUsage(query: UsageQuery = {}) {
  return isTauri()
    ? invoke<UsageRecord[]>("query_usage", { query })
    : Promise.resolve([]);
}
export async function recordUsage(record: UsageRecord) {
  if (isTauri()) await invoke("record_usage", { record });
}
export async function loadUsageConnectors() {
  return isTauri()
    ? invoke<UsageConnector[]>("usage_connectors")
    : Promise.resolve([]);
}
export async function saveUsageConnector(
  connector: UsageConnector,
  secret?: string,
) {
  if (!isTauri()) return connector;
  return invoke<UsageConnector>("save_usage_connector", {
    connector,
    secret,
  });
}
export async function deleteUsageCredential(id: string) {
  if (isTauri()) await invoke("delete_usage_credential", { id });
}
export async function syncLocalUsage() {
  if (!isTauri())
    return {
      connectorId: "local",
      status: "idle",
      recordsImported: 0,
    } satisfies UsageSyncStatus;
  return invoke<UsageSyncStatus>("sync_local_usage");
}
export async function syncUsageConnector(id: string) {
  if (!isTauri()) throw new Error("Usage sync requires the desktop app.");
  return invoke<UsageSyncStatus>("sync_usage_connector", { id });
}
export async function chooseDirectory() {
  if (!isTauri()) return null;
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
export async function revealPath(path: string) {
  if (isTauri()) await openPath(path);
}
export async function launchUrl(url: string) {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
