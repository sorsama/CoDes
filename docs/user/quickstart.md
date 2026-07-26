# Quickstart

Get CoDes up and running in minutes.

## Requirements

- **Node.js** 24+
- **Rust** stable (latest toolchain via [rustup](https://rustup.rs/))
- **Platform-specific Tauri prerequisites** — see the [Tauri v2 guide](https://v2.tauri.app/start/prerequisites/)
  - Windows: WebView2 (included in Windows 11 / recent Windows 10), Visual Studio build tools
  - macOS: Xcode Command Line Tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, etc.
- **At least one agent CLI** (e.g., `npm i -g @openai/codex`)

> CoDes never stores provider credentials — each CLI retains ownership of its own authentication.

## Install & Launch

```sh
git clone <repo-url>
cd codes
npm install
npm run tauri dev
```

This starts both the Vite dev server (frontend on port 1420) and the local signaling relay. The Tauri window opens automatically.

To run only the relay separately:

```sh
npm run relay:dev
```

## First Launch

When CoDes opens you'll see the default workspace with:

1. **Left sidebar** — workspace/project switcher, main navigation
2. **Main area** — the active view (dashboard, sessions, Git, etc.)
3. **Bottom panel** — terminal area and status bar

### Step 1: Create or Open a Project

- Click the project switcher (bottom-left) or the "Projects" view
- Select an existing folder or create a new project
- CoDes remembers your project and reopens it next launch

### Step 2: Configure a Provider

If you already have an agent CLI installed, CoDes detects it automatically. See [Provider Setup](provider-setup.md) for each provider's install commands.

Optional: configure CLI profiles with custom model overrides, executable paths, or launch arguments via **Settings → CLI Profiles**.

### Step 3: Launch a Session

1. Navigate to the **Sessions** view
2. Click **New Session**
3. Pick a provider, set the working directory, and optionally:
   - Choose a **mode** (interactive / auto / plan / full-access)
   - Override the model
   - Select a CLI profile
   - Write an initial prompt
4. Click **Launch**

A real PTY terminal opens in the session area. You can now interact with the agent CLI as if it were running in a standalone terminal — but with CoDes's orchestration and observability on top.

### Step 4: Explore

- Open the **Git workbench** to stage, commit, branch, and create PRs
- Use the **Kanban board** to track tasks across columns
- Try a **multi-CLI workflow** to automate plan → implement → verify cycles
- Open the **Usage Inspector** to track token/cost evidence
- Visit the **Theme Studio** to customize the look and feel

## Quality Gates

Before submitting changes:

```sh
npm run check          # TypeScript + lint
npm test               # Frontend tests
npm run check --workspace @codes/signaling
npm run build --workspace @codes/signaling
cargo test --manifest-path src-tauri/Cargo.toml
npm run build          # Full production build
```

## Next Steps

- [Projects & Workspaces](projects-workspaces.md) — manage multiple projects
- [Sessions](sessions.md) — deep dive into terminal management
- [Provider Setup](provider-setup.md) — install all 9 supported CLIs
- [Workflows](workflows.md) — automate multi-stage pipelines
