# CoDes Documentation

Welcome to the CoDes documentation. CoDes is an open-source, cross-platform desktop workspace for running multiple coding-agent CLIs side by side — Codex CLI, Claude Code, Antigravity CLI, OpenCode, Reasonix, Grok Build, Qwen Code, Aider, and Pi.

> **New to CoDes?** Start with the [Quickstart Guide](user/quickstart.md).

---

## User Guides

Practical walkthroughs for everyday use.

| Guide | What you'll learn |
|---|---|
| [Quickstart](user/quickstart.md) | Requirements, install, first launch, first session |
| [Projects & Workspaces](user/projects-workspaces.md) | Multi-project workspaces, switcher, icons, archive |
| [Sessions](user/sessions.md) | PTY terminals, tabs, split panes, swarm, modes, handoff |
| [Provider Setup](user/provider-setup.md) | Installing and authenticating all 9 providers |
| [Git Workbench](user/git-workbench.md) | Diffs, staging, commits, branches, PRs, AI proposals |
| [Kanban Tasks](user/kanban-tasks.md) | Task board, columns, Autopilot, session linking |
| [Workflows](user/workflows.md) | Multi-CLI pipelines, stages, repair loops, reports |
| [Usage Inspector](user/usage-inspector.md) | Token/cost tracking, API connectors, budget alerts |
| [Live Sharing](user/live-sharing.md) | Encrypted WebRTC peer sharing, relay setup |
| [Theme Studio](user/theme-studio.md) | Live theme editing, presets, import/export |
| [Browser Preview](user/browser-preview.md) | Child webview, iframe fallback, element capture |
| [Settings](user/settings.md) | App settings, notifications, profiles |

## Developer Docs

Architecture, extension guides, and reference material for contributors.

| Guide | What you'll learn |
|---|---|
| [Architecture](dev/architecture.md) | System design, data flow, process model |
| [Source Layout](dev/source-layout.md) | Annotated directory tree |
| [Adding a Provider](dev/adding-a-provider.md) | Register a new agent CLI in Rust + TypeScript |
| [Rust Backend](dev/rust-backend.md) | AppState, PTY manager, Git manager, migrations |
| [Frontend](dev/frontend.md) | React component tree, Zustand store, IPC wrappers |
| [Database Schema](dev/database-schema.md) | All SQLite tables, columns, constraints |
| [IPC Commands](dev/ipc-commands.md) | Tauri command catalog with signatures |
| [Testing](dev/testing.md) | Vitest, cargo test, smoke tests, CI |
| [Signaling Relay](dev/signaling-relay.md) | Self-hosted WebSocket relay for sharing |

## Reference

| Document | Description |
|---|---|
| [FAQ](ref/faq.md) | Frequently asked questions and troubleshooting |
| [Glossary](ref/glossary.md) | Terminology definitions |
| [Security Model](ref/security-model.md) | Credential isolation, Git safety, webview, encryption |
| [Changelog](CHANGELOG.md) | Release history |

---

## Quick Links

- [Project README](../README.md) — overview, feature matrix, development setup
- [Contributing Guide](../CONTRIBUTING.md)
- [Security Policy](../SECURITY.md)
- [Product & Design Principles](../PRODUCT.md)
- [GitHub Repository](https://github.com/your-org/codes) <!-- TODO: update URL -->
