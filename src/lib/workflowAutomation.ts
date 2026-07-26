import { useCoDesStore } from "../store";
import type {
  BoardTask,
  Project,
  WorkflowArtifact,
  WorkflowRun,
  WorkflowStage,
  WorkflowStageRun,
  WorkflowTemplate,
} from "../types";
import { detectTools, probeCli, writeWorkflowReport } from "./native";
import { providerMeta } from "./providers";
import { sessionRuntime } from "./sessionRuntime";
import {
  expandWorkflowPrompt,
  parseWorkflowArtifact,
  workflowReportPath,
} from "./workflowModel";

type ActiveWorkflow = { cancelled: boolean; sessionId?: string };
const activeWorkflows = new Map<string, ActiveWorkflow>();

function effectiveStages(task: BoardTask, template: WorkflowTemplate) {
  return template.stages.map((stage) => ({
    ...stage,
    ...(task.workflowOverrides?.[stage.id] ?? {}),
    id: stage.id,
  }));
}

function currentRun(runId: string) {
  return useCoDesStore
    .getState()
    .workflowRuns.find((item) => item.id === runId);
}

function patchRun(runId: string, patch: Partial<WorkflowRun>) {
  useCoDesStore.getState().updateWorkflowRun(runId, patch);
}

function appendStageRun(runId: string, stageRun: WorkflowStageRun) {
  const run = currentRun(runId);
  if (run)
    patchRun(runId, { stageRuns: [...run.stageRuns, stageRun] });
}

function patchStageRun(
  runId: string,
  stageRunId: string,
  patch: Partial<WorkflowStageRun>,
) {
  const run = currentRun(runId);
  if (!run) return;
  patchRun(runId, {
    stageRuns: run.stageRuns.map((item) =>
      item.id === stageRunId ? { ...item, ...patch } : item,
    ),
  });
}

async function preflight(
  stages: WorkflowStage[],
  project: Project,
  template: WorkflowTemplate,
) {
  if (!project.path.trim())
    throw new Error("The project has no working directory.");
  const state = useCoDesStore.getState();
  const tools = await detectTools(true);
  for (const stage of stages) {
    const profile = stage.cliProfileId
      ? state.cliProfiles.find((item) => item.id === stage.cliProfileId)
      : undefined;
    if (stage.cliProfileId && !profile)
      throw new Error(`${stage.name}: the selected CLI profile no longer exists.`);
    const tool = profile
      ? await probeCli({
          provider: profile.provider,
          executablePath: profile.executablePath,
          extraArgs: profile.extraArgs,
        })
      : tools.find((item) => item.provider === stage.provider);
    if (!tool?.installed)
      throw new Error(
        `${stage.name}: ${providerMeta(stage.provider).label} is not installed. ${providerMeta(stage.provider).install}`,
      );
    if (
      profile?.environment.some(
        (item) =>
          item.source === "literal" && item.secret && item.value === undefined,
      )
    )
      throw new Error(
        `${stage.name}: re-enter the session-only secret environment values.`,
      );
  }
  if (
    template.writeReport &&
    (!template.reportPathTemplate.trim() ||
      template.reportPathTemplate.replace(/\\/g, "/").split("/").includes(".."))
  )
    throw new Error("The report path must stay inside the project.");
}

function createRun(
  task: BoardTask,
  template: WorkflowTemplate,
): WorkflowRun {
  return {
    id: crypto.randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    templateId: template.id,
    templateName: template.name,
    status: "queued",
    cycle: 0,
    pauseAfterStage: false,
    createdAt: Date.now(),
    stageRuns: [],
  };
}

