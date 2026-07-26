import { describe, expect, it } from "vitest";
import type { BoardTask, Project } from "../types";
import {
  defaultWorkflowTemplate,
  expandWorkflowPrompt,
  parseWorkflowArtifact,
  workflowReportPath,
} from "./workflowModel";

const task: BoardTask = {
  id: "task",
  projectId: "project",
  title: "Add workflow orchestration",
  description: "Coordinate three CLIs.",
  column: "ready",
  tags: [],
  position: 0,
};
const project: Project = {
  id: "project",
  workspaceId: "workspace",
  name: "Project",
  path: "C:\\project",
  color: "orange",
  position: 0,
  lastOpenedAt: 1,
};

describe("workflow model", () => {
  it("ships the requested plan, build, verify defaults", () => {
    expect(defaultWorkflowTemplate.stages.map((stage) => stage.provider)).toEqual([
      "codex",
      "antigravity",
      "reasonix",
    ]);
    expect(defaultWorkflowTemplate.maxRepairCycles).toBe(2);
  });

  it("expands stage prompts without interpreting unknown variables", () => {
    expect(
      expandWorkflowPrompt(
        "{task.title}|{project.path}|{plan}|{cycle}|{unknown}",
        { task, project, plan: "The plan", cycle: 2 },
      ),
    ).toBe(
      "Add workflow orchestration|C:\\project|The plan|2|{unknown}",
    );
  });

  it("parses structured verification evidence", () => {
    const artifact = parseWorkflowArtifact(
      `output
CODES_RESULT_START
{"summary":"All good","content":"Verified","verdict":"passed","tests":["npm test: passed"],"reportMarkdown":"# Report"}
CODES_RESULT_END`,
      "verify",
    );
    expect(artifact?.verdict).toBe("passed");
    expect(artifact?.tests).toEqual(["npm test: passed"]);
  });

  it("pauses unverifiable verification output but keeps plan fallback", () => {
    expect(parseWorkflowArtifact("plain verification output", "verify")).toBeUndefined();
    expect(parseWorkflowArtifact("plain plan output", "plan")?.content).toContain(
      "plain plan output",
    );
  });

  it("creates a contained unique report path", () => {
    expect(
      workflowReportPath(
        ".codes/reports/{date}-{task.slug}-{run.id}.md",
        task,
        "run-1",
        new Date("2026-07-26T00:00:00Z"),
      ),
    ).toBe(
      ".codes/reports/2026-07-26-add-workflow-orchestration-run-1.md",
    );
  });
});
