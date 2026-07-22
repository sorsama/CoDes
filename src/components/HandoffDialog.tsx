import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, X } from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { asBracketedTerminalPaste, buildHandoffPrompt } from "../lib/handoff";
import {
  deleteSessionTranscript,
  prepareHandoffHistory,
  type HandoffHistoryPreview,
} from "../lib/native";
import { providerMeta } from "../lib/providers";
import { sessionRuntime } from "../lib/sessionRuntime";
import { useCoDesStore } from "../store";
import type { AgentSession, HistoryTransferMode, Provider } from "../types";

const modes: Array<{ id: HistoryTransferMode; label: string; detail: string }> =
  [
    {
      id: "conversation",
      label: "Conversation",
      detail: "User and assistant messages only",
    },
    {
      id: "visible",
      label: "Full visible",
      detail: "Visible terminal output and tools",
    },
    {
      id: "recent",
      label: "Recent",
      detail: "Newest conversation or terminal context",
    },
  ];

export function HandoffDialog({
  session,
  provider,
  onClose,
}: {
  session: AgentSession;
  provider: Provider;
  onClose: () => void;
}) {
  const state = useCoDesStore();
  const [mode, setMode] = useState<HistoryTransferMode>(
    state.settings.handoffHistoryMode,
  );
  const [recentTurns, setRecentTurns] = useState(
    state.settings.handoffRecentTurns,
  );
  const [maxChars, setMaxChars] = useState(state.settings.handoffMaxChars);
  const [redactSecrets, setRedactSecrets] = useState(
    state.settings.handoffRedactSecrets,
  );
  const [preview, setPreview] = useState<HandoffHistoryPreview>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setPreview(undefined);
    setError("");
    const timer = window.setTimeout(() => {
      void prepareHandoffHistory({
        sessionId: session.id,
        provider: session.provider,
        cwd: session.cwd,
        startedAt: session.startedAt ?? session.createdAt,
        providerSessionId: session.providerSessionId,
        mode,
        recentTurns,
        maxChars,
        redactSecrets,
      })
        .then((result) => {
          if (current) {
            setPreview(result);
            if (
              result.providerSessionId &&
              result.providerSessionId !== session.providerSessionId
            )
              state.updateSession(session.id, {
                providerSessionId: result.providerSessionId,
                historySource: result.source,
              });
          }
        })
        .catch((cause) => {
          if (current) setError(String(cause));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 160);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [
    session.id,
    session.provider,
    session.cwd,
    session.startedAt,
    session.createdAt,
    session.providerSessionId,
    mode,
    recentTurns,
    maxChars,
    redactSecrets,
  ]);

  async function start() {
    if (!preview || preview.status !== "ready") return;
    setStarting(true);
    setError("");
    const label = providerMeta(provider).label;
    const id = state.addSession(provider, `${session.title} · ${label}`, {
      projectId: session.projectId,
      cwd: session.cwd,
    });
    const next = useCoDesStore
      .getState()
      .sessions.find((item) => item.id === id);
    if (!next) {
      setError("Could not create the handoff session.");
      setStarting(false);
      return;
    }
    try {
      await sessionRuntime.ensure(next);
      await sessionRuntime.send(
        id,
        asBracketedTerminalPaste(
          buildHandoffPrompt(session, provider, preview),
        ),
        false,
      );
      const detail = `Continued with ${label} using ${preview.sourceLabel}${preview.omittedCount ? `; ${preview.omittedCount} older message(s) omitted` : ""}.`;
      state.addEvent({
        sessionId: session.id,
        type: "status",
        title: "Provider handoff",
        detail,
      });
      state.addEvent({
        sessionId: id,
        type: "status",
        title: "Handoff received",
        detail: `Imported context from ${providerMeta(session.provider).label}.`,
      });
      state.setMessage(`Handoff started with ${label}.`);
      onClose();
    } catch (cause) {
      await sessionRuntime.stop(id).catch(() => undefined);
      await deleteSessionTranscript(id).catch(() => undefined);
      state.closeSession(id);
      setError(String(cause));
      setStarting(false);
    }
  }

  const ready = preview?.status === "ready";
  return (
    <div
      className="handoff-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !starting) onClose();
      }}
    >
      <section
        className="handoff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
      >
        <header>
          <span className="handoff-mark">
            <ArrowRightLeft />
          </span>
          <div>
            <small>Cross-provider handoff</small>
            <h2 id="handoff-title">
              Continue with {providerMeta(provider).label}
            </h2>
            <p>
              <ProviderIcon provider={session.provider} compact />
              {providerMeta(session.provider).label}
              <span>→</span>
              <ProviderIcon provider={provider} compact />
              {providerMeta(provider).label}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Cancel handoff"
            disabled={starting}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="handoff-body">
          <fieldset className="handoff-modes">
            <legend>History to transfer</legend>
            {modes.map((item) => {
              const disabled =
                item.id === "conversation" &&
                preview &&
                !preview.conversationAvailable &&
                mode !== "conversation";
              return (
                <label
                  className={mode === item.id ? "active" : ""}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="handoff-mode"
                    value={item.id}
                    checked={mode === item.id}
                    disabled={disabled}
                    onChange={() => setMode(item.id)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="handoff-options">
            {mode === "recent" && (
              <label>
                <span>Recent turns</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={recentTurns}
                  onChange={(event) =>
                    setRecentTurns(
                      Math.max(
                        1,
                        Math.min(50, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
            )}
            <label>
              <span>Transfer limit</span>
              <input
                type="number"
                min="1024"
                max="250000"
                step="1000"
                value={maxChars}
                onChange={(event) =>
                  setMaxChars(
                    Math.max(
                      1_024,
                      Math.min(250_000, Number(event.target.value) || 1_024),
                    ),
                  )
                }
              />
              <small>characters</small>
            </label>
            <label className="handoff-redact">
              <input
                type="checkbox"
                checked={redactSecrets}
                onChange={(event) => setRedactSecrets(event.target.checked)}
              />
              <span>Redact likely credentials</span>
            </label>
          </div>
          <section className="handoff-preview">
            <header>
              <div>
                <strong>Preview</strong>
                <small>
                  {loading
                    ? "Reading history…"
                    : ready
                      ? `${preview.sourceLabel} · ${preview.messageCount} message(s) · ${preview.charCount.toLocaleString()} characters`
                      : "History unavailable"}
                </small>
              </div>
              {ready && <span>{preview.redactionCount} redacted</span>}
            </header>
            {loading ? (
              <div className="handoff-loading">
                Preparing a safe local preview…
              </div>
            ) : ready ? (
              <textarea
                readOnly
                aria-label="Transferred history preview"
                value={preview.content}
              />
            ) : (
              <div className="handoff-issue">
                <AlertTriangle />
                <span>
                  <strong>
                    {preview?.status.replace("_", " ") ??
                      "Could not read history"}
                  </strong>
                  <small>{preview?.detail ?? error}</small>
                  {mode === "conversation" && (
                    <button onClick={() => setMode("visible")}>
                      Use visible terminal history
                    </button>
                  )}
                </span>
              </div>
            )}
            {preview?.warning && (
              <p className="handoff-warning">
                <AlertTriangle />
                {preview.warning}
              </p>
            )}
          </section>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer>
          <button
            className="secondary-button"
            disabled={starting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!ready || loading || starting}
            onClick={() => void start()}
          >
            {starting
              ? "Starting…"
              : `Continue with ${providerMeta(provider).label}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
