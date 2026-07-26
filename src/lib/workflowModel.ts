import type {
  BoardTask,
  Project,
  WorkflowArtifact,
  WorkflowStage,
  WorkflowTemplate,
} from "../types";

export const DEFAULT_WORKFLOW_ID = "plan-build-verify";

const resultContract = `
Finish with exactly one machine-readable result block:
CODES_RESULT_START
{"summary":"brief outcome","content":"full Markdown artifact","verdict":"passed|failed|blocked","findings":"actionable findings","tests":["command: result"],"reportMarkdown":"final Markdown report"}
CODES_RESULT_END
Only verification stages require verdict, findings, tests, and reportMarkdown.`;

export const defaultWorkflowTemplate: WorkflowTemplate = {
  id: DEFAULT_WORKFLOW_ID,
  name: "Plan, Build, Verify",
  description:
    "Codex plans, Antigravity implements, and Reasonix verifies with repair loops.",
  maxRepairCycles: 2,
  reportPathTemplate: ".codes/reports/{date}-{task.slug}-{run.id}.md",
  writeReport: true,
  builtIn: true,
  stages: [
    {
      id: "plan",
      name: "Plan",
      role: "plan",
      provider: "codex",
      mode: "plan",
      timeoutMinutes: 30,
      retryCount: 1,
      promptTemplate: `Plan the requested work after inspecting the real project. Do not modify files.

Task: {task.title}
Description:
{task.description}
Project: {project.path}

Produce a decision-complete implementation plan for the next coding agent.${resultContract}`,
    },
    {
      id: "implement",
      name: "Build",
      role: "implement",
      provider: "antigravity",
      mode: "auto",
      timeoutMinutes: 60,
      retryCount: 1,
      promptTemplate: `Implement the requested task completely in the current project.

Task: {task.title}
Description:
{task.description}
Project: {project.path}
Approved plan:
{plan}
Verification findings from the previous cycle:
{verification}
Repair cycle: {cycle}

Inspect the current workspace before editing, preserve unrelated user changes, run appropriate checks, and summarize the real outcome.${resultContract}`,
    },
    {
      id: "verify",
      name: "Verify",
      role: "verify",
      provider: "reasonix",
      mode: "plan",
      timeoutMinutes: 30,
      retryCount: 1,
      promptTemplate: `Verify the implementation without modifying project files.

Task: {task.title}
Description:
{task.description}
Project: {project.path}
Plan:
{plan}
Implementation summary:
{implementation}
Repair cycle: {cycle}

Inspect the diff and repository state, run the relevant tests, report defects with actionable evidence, and write a concise Markdown verification report. Use verdict "passed" only when the requested behavior and checks genuinely pass.${resultContract}`,
    },
  ],
};

export function normalizeWorkflowTemplate(
  value: Partial<WorkflowTemplate>,
  fallback = defaultWorkflowTemplate,
): WorkflowTemplate {
  const stages = Array.isArray(value.stages) && value.stages.length
    ? value.stages.map((stage, index) => normalizeStage(stage, fallback.stages[index] ?? fallback.stages[0], index))
    : fallback.stages.map((stage) => ({ ...stage }));
  return {
    id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallback.name,
    description: typeof value.description === "string" ? value.description : fallback.description,
    stages,
    maxRepairCycles: clamp(value.maxRepairCycles, 0, 10, fallback.maxRepairCycles),
    reportPathTemplate:
      typeof value.reportPathTemplate === "string" && value.reportPathTemplate.trim()
        ? value.reportPathTemplate.trim()
        : fallback.reportPathTemplate,
    writeReport: value.writeReport !== false,
    builtIn: value.builtIn === true,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

function normalizeStage(
  value: Partial<WorkflowStage>,
  fallback: WorkflowStage,
  index: number,
): WorkflowStage {
  return {
    id: typeof value.id === "string" && value.id ? value.id : `stage-${index + 1}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallback.name,
    role: ["plan", "implement", "verify"].includes(String(value.role))
      ? value.role!
      : fallback.role,
    provider: value.provider ?? fallback.provider,
    mode: value.mode ?? fallback.mode,
    model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : undefined,
    promptTemplate:
      typeof value.promptTemplate === "string" && value.promptTemplate.trim()
        ? value.promptTemplate
        : fallback.promptTemplate,
    timeoutMinutes: clamp(value.timeoutMinutes, 1, 240, fallback.timeoutMinutes),
    retryCount: clamp(value.retryCount, 0, 5, fallback.retryCount),
    cliProfileId:
      typeof value.cliProfileId === "string" && value.cliProfileId
        ? value.cliProfileId
        : undefined,
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.round(number)))
    : fallback;
}

export function expandWorkflowPrompt(
  template: string,
  context: {
    task: BoardTask;
    project: Project;
    plan?: string;
    implementation?: string;
    verification?: string;
    cycle: number;
  },
) {
  const values: Record<string, string> = {
    "task.title": context.task.title,
    "task.description": context.task.description || "No additional description.",
    "task.slug": slugify(context.task.title),
    "project.path": context.project.path,
    plan: context.plan || "No plan artifact is available.",
    implementation:
      context.implementation || "No implementation summary is available.",
    verification:
      context.verification || "No previous verification findings.",
    cycle: String(context.cycle),
  };
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

export function parseWorkflowArtifact(
  output: string,
  role: WorkflowStage["role"],
): WorkflowArtifact | undefined {
  const clean = stripAnsi(output).trim().slice(-250_000);
  const match = clean.match(
    /CODES_RESULT_START\s*([\s\S]*?)\s*CODES_RESULT_END/i,
  );
  if (!match) {
    if (role === "verify") return undefined;
    return { summary: lastMeaningfulLine(clean), content: clean.slice(-64_000) };
  }
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const verdict = ["passed", "failed", "blocked"].includes(
      String(parsed.verdict),
    )
      ? (parsed.verdict as WorkflowArtifact["verdict"])
      : undefined;
    if (role === "verify" && !verdict) return undefined;
    return {
      summary: String(parsed.summary ?? "").trim() || lastMeaningfulLine(clean),
      content: String(parsed.content ?? "").trim() || clean.slice(-64_000),
      verdict,
      findings: String(parsed.findings ?? "").trim() || undefined,
      tests: Array.isArray(parsed.tests)
        ? parsed.tests.map(String).filter(Boolean).slice(0, 100)
        : undefined,
      reportMarkdown:
        String(parsed.reportMarkdown ?? "").trim() || undefined,
    };
  } catch {
    return role === "verify"
      ? undefined
      : { summary: lastMeaningfulLine(clean), content: clean.slice(-64_000) };
  }
}

export function stripAnsi(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function lastMeaningfulLine(value: string) {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-1)[0]
      ?.slice(0, 300) || "Stage completed."
  );
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "workflow"
  );
}

export function workflowReportPath(
  template: string,
  task: BoardTask,
  runId: string,
  date = new Date(),
) {
  return template
    .split("{date}")
    .join(date.toISOString().slice(0, 10))
    .split("{task.slug}")
    .join(slugify(task.title))
    .split("{run.id}")
    .join(runId);
}
