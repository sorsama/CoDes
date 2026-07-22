export interface ProviderMeta {
  label: string;
  iconPath: string;
  color: string;
  install: string;
  docs: string;
}

/**
 * Single source of truth for agent provider UI metadata.
 * The launch/detection specs live in `src-tauri/src/lib.rs` (`PROVIDERS`).
 * Adding a new provider is one entry here plus one Rust entry there.
 */
export const PROVIDERS = {
  codex: {
    label: "Codex",
    iconPath: "/cli-icon/codex.png",
    color: "var(--text)",
    install: "npm i -g @openai/codex",
    docs: "https://learn.chatgpt.com/docs",
  },
  claude: {
    label: "Claude",
    iconPath: "/cli-icon/claudecode.png",
    color: "oklch(75% 0.1 50)",
    install: "claude",
    docs: "https://docs.anthropic.com",
  },
  antigravity: {
    label: "Antigravity",
    iconPath: "/cli-icon/antigravity.png",
    color: "oklch(73% 0.1 250)",
    install: "agy",
    docs: "https://antigravity.google/product/antigravity-cli",
  },
  opencode: {
    label: "OpenCode",
    iconPath: "/cli-icon/opencode.png",
    color: "oklch(72% 0.14 145)",
    install: "npm i -g opencode-ai",
    docs: "https://opencode.ai/docs/",
  },
  reasonix: {
    label: "Reasonix",
    iconPath: "/cli-icon/deepseek.png",
    color: "oklch(70% 0.14 300)",
    install: "npm i -g reasonix",
    docs: "https://github.com/esengine/DeepSeek-Reasonix",
  },
  grok: {
    label: "Grok Build",
    iconPath: "/cli-icon/grok--v2.png",
    color: "oklch(72% 0.16 25)",
    install: "curl -fsSL https://x.ai/cli/install.sh | sh",
    docs: "https://docs.x.ai/build/overview",
  },
  qwen: {
    label: "Qwen Code",
    iconPath: "/cli-icon/qwen.png",
    color: "oklch(74% 0.12 210)",
    install: "npm i -g @qwen-code/qwen-code",
    docs: "https://github.com/QwenLM/qwen-code",
  },
  aider: {
    label: "Aider",
    iconPath: "/cli-icon/aider.png",
    color: "oklch(76% 0.13 85)",
    install: "pipx install aider-chat",
    docs: "https://aider.chat",
  },
  pi: {
    label: "Pi",
    iconPath: "/cli-icon/pi.png",
    color: "oklch(72% 0.15 340)",
    install: "npm i -g @earendil-works/pi-coding-agent",
    docs: "https://pi.dev",
  },
} as const satisfies Record<string, ProviderMeta>;

export type Provider = keyof typeof PROVIDERS;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

/** Metadata for the GitHub CLI, a detected tool that is not a launchable agent provider. */
export const GITHUB_TOOL = {
  provider: "github",
  label: "GitHub",
  iconPath: "/cli-icon/github.png",
  color: "var(--muted)",
  install: "winget install --id GitHub.cli",
  docs: "https://cli.github.com/",
} as const;

/** Resolve UI metadata for a provider id, falling back to the GitHub tool entry. */
export function providerMeta(provider: string): ProviderMeta {
  return (PROVIDERS as Record<string, ProviderMeta>)[provider] ?? GITHUB_TOOL;
}
