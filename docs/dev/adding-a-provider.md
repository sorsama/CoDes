# Adding a Provider

This guide covers how to add support for a new coding-agent CLI in CoDes. The provider system is registry-driven: you add one entry on the Rust side and one on the TypeScript side.

## Overview

Each provider requires:

1. **Rust entry** in `src-tauri/src/lib.rs` — launch, resume, and detection logic
2. **TypeScript entry** in `src/lib/providers.ts` — UI metadata (label, icon, color)
3. **Icon asset** — a small PNG/SVG icon in `public/cli-icon/`

## Step 1: Rust Provider Entry

Open `src-tauri/src/lib.rs` and find the `PROVIDERS` array (or equivalent registry).

### Provider Struct

Each provider entry needs:

```rust
pub struct ProviderSpec {
    /// Binary name (e.g., "codex", "claude")
    pub binary: &'static str,
    /// Display name
    pub label: &'static str,
    /// CLI version argument (e.g., "--version")
    pub version_arg: &'static [&'static str],
    /// Environment variables to set
    pub env: &'static [(&'static str, &'static str)],
}
```

### Detection

Detection is automatic — CoDes checks if the binary exists on `PATH`:

```rust
fn detect_providers() -> Vec<ProviderSpec> {
    PROVIDERS.iter().filter(|p| which(p.binary).is_ok()).collect()
}
```

Add your provider to the `PROVIDERS` array:

```rust
pub(crate) const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        binary: "codex",
        label: "Codex",
        version_arg: &[],
        env: &[],
    },
    // ... add your provider:
    ProviderSpec {
        binary: "my-agent",
        label: "My Agent",
        version_arg: &["--version"],
        env: &[],
    },
];
```

### Launch Arguments

If your provider needs custom launch arguments, add them to the session launch logic in the `launch_session` command handler. You can reference the provider name to conditionally pass flags.

### Resume Support

If your provider supports session resume (via a resume ID or similar), implement the resume handler in the `resume_session` command. The resume ID is stored in the session's `resume_id` field.

## Step 2: TypeScript Provider Metadata

Open `src/lib/providers.ts` and add your provider to the `PROVIDERS` object:

```typescript
export const PROVIDERS: Record<string, ProviderMeta> = {
  // ... existing providers
  myAgent: {
    label: "My Agent",
    iconPath: "/cli-icon/myagent.png",
    color: "oklch(72% 0.14 200)", // pick a distinctive hue
    install: "npm i -g my-agent-cli",
    docs: "https://docs.myagent.dev",
  },
};
```

### ProviderMeta Interface

```typescript
export interface ProviderMeta {
  label: string;         // Display name
  iconPath: string;      // Path to icon in /public/cli-icon/
  color: string;         // Theme token or OKLCH/HEX color
  install: string;       // Install command for the quickstart
  docs: string;          // Documentation URL
}
```

## Step 3: Icon Asset

Add a small PNG (ideally 32×32 or 64×64) to `public/cli-icon/` with the filename matching your `iconPath`. Supported formats: PNG, SVG.

Keep the icon simple and recognizable at small sizes. Use the provider's official logo if available.

## Step 4: TypeScript Provider Type

The `Provider` type is a string union of provider IDs. Add your provider key to the type if it's constrained. Check `src/lib/providers.ts` for the current type definition.

## Step 5: Test Detection

1. Install the CLI binary you're adding support for
2. Run `npm run tauri dev`
3. Open the session launcher — your provider should appear in the provider list
4. Launch a session and verify basic interaction works

## Step 6: History Parser (Optional)

If your provider writes structured conversation history to disk, you can add a parser in `src-tauri/src/history.rs`:

1. Study the provider's local storage format (look for log files in common locations)
2. Implement a parser function that returns structured handoff data
3. Register the parser in the handoff command handler

## Step 7: Usage Connector (Optional)

If your provider exposes an official usage API, you can add a connector in `src-tauri/src/usage.rs`:

1. Implement the connector interface (token/cost retrieval)
2. Add authentication via the credential vault
3. Register the connector in the inspector command handler

## Checklist

- [ ] Provider added to `PROVIDERS` array in `lib.rs`
- [ ] Provider added to `PROVIDERS` object in `providers.ts`
- [ ] Icon asset added to `public/cli-icon/`
- [ ] Provider detected and shown in session launcher
- [ ] Session launches and runs correctly
- [ ] (Optional) History parser added
- [ ] (Optional) Usage connector added

## See Also

- [Architecture](architecture.md) — provider system design
- [Provider Setup](../user/provider-setup.md) — user-facing provider configuration
- [Rust Backend](rust-backend.md) — detailed Rust module reference
