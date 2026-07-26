# Git Workbench

CoDes includes a first-class Git workbench for staging, committing, branching, and managing pull requests — all without leaving the application.

## Accessing the Git Workbench

Select the **Git** view from the sidebar navigation. The workbench opens in the context of the active project.

## File & Hunk Staging

### Viewing Changes

The workbench shows:
- **Changed files** — list of modified, added, deleted, and untracked files
- **Inline diffs** — side-by-side or unified diff view for each file
- **Hunk staging** — stage individual hunks within a file, not just whole files

### Staging

| Action | How |
|---|---|
| Stage a file | Click the `+` icon next to the file |
| Stage a hunk | Click the `+` icon next to a hunk in the diff view |
| Unstage | Click the `-` icon |
| Discard changes | Use the discard action (irreversible — confirmation required) |

### Diff Navigation

Use keyboard shortcuts to navigate diffs:
- `↑` / `↓` — move between hunks
- `Space` — expand/collapse a hunk
- `Enter` — toggle staging for the current hunk

## Commits

### Creating a Commit

1. Stage the desired files and hunks
2. Write a commit message in the message area
3. Click **Commit** (or use `Ctrl+Enter`)

CoDes commits via the system Git binary, so your global Git config (name, email, signing key, etc.) applies automatically.

### AI Commit Proposals

CoDes can generate commit message proposals using any installed provider in **plan** mode:

1. Click the **AI Proposal** button in the commit area
2. Select a provider (defaults to your preferred provider)
3. CoDes reads the staged diff and sends it to the provider
4. Review the proposed message, edit as needed, and commit

The AI proposal feature:
- Binds suggestions to the exact reviewed diff
- Supports **Verify first** mode (review before applying)
- Supports **bounded Full auto** mode (auto-commit with a limit)

### Safe Commits

CoDes enforces safe commit practices:
- Force push is intentionally unavailable
- Hard reset is not exposed
- Automatic conflict resolution requires explicit review
- Silent inclusion of unreviewed files is prevented

## Branches

### Branch Management

- **Create** a new branch from the current HEAD
- **Switch** between local branches
- **Delete** merged or stale branches
- **Compare** branches with diff view

### Stashes

- **Stash** working directory changes
- **List** all stashes with timestamps and messages
- **Apply** or **drop** individual stashes

### Tags

- **Create** lightweight and annotated tags
- **View** tag list with commit references
- **Delete** tags

## Remotes & Sync

### Remotes

- **View** configured remotes
- **Add** a new remote
- **Fetch** from remotes
- **Pull** with rebase or merge strategy
- **Push** commits to the remote

### Synchronization

The sync status indicator shows:
- Ahead/behind counts for the current branch
- Last fetch timestamp
- Unpushed commits

## Pull Requests

CoDes supports creating and managing **GitHub pull requests** (authenticated via GitHub CLI or token):

### Creating a PR

1. Push your branch to the remote
2. Click **New Pull Request**
3. Review the diff, title, and body
4. Optionally set reviewers, labels, and milestone
5. Click **Create**

### Managing PRs

- **List** open PRs for the current repository
- **View** PR status and CI checks
- **Comment** on PRs
- **Merge** (merge commit, squash, or rebase)

## Conflict Recovery

When a merge or rebase produces conflicts:

1. CoDes shows the conflicted files with inline markers
2. Resolve each conflict manually in the diff view
3. Mark as resolved per file
4. Complete the merge/rebase

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Commit staged changes |
| `Ctrl+Shift+P` | AI commit proposal |
| `B` | Toggle branch panel |
| `S` | Toggle stash panel |

## See Also

- [Projects & Workspaces](projects-workspaces.md) — project context for Git
- [Workflows](workflows.md) — integrate Git operations in pipelines
