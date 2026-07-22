import { beforeEach, describe, expect, it } from "vitest";
import { darkTheme, defaultSettings, normalizeWorkspaceSnapshot, useCoDesStore } from "./store";

describe("workspace state", () => {
  beforeEach(() => useCoDesStore.setState({
    snapshotVersion: 6, workspaces: [{ id: "w", name: "Work", color: "orange", position: 0, lastOpenedAt: 1, lastProjectId: "p" }], activeWorkspaceId: "w",
    projects: [{ id: "p", workspaceId: "w", name: "Project", path: "C:\\project", color: "orange", position: 0, lastOpenedAt: 1 }],
    sessions: [], tasks: [], events: [], alerts: [], themes: [darkTheme], settings: defaultSettings,
    activeProjectId: "p", activeSessionId: "", activeThemeId: darkTheme.id, sessionLayout: "tabs",
  }));

  it("synchronizes a successful linked session to Done", () => {
    const taskId = useCoDesStore.getState().addTask("working", { title: "Ship it" });
    const sessionId = useCoDesStore.getState().addSession("codex", "Ship it");
    useCoDesStore.getState().updateTask(taskId, { sessionId });
    useCoDesStore.getState().updateSession(sessionId, { status: "completed" });
    expect(useCoDesStore.getState().tasks.find((task) => task.id === taskId)?.column).toBe("done");
  });

  it("keeps failed linked work in progress with a failure reason", () => {
    const taskId = useCoDesStore.getState().addTask("working", { title: "Fix it" });
    const sessionId = useCoDesStore.getState().addSession("codex", "Fix it");
    useCoDesStore.getState().updateTask(taskId, { sessionId });
    useCoDesStore.getState().updateSession(sessionId, { status: "failed" });
    const task = useCoDesStore.getState().tasks.find((item) => item.id === taskId);
    expect(task?.column).toBe("working");
    expect(task?.failure).toContain("failed");
  });

  it("caps telemetry at the configured retention limit", () => {
    useCoDesStore.getState().updateSettings({ telemetryLimit: 2 });
    for (let index = 0; index < 3; index++) useCoDesStore.getState().addEvent({ sessionId: "s", type: "status", title: String(index), detail: "event" });
    expect(useCoDesStore.getState().events.map((event) => event.title)).toEqual(["1", "2"]);
  });

  it("reorders tasks deterministically inside a column", () => {
    const first = useCoDesStore.getState().addTask("backlog", { title: "First" });
    const second = useCoDesStore.getState().addTask("backlog", { title: "Second" });
    const third = useCoDesStore.getState().addTask("backlog", { title: "Third" });
    useCoDesStore.getState().moveTask(third, "backlog", 0);
    expect(useCoDesStore.getState().tasks.filter((task) => task.column === "backlog").sort((a, b) => a.position - b.position).map((task) => task.id)).toEqual([third, first, second]);
  });

  it("migrates legacy projects into one default workspace", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      projects: [{ id: "legacy", name: "Legacy", path: "C:\\legacy", color: "blue", lastOpenedAt: 4 }],
      sessions: [], tasks: [], events: [], alerts: [], themes: [darkTheme], settings: defaultSettings,
      activeProjectId: "legacy", activeSessionId: "", activeThemeId: darkTheme.id, sessionLayout: "tabs",
    });
    expect(snapshot.snapshotVersion).toBe(7);
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.projects[0].workspaceId).toBe(snapshot.workspaces[0].id);
    expect(snapshot.activeProjectId).toBe("legacy");
  });

  it("migrates handoff settings with safe defaults and bounds", () => {
    const defaults = normalizeWorkspaceSnapshot({});
    expect(defaults.settings.handoffHistoryMode).toBe("conversation");
    expect(defaults.settings.handoffRecentTurns).toBe(10);
    expect(defaults.settings.handoffMaxChars).toBe(64_000);
    expect(defaults.settings.handoffRedactSecrets).toBe(true);
    const repaired = normalizeWorkspaceSnapshot({ settings: { handoffHistoryMode: "broken", handoffRecentTurns: 1000, handoffMaxChars: 1 } });
    expect(repaired.settings.handoffHistoryMode).toBe("conversation");
    expect(repaired.settings.handoffRecentTurns).toBe(50);
    expect(repaired.settings.handoffMaxChars).toBe(1_024);
  });

  it("resolves a persisted failure alert after the session recovered", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      workspaces: [{ id: "w", name: "Work", color: "orange" }],
      projects: [{ id: "p", workspaceId: "w", name: "Project", path: "C:\\project", color: "orange" }],
      sessions: [{ id: "s", projectId: "p", title: "Agent", provider: "codex", status: "working", cwd: "C:\\project", createdAt: 1, unread: false }],
      alerts: [{ id: "a", projectId: "p", sessionId: "s", kind: "failed", title: "Agent failed", detail: "Process exited with 1.", createdAt: 10, read: false }],
      events: [{ id: "e", sessionId: "s", type: "status", title: "Session started", detail: "codex launched", timestamp: 11 }],
    });
    expect(snapshot.alerts[0].read).toBe(true);
  });

  it("keeps an unrecovered failure alert unread", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      workspaces: [{ id: "w", name: "Work", color: "orange" }],
      projects: [{ id: "p", workspaceId: "w", name: "Project", path: "C:\\project", color: "orange" }],
      sessions: [{ id: "s", projectId: "p", title: "Agent", provider: "codex", status: "failed", cwd: "C:\\project", createdAt: 1, unread: true }],
      alerts: [{ id: "a", projectId: "p", sessionId: "s", kind: "failed", title: "Agent failed", detail: "Process exited with 1.", createdAt: 12, read: false }],
      events: [{ id: "e", sessionId: "s", type: "status", title: "Session started", detail: "codex launched", timestamp: 11 }],
    });
    expect(snapshot.alerts[0].read).toBe(false);
  });

  it("switches workspaces without changing running sessions", () => {
    const state = useCoDesStore.getState();
    state.addSession("codex", "Keep running");
    const sessions = useCoDesStore.getState().sessions;
    const workspaceId = "w-2";
    state.addWorkspace({ id: workspaceId, name: "Second", color: "blue", position: 1, lastOpenedAt: 2 });
    expect(useCoDesStore.getState().activeProjectId).toBe("");
    state.setActiveWorkspace("w");
    expect(useCoDesStore.getState().sessions).toEqual(sessions);
    expect(useCoDesStore.getState().activeProjectId).toBe("p");
  });

  it("moves a project with its linked work and reorders without duplication", () => {
    const state = useCoDesStore.getState();
    const sessionId = state.addSession("codex", "Move me");
    const taskId = state.addTask("ready", { title: "Move me", sessionId });
    state.addWorkspace({ id: "w-2", name: "Second", color: "blue", position: 1, lastOpenedAt: 2 });
    state.moveProject("p", "w-2");
    const next = useCoDesStore.getState();
    expect(next.projects.filter((item) => item.id === "p")).toHaveLength(1);
    expect(next.projects[0].workspaceId).toBe("w-2");
    expect(next.sessions.find((item) => item.id === sessionId)?.projectId).toBe("p");
    expect(next.tasks.find((item) => item.id === taskId)?.projectId).toBe("p");
  });

  it("duplicates visual identity without copying projects", () => {
    const id = useCoDesStore.getState().duplicateWorkspace("w");
    const next = useCoDesStore.getState();
    expect(next.workspaces.find((item) => item.id === id)?.name).toBe("Work copy");
    expect(next.projects.some((item) => item.workspaceId === id)).toBe(false);
  });

  it("guards deletion until a workspace is empty and inactive", () => {
    const state = useCoDesStore.getState();
    state.addWorkspace({ id: "w-2", name: "Second", color: "blue", position: 1, lastOpenedAt: 2 });
    state.removeWorkspace("w");
    expect(useCoDesStore.getState().workspaces.some((item) => item.id === "w")).toBe(true);
    state.setActiveWorkspace("w-2");
    state.removeProject("p");
    state.removeWorkspace("w");
    expect(useCoDesStore.getState().workspaces.some((item) => item.id === "w")).toBe(false);
  });

  it("repairs malformed workspace references", () => {
    const snapshot = normalizeWorkspaceSnapshot({ projects: [{ id: "p", name: "Project", path: "C:\\p", workspaceId: "missing" }], workspaces: [{ id: "valid", name: "Valid" }] });
    expect(snapshot.projects[0].workspaceId).toBe("valid");
    expect(snapshot.activeWorkspaceId).toBe("valid");
  });
});
