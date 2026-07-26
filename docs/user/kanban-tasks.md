# Kanban Tasks

CoDes includes a persistent Kanban task board for tracking work across your project.

## Board Columns

The board has four standard columns:

| Column | Purpose |
|---|---|
| **Backlog** | Ideas, future work, unprioritized items |
| **Ready** | Tasks that are defined and ready to be started |
| **Working** | Tasks currently in progress (linked to a session) |
| **Done** | Completed tasks |

## Working with Tasks

### Creating a Task

1. Click **Add Task** in any column
2. Enter a title and optional description
3. Add tags for categorization
4. The task appears at the bottom of the column

### Editing a Task

Double-click a task card to edit:
- Title & description
- Tags (add/remove)
- Color or priority indicator
- Linked session

### Moving Tasks

- **Drag and drop** a card between columns
- Use the keyboard: select a card and press `→` / `←` to move between columns

### Deleting a Task

Use the delete action on a task card. A confirmation dialog prevents accidental deletion.

## Session Linking

You can link a task to an active session:

1. Open the task edit dialog
2. Under **Linked Session**, select an active session
3. The task shows the session status on its card

When a linked session completes or fails, the task updates automatically. The session exit status is recorded on the task.

## Tags

Tags help categorize and filter tasks:
- Create tags per project
- Assign multiple tags to a task
- Filter the board by tag
- Tags are color-coded for quick scanning

## Autopilot Mode

Autopilot automates task execution. When enabled:

1. Tasks in the **Ready** column are picked up automatically
2. Each task launches a provider-native one-shot job
3. Respects per-task settings: provider, mode, model
4. Configurable parallel-worker limit prevents resource overload
5. Tasks move to **Working** while running
6. Tasks move to **Done** only after a successful process exit
7. Failed tasks return to **Ready** or **Backlog** with failure details

### Configuration

Autopilot settings are in **Settings → Autopilot**:
- Enable/disable Autopilot
- Max parallel workers
- Default provider and mode for new tasks

### Execution Kinds

Each task can be:
- **Single** — runs as a standalone session with one provider
- **Workflow** — runs a multi-CLI workflow template (see [Workflows](workflows.md))

## Task & Session Flow

The board integrates with sessions and workflows:
- Tasks in **Working** show live session status
- Completed sessions trigger task status updates
- Workflow runs track aggregate progress on the task card
- Timeline events record task lifecycle

## See Also

- [Sessions](sessions.md) — link sessions to tasks
- [Workflows](workflows.md) — run tasks as multi-CLI pipelines
- [Projects & Workspaces](projects-workspaces.md) — each project has its own board
