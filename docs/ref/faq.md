# FAQ

## General

### What is CoDes?

CoDes is an open-source, cross-platform desktop workspace for running multiple coding-agent CLIs side by side. It combines real PTY terminals, project management, a Git workbench, Kanban tasks, multi-CLI workflows, usage tracking, and encrypted peer sharing in a single application.

### Is CoDes affiliated with OpenAI, Anthropic, Google, etc.?

No. CoDes is an independent project and is not affiliated with OpenAI, Anthropic, Google, xAI, DeepSeek, Alibaba, or any other provider.

### What platforms does CoDes support?

Windows, macOS, and Linux. The exact support matrix matches Tauri 2's platform support.

## Installation & Setup

### What are the system requirements?

- Node.js 24+
- Rust stable (latest toolchain)
- Platform-specific Tauri prerequisites (WebView2 on Windows, Xcode CLT on macOS, webkit2gtk on Linux)
- At least one installed agent CLI

### How do I install CoDes?

Currently CoDes is installed from source:
```sh
git clone <repo-url>
cd codes
npm install
npm run tauri dev
```

### A provider isn't showing up in the launcher

1. Verify the CLI binary is installed — run `<binary> --version` in your terminal
2. Make sure it's on your `PATH`
3. Restart CoDes or trigger a re-scan via the session launcher

### Does CoDes store my API keys or provider credentials?

No. CoDes never stores provider credentials. Each provider CLI retains ownership of its own authentication. Optional usage API keys are stored in your OS credential vault (via `keyring`), not in CoDes configuration files or database.

## Sessions

### What's the difference between session modes?

| Mode | Use Case |
|---|---|
| **Interactive** | Normal terminal — you type, the agent responds |
| **Auto** | Autonomous execution with minimal prompting |
| **Plan** | Read-only mode for reviews and proposals |
| **Full Access** | Unattended execution (maps to provider's `--yes` flag) |

### Can I resume a session?

If the provider supports resume IDs, CoDes will automatically reconnect to the previous session context on relaunch.

### My session failed — what happened?

Check the session status and any error output in the terminal. Common causes:
- Provider CLI not authenticated
- Working directory no longer exists
- Provider process crashed or was killed externally
- Resource limits (memory, disk space)

### How do I share terminal output?

Use the **Handoff** dialog to transfer session context to a new session, or use **Live Sharing** for real-time peer sharing.

## Git Workbench

### Does CoDes support Git submodules?

The Git workbench operates on the repository root. Submodule operations are not currently exposed in the UI but can be managed via the terminal.

### Can I force push?

No. Force push, hard reset, and automatic conflict resolution are intentionally unavailable for safety.

### How do AI commit proposals work?

CoDes reads the staged diff and sends it to an installed provider in **plan** mode. The provider suggests a commit message. You can review, edit, and then commit.

## Workflows

### How many stages can a workflow have?

There is no hard limit, but practical workflows have 2–5 stages. More stages increase complexity and potential failure points.

### What happens if a workflow stage fails?

CoDes can automatically retry the failed stage (configurable retry count) or enter a **repair loop** that attempts to fix the issue using the failed stage's output as context.

### Can I use different providers for each stage?

Yes. Each stage can use a different provider, model, mode, and CLI profile. The built-in workflow uses Codex (plan) → Antigravity (implement) → Reasonix (verify).

## Usage Inspector

### Where does usage data come from?

Two sources:
1. **Local CLI records** — parsed from each provider's local log files
2. **Official API connectors** — direct queries to provider APIs (when you configure credentials)

### Are my API connector keys safe?

Yes. They are stored in your OS credential vault (via `keyring`), not in CoDes files or SQLite.

## Sharing

### Is my shared session data encrypted?

Yes. Session data is encrypted with AES-GCM before it reaches the signaling relay. The relay never sees unencrypted content.

### Can the peer control my terminal?

Only if you explicitly grant **write permission**. This is disabled by default and can be toggled at any time.

## Themes

### Can I create my own theme?

Yes. Duplicate a built-in theme and edit the semantic tokens in the Theme Studio. Changes apply live.

### Can I share themes?

Yes. Export your theme as JSON and share the file. Other users can import it.

## Troubleshooting

### CoDes won't start

Check:
1. All prerequisites are installed (Node.js 24+, Rust, Tauri deps)
2. `npm install` completed without errors
3. No other CoDes instance is running (check task manager)
4. Port 1420 (Vite) is not in use by another application

### The terminal shows garbled output

This is rare with xterm.js + binary streaming. Try:
1. Resizing the terminal pane
2. Stopping and restarting the session
3. Checking if the issue reproduces in a standalone terminal

### Database errors

If you see SQLite errors, try deleting the database file (located in your platform's app data directory for `com.codes.desktop`). CoDes will recreate it on next launch with fresh migrations.

### How do I report a bug?

Open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or logs (if applicable)
- Your OS and CoDes version

For security issues, use the private reporting process in [SECURITY.md](../SECURITY.md).
