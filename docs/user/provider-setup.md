# Provider Setup

CoDes supports nine coding-agent CLIs. Each provider is detected automatically when you have its CLI installed and authenticated. CoDes **never stores provider credentials** — authentication stays owned by each CLI.

## Supported Providers

| Provider | Binary | Install Command |
|---|---|---|
| **Codex** | `codex` | `npm i -g @openai/codex` |
| **Claude Code** | `claude` | See [docs.anthropic.com](https://docs.anthropic.com) |
| **Antigravity** | `agy` | See [antigravity.google](https://antigravity.google/product/antigravity-cli) |
| **OpenCode** | `opencode` | `npm i -g opencode-ai` |
| **Reasonix** | `reasonix` | `npm i -g reasonix` |
| **Grok Build** | `grok` | `curl -fsSL https://x.ai/cli/install.sh \| sh` |
| **Qwen Code** | `qwen` | `npm i -g @qwen-code/qwen-code` |
| **Aider** | `aider` | `pipx install aider-chat` |
| **Pi** | `pi` | `npm i -g @earendil-works/pi-coding-agent` |

## Detection

CoDes scans for each binary in your `PATH` on startup and when you open the session launcher. A provider appears in the UI only when its binary is found.

To check detection manually:

```sh
# Verify the CLI is installed and on PATH
codex --version    # or claude, agy, opencode, etc.
```

If a provider isn't appearing:
1. Confirm the binary is installed (`which <binary>` on macOS/Linux, `where <binary>` on Windows)
2. Ensure it's on your `PATH`
3. Restart CoDes or trigger a re-scan via the session launcher

## Authentication

Each provider handles its own authentication. Common patterns:

- **Codex**: `codex auth login`
- **Claude Code**: `claude login`
- **OpenCode**: `opencode auth`
- **Aider**: Configure `~/.aider.conf.yml` with API keys
- **Grok**: `grok auth`

Refer to each provider's documentation for the latest auth flow.

## CLI Profiles

CLI profiles let you customize how a provider is launched. Configure them in **Settings → CLI Profiles**.

Per profile you can set:
- **Executable path** — override the binary location
- **Extra arguments** — additional CLI flags passed on launch
- **Model override** — force a specific model
- **Environment overrides** — non-secret environment variables

Profiles are useful for:
- Using a development build of a CLI
- Passing provider-specific flags (e.g., `--temperature`, `--max-tokens`)
- Testing different model versions

## Model Overrides

When launching a session, you can override the default model for that provider. The override is passed as a CLI argument if the provider supports it. Model availability depends on the provider and your access level.

## Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| Provider not detected | Binary not on PATH | Install the CLI and ensure it's in PATH |
| Session fails to start | CLI not authenticated | Run the provider's auth command |
| Model override ignored | Provider doesn't support `--model` | Check provider docs for supported flags |
| CLI profile not working | Profile references a removed binary | Update the executable path in Settings |

## See Also

- [Sessions](sessions.md) — launch and manage provider sessions
- [CLI Profiles](../dev/adding-a-provider.md) — developer guide for adding new providers
