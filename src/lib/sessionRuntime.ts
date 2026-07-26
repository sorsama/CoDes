import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AgentSession } from "../types";
import { useCoDesStore } from "../store";
import {
  isTauri,
  resizeNativeSession,
  recordUsage,
  startNativeSession,
  stopNativeSession,
  writeNativeSession,
  type PtyEvent,
} from "./native";

type Listener = (event: PtyEvent) => void;
type TerminalSize = { cols: number; rows: number };
type Runtime = {
  session: AgentSession;
  listeners: Set<Listener>;
  outputListeners: Set<(data: string) => void>;
  starting?: Promise<void>;
  connected: boolean;
  decoder: TextDecoder;
  approvalSeen: boolean;
  size: TerminalSize;
  generation: number;
  inspectBuffer: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costAmount?: number;
  };
};
const runtimes = new Map<string, Runtime>();

async function notify(title: string, body: string) {
  const settings = useCoDesStore.getState().settings;
  if (!settings.notifications || !isTauri()) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

function recordStatus(
  session: AgentSession,
  status: AgentSession["status"],
  detail: string,
) {
  const store = useCoDesStore.getState();
  const previous = store.sessions.find(
    (item) => item.id === session.id,
  )?.status;
  store.updateSession(session.id, {
    status,
    unread: store.activeSessionId !== session.id,
    exitedAt:
      status === "completed" || status === "failed" ? Date.now() : undefined,
  });
  if (previous === status) return;
  store.addEvent({
    sessionId: session.id,
    type: status === "failed" ? "failure" : "status",
    title: status.replace("_", " "),
    detail,
  });
  if (status === "completed" || status === "failed") {
    store.addAlert({
      projectId: session.projectId,
      sessionId: session.id,
      kind: status,
      title: `${session.title} ${status}`,
      detail,
    });
    void notify(`CoDes · ${session.title}`, detail);
  }
}

function inspectOutput(runtime: Runtime, text: string) {
  const clean = `${runtime.inspectBuffer}${text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, " ")}`;
  runtime.inspectBuffer = clean.slice(-2_000);
  if (
    !runtime.approvalSeen &&
    /(?:approval required|permission required|allow this action|proceed\?\s*\[?y\/n)/i.test(
      clean,
    )
  ) {
    runtime.approvalSeen = true;
    const store = useCoDesStore.getState();
    store.updateSession(runtime.session.id, {
      status: "input_required",
      unread: store.activeSessionId !== runtime.session.id,
    });
    store.addEvent({
      sessionId: runtime.session.id,
      type: "approval",
      title: "Input required",
      detail:
        clean.trim().slice(0, 240) || "The provider is waiting for approval.",
    });
    store.addAlert({
      projectId: runtime.session.projectId,
      sessionId: runtime.session.id,
      kind: "approval",
      title: `${runtime.session.title} needs input`,
      detail: "Open the session to review the provider request.",
    });
    void notify(`CoDes · Input required`, runtime.session.title);
  }
  const context = clean.match(/(?:context(?: used)?[: ]+)\s*(\d{1,3})%/i);
  if (context)
    useCoDesStore
      .getState()
      .updateSession(runtime.session.id, {
        contextPercent: Math.min(100, Number(context[1])),
      });
  const cost = clean.match(
    /(?:total cost|session cost)[: ]+\$([0-9]+(?:\.[0-9]+)?)/i,
  );
  if (cost)
    useCoDesStore
      .getState()
      .updateSession(runtime.session.id, { cost: Number(cost[1]) });
  const tokenPatterns = {
    inputTokens: /(?:input|prompt)[ _-]?tokens?[: ]+([0-9][0-9,]*)/i,
    outputTokens: /(?:output|completion)[ _-]?tokens?[: ]+([0-9][0-9,]*)/i,
    cachedTokens: /(?:cached|cache read)[ _-]?(?:input )?tokens?[: ]+([0-9][0-9,]*)/i,
    reasoningTokens: /(?:reasoning|thinking)[ _-]?tokens?[: ]+([0-9][0-9,]*)/i,
    totalTokens: /total[ _-]?tokens?[: ]+([0-9][0-9,]*)/i,
  } as const;
  let usageChanged = false;
  for (const [key, pattern] of Object.entries(tokenPatterns) as Array<
    [keyof typeof runtime.usage, RegExp]
  >) {
    const match = clean.match(pattern);
    if (!match) continue;
    const value = Number(match[1].split(",").join(""));
    if (Number.isFinite(value) && runtime.usage[key] !== value) {
      runtime.usage[key] = value;
      usageChanged = true;
    }
  }
  if (cost) {
    runtime.usage.costAmount = Number(cost[1]);
    usageChanged = true;
  }
  if (usageChanged) {
    const usage = runtime.usage;
    void recordUsage({
      id: `terminal:${runtime.session.id}`,
      externalId: runtime.session.id,
      provider: runtime.session.provider,
      product: providerProduct(runtime.session.provider),
      model: runtime.session.model,
      projectId: runtime.session.projectId,
      sessionId: runtime.session.id,
      startedAt: runtime.session.startedAt ?? runtime.session.createdAt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens:
        usage.totalTokens ??
        (usage.inputTokens !== undefined || usage.outputTokens !== undefined
          ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
          : undefined),
      requestCount: 1,
      costAmount: usage.costAmount,
      costCurrency: usage.costAmount === undefined ? undefined : "USD",
      source: `${runtime.session.provider}-terminal`,
      sourceKind: "local_terminal",
      confidence: "provider_reported",
      syncedAt: Date.now(),
    }).catch(() => undefined);
  }
}

function providerProduct(provider: string) {
  return provider === "claude"
    ? "Claude Code"
    : provider === "codex"
      ? "Codex"
      : provider === "opencode"
        ? "OpenCode"
        : provider;
}

function dispatch(runtime: Runtime, event: PtyEvent) {
  if (event.event === "output") {
    const text = runtime.decoder.decode(new Uint8Array(event.data.bytes), {
      stream: true,
    });
    inspectOutput(runtime, text);
    runtime.outputListeners.forEach((listener) => listener(text));
    if (
      useCoDesStore.getState().sessions.find((s) => s.id === runtime.session.id)
        ?.status !== "input_required"
    )
      recordStatus(runtime.session, "working", "Provider output received.");
  } else if (event.event === "exit") {
    runtime.connected = false;
    recordStatus(
      runtime.session,
      event.data.code === 0 ? "completed" : "failed",
      `Process exited with ${event.data.code ?? "a signal"}.`,
    );
  } else {
    runtime.connected = false;
    recordStatus(runtime.session, "failed", event.data.message);
  }
  runtime.listeners.forEach((listener) => listener(event));
}

async function ensure(runtime: Runtime) {
  if (runtime.connected || runtime.starting) return runtime.starting;
  const generation = ++runtime.generation;
  const starting = (async () => {
    const handler = (event: PtyEvent) => {
      if (runtime.generation === generation) dispatch(runtime, event);
    };
    useCoDesStore.getState().updateSession(runtime.session.id, {
      status: "waiting",
      startedAt: Date.now(),
    });
    const created = await startNativeSession(
      {
        sessionId: runtime.session.id,
        provider: runtime.session.provider,
        cwd: runtime.session.cwd,
        resumeId: runtime.session.resumeId,
        mode: runtime.session.mode,
        model: runtime.session.model,
        initialPrompt: runtime.session.initialPrompt,
        cliOverrides: runtime.session.cliProfileId
          ? (() => {
              const profile = useCoDesStore
                .getState()
                .cliProfiles.find(
                  (item) => item.id === runtime.session.cliProfileId,
                );
              return profile
                ? {
                    executablePath: profile.executablePath,
                    extraArgs: profile.extraArgs,
                    environment: profile.environment,
                  }
                : undefined;
            })()
          : undefined,
        ...runtime.size,
      },
      handler,
    );
    if (created) {
      useCoDesStore
        .getState()
        .addEvent({
          sessionId: runtime.session.id,
          type: "status",
          title: "Session started",
          detail: `${runtime.session.provider} launched in ${runtime.session.cwd}`,
        });
    }
    if (runtime.generation !== generation) return;
    runtime.connected = true;
    await resizeNativeSession(
      runtime.session.id,
      runtime.size.cols,
      runtime.size.rows,
    );
  })()
    .catch((error) => {
      if (runtime.generation === generation)
        dispatch(runtime, { event: "error", data: { message: String(error) } });
    })
    .finally(() => {
      if (runtime.starting === starting) runtime.starting = undefined;
    });
  runtime.starting = starting;
  return runtime.starting;
}

function normalizeSize(size?: TerminalSize): TerminalSize {
  return {
    cols: Math.max(2, Math.floor(size?.cols ?? 120)),
    rows: Math.max(2, Math.floor(size?.rows ?? 32)),
  };
}

function getRuntime(session: AgentSession, size?: TerminalSize) {
  let runtime = runtimes.get(session.id);
  if (!runtime) {
    runtime = {
      session,
      listeners: new Set(),
      outputListeners: new Set(),
      connected: false,
      decoder: new TextDecoder(),
      approvalSeen: false,
      size: normalizeSize(size),
      generation: 0,
      inspectBuffer: "",
      usage: {},
    };
    runtimes.set(session.id, runtime);
  }
  runtime.session = session;
  if (size) runtime.size = normalizeSize(size);
  return runtime;
}

export const sessionRuntime = {
  subscribe(session: AgentSession, listener: Listener, size?: TerminalSize) {
    const runtime = getRuntime(session, size);
    runtime.listeners.add(listener);
    void ensure(runtime);
    return () => runtime.listeners.delete(listener);
  },
  subscribeOutput(session: AgentSession, listener: (data: string) => void) {
    const runtime = getRuntime(session);
    runtime.outputListeners.add(listener);
    void ensure(runtime);
    return () => runtime.outputListeners.delete(listener);
  },
  async send(sessionId: string, data: string, recordPrompt = false) {
    await writeNativeSession(sessionId, data);
    const runtime = runtimes.get(sessionId);
    if (runtime) runtime.approvalSeen = false;
    if (recordPrompt)
      useCoDesStore
        .getState()
        .addEvent({
          sessionId,
          type: "prompt",
          title: "Prompt sent",
          detail: data.trim().slice(0, 300),
        });
  },
  async prompt(sessionId: string, prompt: string) {
    await this.send(sessionId, `${prompt}\r`, true);
  },
  async stop(sessionId: string) {
    const runtime = runtimes.get(sessionId);
    if (runtime) {
      runtime.generation += 1;
      runtime.connected = false;
    }
    await stopNativeSession(sessionId);
    useCoDesStore
      .getState()
      .updateSession(sessionId, { status: "disconnected" });
  },
  async restart(session: AgentSession) {
    await this.stop(session.id);
    const runtime = getRuntime(session);
    runtime.approvalSeen = false;
    await ensure(runtime);
  },
  async ensure(session: AgentSession) {
    await ensure(getRuntime(session));
  },
  async resize(sessionId: string, cols: number, rows: number) {
    const runtime = runtimes.get(sessionId);
    if (!runtime) return;
    runtime.size = normalizeSize({ cols, rows });
    if (runtime.connected)
      await resizeNativeSession(
        sessionId,
        runtime.size.cols,
        runtime.size.rows,
      );
  },
};
