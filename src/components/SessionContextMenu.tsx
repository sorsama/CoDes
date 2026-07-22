import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
} from "./Icon";
import { appConfirm, appPrompt } from "../lib/dialogs";
import {
  cachedTools,
  deleteSessionTranscript,
  detectTools,
  revealPath,
} from "../lib/native";
import { PROVIDER_IDS, providerMeta } from "../lib/providers";
import { sessionRuntime } from "../lib/sessionRuntime";
import { useCoDesStore } from "../store";
import { ProviderIcon } from "./ProviderIcon";
import type { AgentSession, Provider, SystemTool } from "../types";
import { HandoffDialog } from "./HandoffDialog";

export interface SessionMenuState {
  session: AgentSession;
  x: number;
  y: number;
  providerPicker?: boolean;
}
export function openSessionMenu(
  event: React.MouseEvent,
  session: AgentSession,
  open: (menu: SessionMenuState) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  open({ session, x: event.clientX, y: event.clientY });
}
export function openProviderHandoffMenu(
  event: React.MouseEvent,
  session: AgentSession,
  open: (menu: SessionMenuState) => void,
) {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  open({
    session,
    x: rect.right - 224,
    y: rect.bottom + 5,
    providerPicker: true,
  });
}

export function SessionContextMenu({
  menu,
  onClose,
}: {
  menu?: SessionMenuState;
  onClose: () => void;
}) {
  const state = useCoDesStore();
  const root = useRef<HTMLDivElement>(null);
  const [choosingProvider, setChoosingProvider] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<{
    session: AgentSession;
    provider: Provider;
  }>();
  const [tools, setTools] = useState<SystemTool[]>(() => cachedTools() ?? []);
  useEffect(() => {
    setChoosingProvider(menu?.providerPicker ?? false);
    if (menu)
      void detectTools()
        .then(setTools)
        .catch(() => undefined);
  }, [menu?.session.id, menu?.providerPicker]);
  useEffect(() => {
    if (!menu) return;
    const frame = requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus(),
    );
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!root.current || !["ArrowDown", "ArrowUp"].includes(event.key))
        return;
      const items = [
        ...root.current.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ];
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current <= 0 ? items.length : current) - 1;
      event.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);
  if (!menu)
    return handoffTarget ? (
      <HandoffDialog
        session={handoffTarget.session}
        provider={handoffTarget.provider}
        onClose={() => setHandoffTarget(undefined)}
      />
    ) : null;
  const session =
    state.sessions.find((item) => item.id === menu.session.id) ?? menu.session;
  const running = ["waiting", "working", "input_required"].includes(
    session.status,
  );
  const act = async (action: () => void | Promise<void>) => {
    onClose();
    try {
      await action();
    } catch (error) {
      state.setMessage(String(error));
    }
  };
  const rename = async () => {
    const title = (
      await appPrompt({
        title: "Rename session",
        detail: "Choose a short name that is easy to recognize in tabs.",
        inputLabel: "Session title",
        inputValue: session.title,
        confirmLabel: "Rename",
      })
    )?.trim();
    if (title) state.updateSession(session.id, { title });
  };
  const restart = async () => {
    if (
      await appConfirm({
        title: `Restart ${session.title}?`,
        detail:
          "The current process will stop and a fresh provider process will start in the same directory.",
        confirmLabel: "Restart session",
      })
    ) {
      await sessionRuntime.restart(session);
      state.setMessage(`${session.title} restarted.`);
    }
  };
  const close = async () => {
    if (
      running &&
      !(await appConfirm({
        title: `Close ${session.title}?`,
        detail:
          "The running provider process will be stopped before the tab closes.",
        confirmLabel: "Stop and close",
        tone: "danger",
      }))
    )
      return;
    await sessionRuntime.stop(session.id);
    await deleteSessionTranscript(session.id);
    state.closeSession(session.id);
  };
  return (
    <div
      ref={root}
      className={`session-context-menu ${choosingProvider ? "choosing-provider" : ""}`}
      role="menu"
      aria-label={`${session.title} actions`}
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 236)),
        top: Math.max(
          8,
          Math.min(menu.y, window.innerHeight - (choosingProvider ? 430 : 360)),
        ),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header>
        <span className={`status-dot ${session.status}`} />
        <span>
          <strong>{session.title}</strong>
          <small>{session.status.replace("_", " ")}</small>
        </span>
      </header>
      {choosingProvider ? (
        <section className="provider-handoff-picker">
          <button
            className="context-back"
            role="menuitem"
            onClick={() => setChoosingProvider(false)}
          >
            <ChevronLeft />
            <span>Session actions</span>
          </button>
          <p>
            <strong>Continue with</strong>
            <span>
              Choose what history to transfer before the new agent starts.
            </span>
          </p>
          <div>
            {PROVIDER_IDS.filter(
              (provider) => provider !== session.provider,
            ).map((provider) => {
              const tool = tools.find((item) => item.provider === provider);
              const unavailable = tools.length > 0 && !tool?.installed;
              return (
                <button
                  key={provider}
                  role="menuitem"
                  disabled={unavailable}
                  onClick={() => {
                    setHandoffTarget({ session, provider });
                    onClose();
                  }}
                >
                  <ProviderIcon provider={provider} compact />
                  <span>
                    <strong>{providerMeta(provider).label}</strong>
                    <small>
                      {unavailable ? "Not installed" : "Review handoff"}
                    </small>
                  </span>
                  <ChevronRight />
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <>
          <button
            role="menuitem"
            onClick={() =>
              void act(() => {
                state.setActiveSession(session.id);
              })
            }
          >
            <TerminalSquare />
            <span>Open session</span>
            <kbd>↵</kbd>
          </button>
          <button
            role="menuitem"
            disabled={running}
            onClick={() =>
              void act(async () => {
                state.setActiveSession(session.id);
                await sessionRuntime.ensure(session);
                state.setMessage(`${session.title} continued.`);
              })
            }
          >
            <Play />
            <span>Continue same provider</span>
          </button>
          <button
            role="menuitem"
            className="handoff-action"
            onClick={() => setChoosingProvider(true)}
          >
            <ProviderIcon provider={session.provider} compact />
            <span>Continue with another provider</span>
            <ChevronRight />
          </button>
          <button role="menuitem" onClick={() => void act(restart)}>
            <RotateCcw />
            <span>Restart session</span>
          </button>
          <div className="context-separator" />
          <button role="menuitem" onClick={() => void act(rename)}>
            <Copy />
            <span>Rename</span>
          </button>
          <button
            role="menuitem"
            onClick={() => void act(() => revealPath(session.cwd))}
          >
            <FolderOpen />
            <span>Reveal folder</span>
          </button>
          <button
            role="menuitem"
            disabled={!running}
            onClick={() =>
              void act(async () => {
                await sessionRuntime.stop(session.id);
                state.setMessage(`${session.title} stopped.`);
              })
            }
          >
            <Square />
            <span>Stop process</span>
          </button>
          <div className="context-separator" />
          <button
            role="menuitem"
            className="danger"
            onClick={() => void act(close)}
          >
            <Trash2 />
            <span>Close session</span>
          </button>
        </>
      )}
    </div>
  );
}
