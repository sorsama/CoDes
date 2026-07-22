import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type {
  HistoryTransferMode,
  Provider,
  RepositoryOverview,
  SystemTool,
  WorkspaceSnapshot,
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
  },
  onEvent: (event: PtyEvent) => void,
) {
  if (!isTauri()) return false;
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  await invoke("start_session", { request: input, onEvent: channel });
  return true;
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
