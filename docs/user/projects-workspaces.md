# Projects & Workspaces

CoDes organizes your work into **workspaces** and **projects**.

## Concepts

- **Workspace** — a top-level container that holds projects. You can have multiple workspaces (e.g., "Work", "Open Source", "Client X").
- **Project** — a repository or working directory linked to a specific folder on disk. Projects live inside a workspace.

## Workspace Management

### Switching Workspaces

Use the bottom-left workspace switcher to browse and switch between workspaces. Each workspace shows recent activity indicators and the last-opened project.

### Creating a Workspace

1. Open the workspace switcher
2. Click **New Workspace**
3. Give it a name and optional color
4. Drag to reorder as needed

### Archiving & Deleting

Archive a workspace to hide it without data loss. Deletion is permanent — CoDes shows a confirmation safeguard.

### Custom Icons

Set a custom image as the workspace icon from the workspace properties. Supported formats: PNG, SVG, JPEG.

## Project Management

### Adding a Project

1. From the **Projects** view or switcher, click **Add Project**
2. Browse to the existing directory on disk
3. Assign a name and color
4. CoDes saves the project reference — your files stay where they are

Projects display in the switcher ordered by last-opened time. Drag to reorder manually.

### Project Dashboard

Each project has a dashboard showing:
- Recent sessions and their status
- Kanban task flow overview
- Latest Git activity (if a Git repository)
- Quick-action buttons for common tasks

### Removing a Project

Removing a project from CoDes does **not** delete its files on disk — it only removes the reference. A confirmation dialog prevents accidental removal.

## Legacy Migration

CoDes automatically migrates projects from older state formats on first launch after upgrade. No user action is required.

## See Also

- [Quickstart](quickstart.md) — get started with your first project
- [Sessions](sessions.md) — launch terminal sessions in a project context
- [Git Workbench](git-workbench.md) — version control within a project
