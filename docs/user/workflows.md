# Workflows

Workflows are reusable multi-CLI pipelines that automate a sequence of agent stages. They enable plan → implement → verify cycles without manual handoff.

## Overview

A workflow consists of an ordered set of **stages**, each run by a different provider or CLI profile. Stages can pass artifacts to each other, and the workflow can detect failures, retry, or enter a repair loop.

The built-in workflow uses:
1. **Codex** to plan
2. **Antigravity** to implement
3. **Reasonix** to verify

## Workflow Templates

Templates define the stage structure and can be reused across tasks.

### Creating a Template

1. Navigate to the **Workflows** view
2. Click **New Template**
3. Define stages (see below)
4. Save the template

### Template Configuration

Each template includes:
- **Name** and optional description
- **Stages** — ordered list of stage definitions
- **Default provider** for each stage

### Stage Configuration

Each stage has:

| Setting | Description |
|---|---|
| **Name** | Human-readable label |
| **Role** | `plan`, `implement`, or `verify` (influences artifact handling) |
| **Provider** | Which agent CLI runs this stage |
| **Model** | Optional model override |
| **Mode** | Interactive, auto, plan, or full-access |
| **CLI Profile** | Optional pre-configured profile |
| **Prompt template** | The prompt sent to the provider (supports artifact variables) |
| **Timeout** | Maximum duration before the stage is considered failed |
| **Retries** | Number of automatic retries on failure |

### Prompt Variables

Prompts can reference artifacts from previous stages:
- `{plan}` — output from the plan stage
- `{implementation}` — output from the implement stage
- `{verification}` — output from the verify stage
- `{task.description}` — the task description
- `{project.path}` — the project working directory

## Running a Workflow

### From a Task

1. Create a task on the Kanban board
2. Set **Execution Kind** to **Workflow**
3. Select a workflow template
4. Optionally override stage settings per task
5. The task moves through stages automatically

### Standalone Run

1. Open the **Workflows** view
2. Select a template
3. Click **Run**
4. Monitor progress in real time

### Run Lifecycle

```
Queued → Preflight → Running (stage by stage) → Passed / Failed
                                ↓
                         (if failure) → Repairing → Running (retry) → ...
                                ↓
                           Paused (manual) → Resume / Cancel
```

### Stage Execution

Stages run sequentially. Each stage:
1. Runs preflight checks (CLI detection, profile validation)
2. Launches the provider in the configured mode
3. Captures output and artifacts
4. Passes artifacts to the next stage
5. On failure: retries (if configured) or triggers repair

### Repair Loops

When a stage fails:
1. CoDes can launch a repair stage with the failed stage's output as context
2. The repair stage attempts to fix the issue
3. If successful, the workflow continues
4. Repair loops have a configurable maximum iteration count

### Interruption Recovery

If CoDes is closed during a running workflow:
- Running state is persisted to SQLite
- On restart, workflows show their last known state
- Manual resume or cancel is required

## Artifacts & Reports

### Artifacts

Each stage produces artifacts:
- Terminal output (full scrollback)
- Structured evidence (exit codes, duration, token usage)
- Provider-specific artifacts (plans, generated code, test results)

Artifacts are stored in the project and linked to the workflow run.

### Reports

After completion, CoDes generates a **Markdown report** containing:
- Workflow summary (template, duration, status)
- Per-stage results with evidence
- Artifact links
- Token and cost breakdown

Reports are saved to the project directory and viewable from the Workflows view.

## Pause, Cancel & Resume

| Action | Effect |
|---|---|
| **Pause** | Suspends the current stage. The provider process is kept alive. |
| **Resume** | Continues from where it was paused. |
| **Cancel** | Terminates the current stage and marks the workflow as cancelled. Artifacts up to that point are preserved. |

## See Also

- [Kanban Tasks](kanban-tasks.md) — run workflows from the task board
- [Sessions](sessions.md) — each workflow stage runs in a session
- [Provider Setup](provider-setup.md) — configure providers for workflow stages
