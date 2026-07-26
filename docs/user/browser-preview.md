# Browser Preview

CoDes includes a browser preview that lets you view web pages and applications inside the workspace, isolated from the main application process.

## Overview

The browser preview provides:
- **Isolated child webview** — pages render in a separate Tauri webview process
- **Iframe fallback** — for same-origin content when a full webview isn't available
- **Element capture** — inspect and capture page elements

## Accessing Browser Preview

Open the **Browser** view from the sidebar navigation.

## Opening a URL

1. Enter a URL in the address bar
2. Press Enter or click **Go**
3. The page loads in the preview area

### Features

| Feature | Description |
|---|---|
| Address bar | URL input with navigation history |
| Back/Forward | Navigate through browsing history |
| Refresh | Reload the current page |
| DevTools | (If supported by the webview) |

## Webview Isolation

The browser preview uses Tauri's child-webview adapter, which:
- Loads pages in a **separate process** from the main CoDes window
- **Does not** expose a general application IPC bridge to the rendered page
- Prevents the rendered page from accessing CoDes internals

This means remote pages cannot:
- Read local files outside the webview
- Access the Zustand store or other app state
- Execute Tauri commands
- Communicate with provider sessions

## Iframe Fallback

When a full child webview is not available (e.g., on some Linux configurations), CoDes falls back to an iframe-based preview. The iframe mode:
- Works for same-origin content
- Has the same security restrictions as the webview mode
- Does not support DevTools

## Same-Origin Element Capture

The browser preview can capture elements from the loaded page when the page origin matches CoDes (development mode) or when CORS headers permit it. Use cases:
- Inspecting the rendered state of a local web app
- Taking screenshots of specific elements
- Debugging UI during development

## Limitations

- **No file picker** — the webview cannot open system file dialogs
- **No microphone/camera** — media devices are not exposed
- **No notifications** — web push notifications are blocked
- **No downloads** — file downloads are not supported

## See Also

- [Security Model](../ref/security-model.md) — webview isolation details
