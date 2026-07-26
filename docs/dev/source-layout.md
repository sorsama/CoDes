# Source Layout

Annotated directory tree of the CoDes repository.

```
.
├── .github/                        # GitHub configuration
│   ├── workflows/
│   │   ├── ci.yml                  # CI: check, test, build on push/PR
│   │   └── release.yml            # Signed cross-platform release builds
│   ├── ISSUE_TEMPLATE/             # Issue templates
│   └── dependabot.yml             # Dependency update config
│
├── .reasonix/                      # Reasonix provider workspace metadata
│
├── .vscode/                        # Editor settings (launch tasks, recommendations)
│
├── docs/                           # Documentation (you are here)
│   ├── README.md                   # Landing page
│   ├── _sidebar.md                 # Navigation index
│   ├── CHANGELOG.md                # Release history
│   ├── images/                     # Documentation images
│   ├── user/                       # User guides
│   │   ├── quickstart.md
│   │   ├── projects-workspaces.md
│   │   ├── sessions.md
│   │   ├── provider-setup.md
│   │   ├── git-workbench.md
│   │   ├── kanban-tasks.md
│   │   ├── workflows.md
│   │   ├── usage-inspector.md
│   │   ├── live-sharing.md
│   │   ├── theme-studio.md
│   │   ├── browser-preview.md
│   │   └── settings.md
│   ├── dev/                        # Developer docs
│   │   ├── architecture.md
│   │   ├── source-layout.md
│   │   ├── adding-a-provider.md
│   │   ├── rust-backend.md
│   │   ├── frontend.md
│   │   ├── database-schema.md
│   │   ├── ipc-commands.md
│   │   ├── testing.md
│   │   └── signaling-relay.md
│   └── ref/                        # Reference
│       ├── faq.md
│       ├── glossary.md
│       └── security-model.md
│
├── public/                         # Static frontend assets
│   ├── icon.svg                    # CoDes application icon
│   └── cli-icon/                   # Provider CLI icons (PNG)
│
├── scripts/                        # Development scripts
│   ├── dev.mjs                     # Dev server launcher
│   └── tauri.mjs                   # Tauri wrapper script
│
├── services/                       # npm workspace services
│   └── signaling/                  # WebSocket signaling relay for sharing
│       ├── src/
│       │   └── server.ts           # Relay server: rate-limited, memory-only WS
│       ├── Dockerfile              # Containerized deployment
│       ├── .dockerignore
│       ├── package.json
│       └── tsconfig.json
│
├── src/                            # TypeScript/React frontend
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Root component (~68Kb)
│   ├── App.css                     # Global styles (~114Kb)
│   ├── store.ts                    # Zustand state store (~40Kb)
│   ├── types.ts                    # TypeScript interfaces
│   ├── lib/
│   │   ├── providers.ts            # Provider UI metadata (9 providers)
│   │   ├── native.ts               # Tauri IPC invoke/listen wrappers
│   │   ├── sessionRuntime.ts       # Runtime session management
│   │   ├── workflowAutomation.ts   # Multi-CLI workflow engine
│   │   ├── workflowModel.ts        # Workflow template types & helpers
│   │   ├── taskAutomation.ts       # Autopilot task runner
│   │   ├── dialogs.ts              # Dialog orchestration
│   │   ├── handoff.ts              # Session handoff logic
│   │   ├── persistence.ts          # State persistence helpers
│   │   ├── workspaceIcon.ts        # Workspace icon handling
│   │   └── nativeBrowser.ts        # Browser preview handler
│   ├── components/
│   │   ├── TerminalPane.tsx        # xterm.js terminal component
│   │   ├── WorkspaceHub.tsx        # Workspace layout hub
│   │   ├── GitWorkspace.tsx        # Git workbench UI (~50Kb)
│   │   ├── OverlayHub.tsx          # Overlay/dialog manager
│   │   ├── WorkflowHub.tsx         # Workflow management UI
│   │   ├── UsageInspector.tsx      # Usage inspector UI
│   │   ├── BrowserWorkspace.tsx    # Browser preview UI
│   │   ├── ProjectManagerDialog.tsx
│   │   ├── HandoffDialog.tsx       # Handoff transfer dialog
│   │   ├── SessionContextMenu.tsx  # Session right-click menu
│   │   ├── AppDialogHost.tsx       # App-level dialog container
│   │   ├── Icon.tsx                # Reusable icon component
│   │   ├── ProviderIcon.tsx        # Provider-specific icon
│   │   ├── TimelineEventIcon.tsx   # Timeline event icon
│   │   └── TimelineEventIcon.test.tsx
│   ├── sharing/
│   │   ├── client.ts               # WebRTC sharing client
│   │   ├── protocol.ts             # Sharing protocol implementation
│   │   ├── client.test.ts          # Client tests
│   │   └── protocol.test.ts        # Protocol tests
│   └── vite-env.d.ts              # Vite type declarations
│
├── src-tauri/                      # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs                 # Binary entry: calls codes_lib::run()
│   │   ├── lib.rs                  # Core app (~53Kb): AppState, SessionManager,
│   │   │                           #   SQLite schema, Tauri commands, PROVIDERS
│   │   ├── git_manager.rs          # Git workbench (~32Kb)
│   │   ├── history.rs              # Provider history parsers (~34Kb)
│   │   └── usage.rs               # Usage Inspector connectors (~38Kb)
│   ├── Cargo.toml                  # Rust dependencies
│   ├── tauri.conf.json             # Tauri app config (window, bundle, CSP, deep-links)
│   ├── capabilities/               # Tauri capability permissions
│   ├── icons/                      # Application icons (various sizes)
│   ├── build.rs                    # Tauri build script
│   └── .dev-target                 # Dev target file (generated)
│
├── dist/                           # Frontend build output (gitignored)
├── node_modules/                   # npm dependencies (gitignored)
├── index.html                      # Vite HTML entry point
├── package.json                    # npm workspace config
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript configuration
├── tsconfig.node.json              # TypeScript config for Node files
├── README.md                       # Project overview
├── CONTRIBUTING.md                 # Contribution guide
├── SECURITY.md                     # Security policy
├── PRODUCT.md                      # Product design principles
└── LICENSE                         # MIT License
```

## Key Files by Size

| File | Size | Purpose |
|---|---|---|
| `src/App.tsx` | ~68Kb | Main application component |
| `src/App.css` | ~114Kb | Global styles |
| `src/store.ts` | ~40Kb | Zustand state store |
| `src-tauri/src/lib.rs` | ~53Kb | Rust core (PTY, DB, commands) |
| `src-tauri/src/git_manager.rs` | ~32Kb | Git workbench |
| `src-tauri/src/history.rs` | ~34Kb | History parsers |
| `src-tauri/src/usage.rs` | ~38Kb | Usage connectors |
| `src/components/GitWorkspace.tsx` | ~50Kb | Git workbench UI |
| `src/sharing/client.ts` | ~8.7Kb | WebRTC sharing client |

## See Also

- [Architecture](architecture.md) — system design and data flow
- [Rust Backend](rust-backend.md) — deep dive into Rust core
- [Frontend](frontend.md) — React component architecture
