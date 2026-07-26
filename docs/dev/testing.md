# Testing

CoDes uses a multi-layered testing strategy covering the frontend, backend, and integration points.

## Test Layers

```
┌─────────────────────────────┐
│   Frontend Tests (Vitest)   │  ← React components, store, utilities
├─────────────────────────────┤
│   Rust Unit Tests           │  ← Module-level tests (cargo test)
├─────────────────────────────┤
│   Rust Integration Tests    │  ← Git workbench, workflow model, parser fixtures
├─────────────────────────────┤
│   Smoke Tests               │  ← Manual verification with installed CLIs
└─────────────────────────────┘
```

## Running Tests

### Frontend

```sh
# Run all frontend tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### Rust Backend

```sh
# Run all Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Specific test
cargo test --manifest-path src-tauri/Cargo.toml -- test_name

# With output
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Signaling Relay

```sh
# Run relay tests
npm run test --workspace @codes/signaling
# or
cd services/signaling && npm test
```

### Quality Gates (full suite)

```sh
npm run check          # TypeScript checks + lint
npm test               # Frontend tests
npm run check --workspace @codes/signaling
npm run build --workspace @codes/signaling
cargo test --manifest-path src-tauri/Cargo.toml
npm run build          # Full production build
```

## Frontend Testing

### Framework

- **Vitest** — test runner (configured in `vite.config.ts`)
- TypeScript strict mode catches many issues at compile time

### Test Locations

Tests are co-located with source files:
- `src/sharing/client.test.ts` — WebRTC sharing client
- `src/sharing/protocol.test.ts` — Sharing protocol
- `src/components/GitWorkspace.test.ts` — Git workspace component
- `src/components/TimelineEventIcon.test.tsx` — Timeline icon component

### What to Test

- **Store logic** — Zustand store actions and state transitions
- **Utility functions** — `lib/` modules (runtime, workflow model, providers)
- **Components** — complex interactive components (Git, sharing, dialogs)
- **IPC wrappers** — `native.ts` typed invoke/listen wrappers

### Mocking

Tauri APIs are not available in test mode. Mock `@tauri-apps/api` calls:

```typescript
// Example: mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
```

## Rust Testing

### Framework

- **cargo test** — standard Rust test runner
- Tests live alongside source code or in `tests/` modules

### Key Test Areas

| Module | Test Focus |
|---|---|
| `git_manager.rs` | Temporary-repository tests for staging, committing, branching, PR creation, conflict handling |
| `history.rs` | Parser fixture tests — sample provider history files parsed into expected structures |
| `usage.rs` | Connector mock tests — simulated API responses for token/cost data |
| `lib.rs` | Session lifecycle, SQLite migrations, provider detection |

### Fixtures

- Git tests create temporary repositories with controlled state
- History tests use fixture files representing provider-specific log formats
- Usage tests use mock HTTP responses for API connectors

### Integration Tests

- **Git workbench** — full workflow tests in temp repos: init, add, commit, branch, merge, push/pull simulation
- **Workflow model** — template serialization/deserialization, stage execution ordering
- **History parsers** — end-to-end: read fixture file → parse → verify structured output

## CI Pipeline

Tests run automatically on push and PR via `.github/workflows/ci.yml`:

1. **`npm run check`** — TypeScript type-checking and ESLint
2. **`npm test`** — Vitest frontend tests
3. **`cargo test`** — Rust backend tests
4. **`npm run build`** — Verify production build succeeds

## Smoke Tests

Some features require manual smoke testing with real installed CLIs:

- **Provider detection** — verify all 9 providers are detected when installed
- **Session launch** — launch each provider and verify basic interaction
- **Git operations** — clone a test repo and verify all Git workbench operations
- **Sharing** — two-peer encrypted WebRTC sharing test
- **Browser preview** — verify webview and iframe modes on each platform

## See Also

- [CI Configuration](../.github/workflows/ci.yml) — CI pipeline definition
- [Contributing Guide](../CONTRIBUTING.md) — test prerequisites and submission checklist
