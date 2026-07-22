import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ExternalLink,
  MonitorDot,
  RefreshCw,
  Send,
} from "./Icon";
import { isTauri, launchUrl } from "../lib/native";
import {
  mountNativeBrowser,
  type NativeBrowserHandle,
} from "../lib/nativeBrowser";
import { sessionRuntime } from "../lib/sessionRuntime";
import { useCoDesStore } from "../store";

function normalizeUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS previews are supported.");
  return url.toString();
}

export function BrowserWorkspace({
  topbar,
  active,
}: {
  topbar: React.ReactNode;
  active: boolean;
}) {
  const state = useCoDesStore();
  const [url, setUrl] = useState(state.settings.browserUrl);
  const [loadedUrl, setLoadedUrl] = useState(url);
  const [engine, setEngine] = useState<"native" | "inspectable">(
    isTauri() ? "native" : "inspectable",
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [inspect, setInspect] = useState(false);
  const [context, setContext] = useState("No element selected yet.");
  const [error, setError] = useState("");
  const [activated, setActivated] = useState(active);
  const frame = useRef<HTMLIFrameElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const nativeHandle = useRef<NativeBrowserHandle | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (active) setActivated(true);
    void nativeHandle.current
      ?.setVisible(active && engine === "native")
      .catch(() => undefined);
  }, [active, engine]);
  useEffect(() => {
    if (!activated || !slot.current || !isTauri() || engine !== "native")
      return;
    let disposed = false;
    let mounted: NativeBrowserHandle | null = null;
    void mountNativeBrowser(slot.current, loadedUrl)
      .then(async (handle) => {
        mounted = handle;
        if (disposed) void handle?.close();
        else {
          nativeHandle.current = handle;
          await handle?.setVisible(activeRef.current);
        }
      })
      .catch((e) => setError(`Could not open native preview: ${String(e)}`));
    return () => {
      disposed = true;
      nativeHandle.current = null;
      void mounted?.close().catch(() => undefined);
    };
  }, [engine, activated]);
  useEffect(() => {
    if (!inspect || engine !== "inspectable") return;
    let doc: Document | undefined;
    try {
      doc = frame.current?.contentDocument ?? undefined;
    } catch {
      setError(
        "This page blocks same-origin inspection. Use URL context or run it on the same origin.",
      );
      return;
    }
    if (!doc) return;
    const click = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const element = event.target as HTMLElement;
      const id = element.id ? `#${CSS.escape(element.id)}` : "";
      const classes = [...element.classList]
        .slice(0, 3)
        .map((v) => `.${CSS.escape(v)}`)
        .join("");
      const rect = element.getBoundingClientRect();
      setContext(
        `${element.tagName.toLowerCase()}${id}${classes}\n“${element.innerText?.trim().slice(0, 180) || element.getAttribute("aria-label") || "No visible text"}”\n${Math.round(rect.width)} × ${Math.round(rect.height)} at ${Math.round(rect.x)}, ${Math.round(rect.y)}`,
      );
    };
    doc.addEventListener("click", click, true);
    return () => doc?.removeEventListener("click", click, true);
  }, [inspect, loadedUrl, engine, reloadKey]);
  function navigate() {
    try {
      const next = normalizeUrl(url);
      setError("");
      setUrl(next);
      setLoadedUrl(next);
      state.updateSettings({ browserUrl: next });
      if (engine === "native")
        void nativeHandle.current
          ?.navigate(next)
          .catch((e) => setError(String(e)));
    } catch (e) {
      setError(String(e));
    }
  }
  async function sendContext() {
    const active = state.sessions.find((s) => s.id === state.activeSessionId);
    if (!active) {
      state.setMessage("Open an agent session before sending browser context.");
      return;
    }
    try {
      await sessionRuntime.prompt(
        active.id,
        `Browser context\nURL: ${loadedUrl}\n${context}`,
      );
      state.setMessage(`Context sent to ${active.title}.`);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main
      className={`browser-main ${active ? "active" : "browser-main-hidden"}`}
      aria-hidden={!active}
    >
      {topbar}
      <div className="browser-chrome">
        <div className="browser-controls">
          <button
            className="icon-button"
            title="Back"
            onClick={() =>
              engine === "native"
                ? void nativeHandle.current?.back()
                : frame.current?.contentWindow?.history.back()
            }
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="icon-button"
            title="Forward"
            onClick={() =>
              engine === "native"
                ? void nativeHandle.current?.forward()
                : frame.current?.contentWindow?.history.forward()
            }
          >
            <ChevronRight size={14} />
          </button>
          <button
            className="icon-button"
            onClick={() => {
              if (engine === "inspectable") {
                frame.current?.contentWindow?.location.reload();
                setReloadKey((v) => v + 1);
              } else void nativeHandle.current?.reload();
            }}
          >
            <RefreshCw size={14} />
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate();
            }}
          >
            <MonitorDot size={14} />
            <input
              aria-label="Browser URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </form>
          {isTauri() && (
            <select
              aria-label="Preview engine"
              value={engine}
              onChange={(e) => {
                setEngine(e.target.value as typeof engine);
                setInspect(false);
              }}
            >
              <option value="native">Native</option>
              <option value="inspectable">Inspectable iframe</option>
            </select>
          )}
          <button
            className={inspect ? "inspect active" : "inspect"}
            disabled={engine === "native"}
            onClick={() => {
              setInspect((v) => !v);
              setContext(
                engine === "native"
                  ? "Native previews remain isolated; only URL context is available."
                  : `Inspection armed for ${loadedUrl}. Click an element in a same-origin page.`,
              );
            }}
          >
            <CircleDot size={14} />
            Inspect
          </button>
          <button
            className="icon-button"
            title="Open externally"
            onClick={() => void launchUrl(loadedUrl)}
          >
            <ExternalLink size={14} />
          </button>
        </div>
        {error && <div className="browser-error">{error}</div>}
        <div className="browser-canvas">
          <div className="browser-preview" ref={slot}>
            {engine === "inspectable" && (
              <iframe
                key={`${loadedUrl}-${reloadKey}`}
                ref={frame}
                src={loadedUrl}
                title="CoDes browser preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            )}
          </div>
          <aside className="element-context">
            <div>
              <CircleDot size={14} />
              <strong>Element context</strong>
            </div>
            <p>{context}</p>
            <code>URL: {loadedUrl}</code>
            <button
              className="primary-button"
              onClick={() => void sendContext()}
            >
              <Send size={14} />
              Send to active agent
            </button>
          </aside>
        </div>
      </div>
    </main>
  );
}
