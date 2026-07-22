import { useCoDesStore } from "../store";
import type { BoardTask, Provider, SessionMode } from "../types";
import { sessionRuntime } from "./sessionRuntime";

export function autonomousTaskPrompt(task: BoardTask, mode: SessionMode) {
  const modeInstruction =
    mode === "plan"
      ? "Produce a concrete, verified implementation plan only. Do not modify files."
      : "Implement the work completely, verify the result with appropriate checks, and fix any failures you introduce.";
  return `You are running an autonomous task from the CoDes task board.

Task: ${task.title.trim()}

Description:
${task.description.trim() || "Complete the task described by its title."}

${modeInstruction}
Keep working until the requested outcome is genuinely complete. Do not stop after merely explaining what you would do. When finished, report the outcome and exit successfully. If the task cannot be completed, explain the concrete blocker and exit with a failure status.`;
}

export async function dispatchBoardTask(
  taskId: string,
  overrides: { provider?: Provider; mode?: SessionMode; model?: string } = {},
) {
  const state = useCoDesStore.getState();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task no longer exists.");
  if (task.sessionId) throw new Error("Task already has a linked session.");
  const provider =
    overrides.provider ?? task.provider ?? state.settings.defaultProvider;
  const mode = overrides.mode ?? task.mode ?? state.settings.defaultSessionMode;
  const model = (overrides.model ?? task.model)?.trim() || undefined;
  const id = state.addSession(provider, task.title.trim(), {
    projectId: task.projectId,
    mode,
    model,
    initialPrompt: autonomousTaskPrompt(task, mode),
    autonomousTaskId: task.id,
  });
  const session = useCoDesStore
    .getState()
    .sessions.find((item) => item.id === id);
  if (!session)
    throw new Error("Could not create an agent session for this task.");
  state.updateTask(task.id, {
    sessionId: id,
    column: "working",
    provider,
    mode,
    model,
    failure: undefined,
  });
  try {
    await sessionRuntime.ensure(session);
    return id;
  } catch (error) {
    useCoDesStore.getState().updateTask(task.id, {
      sessionId: undefined,
      column: "ready",
      failure: String(error),
    });
    throw error;
  }
}
