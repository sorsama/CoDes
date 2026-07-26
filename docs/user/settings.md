# Settings

Configure CoDes behavior and preferences.

## Accessing Settings

Open the **Settings** view from the sidebar navigation. Settings are organized into sections.

## General

### Language

Set the UI language. Currently English is the default and primary language.

### Notifications

Control desktop notification behavior:
- **Enable notifications** — master toggle for all notifications
- **Session complete** — notify when a session finishes
- **Session failure** — notify when a session fails
- **Workflow events** — notify on workflow stage completions and failures
- **Budget alerts** — notify when usage budgets are exceeded

Notifications use the Tauri notification plugin and respect the OS notification settings.

### Theme

Select the active theme from your installed themes. The dropdown shows:
- Built-in themes (CoDes Dark, CoDes Light)
- Custom themes created in the Theme Studio
- Imported themes

See [Theme Studio](theme-studio.md) for creating and editing themes.

## Session Defaults

Configure defaults for new sessions:
- **Default provider** — which provider is pre-selected
- **Default mode** — interactive, auto, plan, or full-access
- **Default model** — optional model override applied to all new sessions
- **Default CLI profile** — optional profile applied to all new sessions

## CLI Profiles

Manage CLI launch profiles:

| Setting | Description |
|---|---|
| Name | Human-readable label |
| Provider | Which agent CLI |
| Executable path | Override the binary location |
| Extra arguments | Additional CLI flags |
| Model | Force a specific model |
| Environment | Non-secret environment variables |

Profiles are useful for using development builds, testing different models, or passing provider-specific flags.

See [Provider Setup](provider-setup.md) for more on CLI profiles.

## Autopilot

Configure Autopilot behavior for the Kanban task board:
- **Enable Autopilot** — master toggle
- **Max parallel workers** — limit concurrent task execution (default: 2)
- **Default provider** — provider to use for new Autopilot tasks
- **Default mode** — session mode for Autopilot tasks

See [Kanban Tasks](kanban-tasks.md) for Autopilot details.

## Inspector

Configure Usage Inspector settings:
- **Auto-refresh interval** — how often API connectors refresh (in minutes)
- **Default time range** — default filter when opening the inspector
- **Budget alert thresholds** — percentages at which to alert

See [Usage Inspector](usage-inspector.md) for details.

## Sharing

Configure sharing defaults:
- **Default permissions** — view-only or write access for new shares
- **Relay URL** — custom signaling relay endpoint (default: CoDes public relay)
- **Room expiry** — how long sharing rooms remain active (in minutes)

See [Live Sharing](live-sharing.md) for details.

## Workspace

Workspace-level preferences:
- **Default project** — which project to open on startup
- **Restore last session** — reopen the last active project and its sessions on launch
- **Auto-archive** — automatically archive workspaces after a period of inactivity

## See Also

- [Quickstart](quickstart.md) — initial setup walkthrough
- [Theme Studio](theme-studio.md) — customize appearance
- [Provider Setup](provider-setup.md) — install and configure providers
- [Kanban Tasks](kanban-tasks.md) — Autopilot settings
