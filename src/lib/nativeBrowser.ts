import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native";

export interface NativeBrowserHandle {
  close: () => Promise<void>;
  setVisible: (visible: boolean) => Promise<void>;
  focus: () => Promise<void>;
  navigate: (url: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
}

export async function mountNativeBrowser(
  slot: HTMLElement,
  url: string,
): Promise<NativeBrowserHandle | null> {
  if (!isTauri()) return null;
  const label = `browser-${crypto.randomUUID()}`;
  const rect = slot.getBoundingClientRect();
  const webview = new Webview(getCurrentWindow(), label, {
    url,
    x: rect.left,
    y: rect.top,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    focus: false,
    incognito: false,
    zoomHotkeysEnabled: true,
  });
  const syncBounds = () => {
    const next = slot.getBoundingClientRect();
    void webview.setPosition(new LogicalPosition(next.left, next.top));
    void webview.setSize(
      new LogicalSize(Math.max(1, next.width), Math.max(1, next.height)),
    );
  };
  const observer = new ResizeObserver(syncBounds);
  observer.observe(slot);
  window.addEventListener("resize", syncBounds);
  await new Promise<void>((resolve, reject) => {
    webview.once("tauri://created", () => resolve());
    webview.once("tauri://error", (event) => reject(event.payload));
  });
  let closed = false;
  return {
    setVisible: async (visible) => {
      if (visible) await webview.show();
      else await webview.hide();
    },
    focus: () => webview.setFocus(),
    navigate: (nextUrl) =>
      invoke("browser_control", { label, action: "navigate", url: nextUrl }),
    back: () => invoke("browser_control", { label, action: "back" }),
    forward: () => invoke("browser_control", { label, action: "forward" }),
    reload: () => invoke("browser_control", { label, action: "reload" }),
    close: async () => {
      if (closed) return;
      closed = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);

      let hideError: unknown;
      try {
        await webview.hide();
      } catch (error) {
        hideError = error;
      }

      try {
        await webview.close();
      } catch (closeError) {
        throw closeError ?? hideError;
      }
    },
  };
}