async function executeStage(
  runId: string,
  task: BoardTask,
  project: Project,
  stage: WorkflowStage,
  cycle: number,
  artifacts: {
    plan?: string;
    implementation?: string;
    verification?: string;
  },
): Promise<WorkflowArtifact | undefined> {
  const active = activeWorkflows.get(runId);
  if (!active || active.cancelled) throw new Error("Workflow cancelled.");
  let finalError = "Stage failed.";
  for (let attempt = 0; attempt <= stage.retryCount; attempt++) {
    if (active.cancelled) throw new Error("Workflow cancelled.");
    const stageRun: WorkflowStageRun = {
      id: crypto.randomUUID(),
      stageId: stage.id,
      name: stage.name,
      role: stage.role,
      provider: stage.provider,
      status: "running",
      attempt: attempt + 1,
      cycle,
      startedAt: Date.now(),
    };
    appendStageRun(runId, stageRun);
    patchRun(runId, { currentStageId: stage.id });
    const prompt = expandWorkflowPrompt(stage.promptTemplate, {
      task,
      project,
      ...artifacts,
      cycle,
    });
    const state = useCoDesStore.getState();
    const sessionId = state.addSession(
      stage.provider,
      `${task.title} · ${stage.name}${cycle ? ` · repair ${cycle}` : ""}`,
      {
        projectId: task.projectId,
        mode: stage.mode,
        model: stage.model,
        initialPrompt: prompt,
        autonomousTaskId: task.id,
        workflowRunId: runId,
        workflowStageRunId: stageRun.id,
        cliProfileId: stage.cliProfileId,
      },
    );
    active.sessionId = sessionId;
    patchStageRun(runId, stageRun.id, { sessionId });
    state.updateTask(task.id, { sessionId, column: "working" });
    state.setActiveWorkflowRun(runId);
    let output = "";
    let lastOutputPatch = 0;
    const result = await new Promise<{
      ok: boolean;
      error?: string;
      timedOut?: boolean;
    }>((resolve) => {
      let settled = false;
      let timer = 0;
      let unsubscribe = () => {};
      const finish = (value: { ok: boolean; error?: string; timedOut?: boolean }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      unsubscribe = sessionRuntime.subscribe(
        useCoDesStore
          .getState()
          .sessions.find((item) => item.id === sessionId)!,
        (event) => {
          if (event.event === "output") {
            output = (output + new TextDecoder().decode(
              new Uint8Array(event.data.bytes),
            )).slice(-250_000);
            if (Date.now() - lastOutputPatch >= 500) {
              lastOutputPatch = Date.now();
              patchStageRun(runId, stageRun.id, { output });
            }
            if (
              useCoDesStore
                .getState()
                .sessions.find((item) => item.id === sessionId)?.status ===
              "input_required"
            )
              patchRun(runId, { status: "waiting_input" });
            else if (currentRun(runId)?.status === "waiting_input")
              patchRun(runId, {
                status: cycle ? "repairing" : "running",
              });
          } else if (event.event === "exit") {
            finish({
              ok: event.data.code === 0,
              error:
                event.data.code === 0
                  ? undefined
                  : `Process exited with ${event.data.code ?? "a signal"}.`,
            });
          } else finish({ ok: false, error: event.data.message });
        },
      );
      timer = window.setTimeout(() => {
        void sessionRuntime.stop(sessionId);
        finish({
          ok: false,
          timedOut: true,
          error: `Stage timed out after ${stage.timeoutMinutes} minutes.`,
        });
      }, stage.timeoutMinutes * 60_000);
    });
    active.sessionId = undefined;
    if (active.cancelled) {
      patchStageRun(runId, stageRun.id, {
        status: "cancelled",
        finishedAt: Date.now(),
        output,
        error: "Cancelled by user.",
      });
      throw new Error("Workflow cancelled.");
    }
    const artifact = result.ok
      ? parseWorkflowArtifact(output, stage.role)
      : undefined;
    if (result.ok && (stage.role !== "verify" || artifact)) {
      const status =
        stage.role === "verify" && artifact?.verdict !== "passed"
          ? artifact?.verdict === "blocked"
            ? "blocked"
            : "failed"
          : "passed";
      patchStageRun(runId, stageRun.id, {
        status,
        finishedAt: Date.now(),
        output,
        artifact,
      });
      return artifact;
    }
    if (result.ok && stage.role === "verify" && !artifact) {
      patchStageRun(runId, stageRun.id, {
        status: "needs_review",
        finishedAt: Date.now(),
        output,
        error: "Reasonix did not return a valid verification verdict.",
      });
      return undefined;
    }
    finalError = result.error ?? "Stage failed.";
    patchStageRun(runId, stageRun.id, {
      status: "failed",
      finishedAt: Date.now(),
      output,
      error: finalError,
    });
  }
  throw new Error(finalError);
}

function reportFallback(
  task: BoardTask,
  artifact: WorkflowArtifact,
  run: WorkflowRun,
) {
  const tests = artifact.tests?.length
    ? artifact.tests.map((item) => `- ${item}`).join("\n")
    : "- No structured test list was returned.";
  return `# ${task.title} verification report

**Verdict:** ${artifact.verdict ?? "blocked"}

## Summary

${artifact.summary}

## Tests

${tests}

## Findings

${artifact.findings || "No findings reported."}

Run: \`${run.id}\`
`;
}

export async function dispatchWorkflowTask(taskId: string, resumeRunId?: string) {
  const initialState = useCoDesStore.getState();
  const task = initialState.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task no longer exists.");
  const project = initialState.projects.find(
    (item) => item.id === task.projectId,
  );
  if (!project) throw new Error("Task project no longer exists.");
  const templateId =
    task.workflowTemplateId ??
    initialState.settings.defaultWorkflowTemplateId;
  const template = initialState.workflowTemplates.find(
    (item) => item.id === templateId,
  );
  if (!template) throw new Error("Workflow template no longer exists.");
  const stages = effectiveStages(task, template);
  const run =
    (resumeRunId
      ? initialState.workflowRuns.find((item) => item.id === resumeRunId)
      : undefined) ?? createRun(task, template);
  if (!resumeRunId) {
    initialState.addWorkflowRun(run);
    initialState.updateTask(task.id, {
      workflowRunId: run.id,
      workflowTemplateId: template.id,
      executionKind: "workflow",
      column: "working",
      failure: undefined,
    });
  }
  if (activeWorkflows.has(run.id)) return run.id;
  activeWorkflows.set(run.id, { cancelled: false });
  try {
    patchRun(run.id, {
      status: "preflight",
      startedAt: run.startedAt ?? Date.now(),
      finishedAt: undefined,
      error: undefined,
    });
    await preflight(stages, project, template);
    patchRun(run.id, { status: "running" });
    let latest = currentRun(run.id)!;
    let plan = latest.plan;
    let implementation = latest.implementation;
    let verification = latest.verification;
    const planStage = stages.find((item) => item.role === "plan");
    const implementStage = stages.find((item) => item.role === "implement");
    const verifyStage = stages.find((item) => item.role === "verify");
    if (!planStage || !implementStage || !verifyStage)
      throw new Error("Workflow requires plan, implement, and verify stages.");
    if (!plan) {
      const artifact = await executeStage(
        run.id,
        task,
        project,
        planStage,
        0,
        {},
      );
      plan = artifact?.content;
      patchRun(run.id, { plan });
      if (currentRun(run.id)?.pauseAfterStage) {
        patchRun(run.id, { status: "paused" });
        return run.id;
      }
    }
    let cycle = latest.cycle ?? 0;
    while (cycle <= template.maxRepairCycles) {
      patchRun(run.id, {
        status: cycle ? "repairing" : "running",
        cycle,
      });
      const lastVerification = [...currentRun(run.id)!.stageRuns]
        .reverse()
        .find((item) => item.role === "verify");
      const needsImplementation =
        !implementation ||
        lastVerification?.status === "failed" ||
        lastVerification?.status === "blocked";
      if (needsImplementation) {
        const artifact = await executeStage(
          run.id,
          task,
          project,
          implementStage,
          cycle,
          { plan, implementation, verification },
        );
        implementation = artifact?.content;
        patchRun(run.id, { implementation });
        if (currentRun(run.id)?.pauseAfterStage) {
          patchRun(run.id, { status: "paused" });
          return run.id;
        }
      }
      const verifyArtifact = await executeStage(
        run.id,
        task,
        project,
        verifyStage,
        cycle,
        { plan, implementation, verification },
      );
      if (!verifyArtifact) {
        patchRun(run.id, {
          status: "paused",
          error: "Verification needs manual review before the workflow can continue.",
        });
        return run.id;
      }
      verification =
        verifyArtifact.findings || verifyArtifact.content || verifyArtifact.summary;
      patchRun(run.id, { verification });
      if (verifyArtifact.verdict === "passed") {
        const fresh = currentRun(run.id)!;
        const report =
          verifyArtifact.reportMarkdown ||
          reportFallback(task, verifyArtifact, fresh);
        let reportPath: string | undefined;
        if (template.writeReport) {
          const relativePath = workflowReportPath(
            template.reportPathTemplate,
            task,
            run.id,
          );
          reportPath = await writeWorkflowReport(
            project.path,
            relativePath,
            report,
          );
        }
        patchRun(run.id, {
          status: "passed",
          reportMarkdown: report,
          reportPath,
          finishedAt: Date.now(),
          currentStageId: undefined,
        });
        useCoDesStore.getState().updateTask(task.id, {
          column: "done",
          failure: undefined,
        });
        return run.id;
      }
      if (verifyArtifact.verdict === "blocked") {
        throw new Error(verifyArtifact.findings || "Verification was blocked.");
      }
      if (cycle >= template.maxRepairCycles)
        throw new Error(
          verifyArtifact.findings ||
            `Verification failed after ${template.maxRepairCycles} repair cycles.`,
        );
      cycle += 1;
      patchRun(run.id, { cycle, status: "repairing" });
    }
    return run.id;
  } catch (error) {
    const cancelled =
      activeWorkflows.get(run.id)?.cancelled ||
      String(error).includes("Workflow cancelled");
    patchRun(run.id, {
      status: cancelled ? "cancelled" : "failed",
      error: String(error),
      finishedAt: Date.now(),
      currentStageId: undefined,
    });
    useCoDesStore.getState().updateTask(task.id, {
      column: "working",
      failure: cancelled ? "Workflow cancelled" : String(error),
    });
    throw error;
  } finally {
    activeWorkflows.delete(run.id);
  }
}

export async function cancelWorkflow(runId: string) {
  const active = activeWorkflows.get(runId);
  if (active) {
    active.cancelled = true;
    if (active.sessionId) await sessionRuntime.stop(active.sessionId);
  } else {
    patchRun(runId, {
      status: "cancelled",
      finishedAt: Date.now(),
      error: "Cancelled by user.",
    });
  }
}

export function setWorkflowPauseAfterStage(runId: string, value: boolean) {
  patchRun(runId, { pauseAfterStage: value });
}

export function retryWorkflowStage(runId: string) {
  const run = currentRun(runId);
  if (!run || workflowIsActive(runId)) return;
  const last = [...run.stageRuns].reverse().find((item) =>
    ["failed", "blocked", "needs_review", "cancelled"].includes(item.status),
  );
  if (!last) return;
  patchRun(runId, {
    status: "interrupted",
    error: undefined,
    plan: last.role === "plan" ? undefined : run.plan,
    implementation:
      last.role === "plan" || last.role === "implement"
        ? undefined
        : run.implementation,
    verification: undefined,
    stageRuns: run.stageRuns.map((item) =>
      item.id === last.id ? { ...item, status: "queued" } : item,
    ),
  });
}

export function workflowIsActive(runId: string) {
  return activeWorkflows.has(runId);
}
