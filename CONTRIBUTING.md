# Contributing to CoDes

Thank you for helping improve CoDes.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large features or changes to security-sensitive behavior.
- Never include provider credentials, local transcripts, database files, signing keys, or other secrets in an issue or commit.

## Local development

Install Node.js 24+, Rust stable, the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and at least one supported coding-agent CLI. Then run:

```sh
npm ci
npm run tauri dev
```

## Pull requests

Keep changes focused and explain the user-facing behavior they affect. Before submitting, run the relevant checks:

```sh
npm run check
npm test
npm run check --workspace @codes/signaling
npm run build --workspace @codes/signaling
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

By contributing, you agree that your contribution is licensed under the project's MIT License.
