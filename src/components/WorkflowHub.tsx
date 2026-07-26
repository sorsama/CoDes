import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { useCoDesStore } from "../store";
import type {
  CliEnvironmentOverride,
  CliProfile,
  Provider,
  SessionMode,
  WorkflowRun,
  WorkflowStage,
  WorkflowStageRole,
} from "../types";
import { PROVIDER_IDS, providerMeta } from "../lib/providers";
import { probeCli, revealPath } from "../lib/native";
import {
  cancelWorkflow,
  dispatchWorkflowTask,
  retryWorkflowStage,
  setWorkflowPauseAfterStage,
  workflowIsActive,
} from "../lib/workflowAutomation";

const modes: SessionMode[] = ["interactive", "auto", "plan", "full_access"];
const roles: WorkflowStageRole[] = ["plan", "implement", "verify"];

function environmentText(items: CliEnvironmentOverride[]) {
  return items
    .map((item) =>
      item.source === "inherit"
        ? item.name
        : `${item.name}=${item.secret ? "secret:" : ""}${item.value ?? ""}`,
    )
    .join("\n");
}

function parseEnvironment(value: string): CliEnvironmentOverride[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 0)
        return { name: line, source: "inherit" as const };
      const name = line.slice(0, separator).trim();
      const raw = line.slice(separator + 1);
      const secret = raw.startsWith("secret:");
      return {
        name,
        source: "literal" as const,
        value: secret ? raw.slice(7) : raw,
        secret,
      };
    });
}

function StageEditor({
  stage,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  stage: WorkflowStage;
  index: number;
  count: number;
  onChange: (patch: Partial<WorkflowStage>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const state = useCoDesStore();
  const profile = stage.cliProfileId
    ? state.cliProfiles.find((item) => item.id === stage.cliProfileId)
    : undefined;
  const [probe, setProbe] = useState("");
  const updateProfile = (patch: Partial<CliProfile>) => {
    const next: CliProfile = {
      id: profile?.id ?? crypto.randomUUID(),
      name: profile?.name ?? `${stage.name} CLI`,
      provider: stage.provider,
      executablePath: profile?.executablePath,
      extraArgs: profile?.extraArgs ?? [],
      environment: profile?.environment ?? [],
      ...patch,
    };
    state.updateCliProfile(next);
    if (!stage.cliProfileId) onChange({ cliProfileId: next.id });
  };
  return (
    <article className="workflow-stage-editor">
      <header>
        <span className="stage-order">{index + 1}</span>
        <ProviderIcon provider={stage.provider} />
        <input
          aria-label={`Stage ${index + 1} name`}
          value={stage.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <button
          className="icon-button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Move stage up"
        >
          <ChevronUp />
        </button>
        <button
          className="icon-button"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label="Move stage down"
        >
          <ChevronDown />
        </button>
        <button
          className="icon-button"
          disabled={count <= 3}
          onClick={onRemove}
          aria-label="Remove stage"
        >
          <Trash2 />
        </button>
      </header>
      <div className="workflow-stage-fields">
        <label>
          <span>Role</span>
          <select
            value={stage.role}
            onChange={(event) =>
              onChange({ role: event.target.value as WorkflowStageRole })
            }
          >
            {roles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Provider</span>
          <select
            value={stage.provider}
            onChange={(event) => {
              const provider = event.target.value as Provider;
              onChange({ provider, cliProfileId: undefined });
            }}
          >
            {PROVIDER_IDS.map((provider) => (
              <option key={provider} value={provider}>
                {providerMeta(provider).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mode</span>
          <select
            value={stage.mode}
            onChange={(event) =>
              onChange({ mode: event.target.value as SessionMode })
            }
          >
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Model</span>
          <input
            value={stage.model ?? ""}
            placeholder="Provider default"
            onChange={(event) =>
              onChange({ model: event.target.value || undefined })
            }
          />
        </label>
        <label>
          <span>Timeout</span>
          <input
            type="number"
            min="1"
            max="240"
            value={stage.timeoutMinutes}
            onChange={(event) =>
              onChange({ timeoutMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>Crash retries</span>
          <input
            type="number"
            min="0"
            max="5"
            value={stage.retryCount}
            onChange={(event) =>
              onChange({ retryCount: Number(event.target.value) })
            }
          />
        </label>
      </div>
      <label className="workflow-prompt">
        <span>Prompt template</span>
        <textarea
          rows={5}
          value={stage.promptTemplate}
          onChange={(event) => onChange({ promptTemplate: event.target.value })}
        />
      </label>
      <details className="workflow-advanced">
        <summary>Advanced CLI</summary>
        <label>
          <span>Executable path</span>
          <input
            value={profile?.executablePath ?? ""}
            placeholder="Use detected executable"
            onChange={(event) =>
              updateProfile({
                executablePath: event.target.value || undefined,
              })
            }
          />
        </label>
        <label>
          <span>Extra arguments</span>
          <input
            value={profile?.extraArgs.join(" ") ?? ""}
            placeholder="Arguments inserted before the prompt"
            onChange={(event) =>
              updateProfile({
                extraArgs: event.target.value
                  .split(/\s+/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label>
          <span>Environment</span>
          <textarea
            rows={3}
            value={environmentText(profile?.environment ?? [])}
            placeholder={"INHERITED_NAME\nNAME=value\nTOKEN=secret:session-value"}
            onChange={(event) =>
              updateProfile({ environment: parseEnvironment(event.target.value) })
            }
          />
          <small>
            Secret literals are redacted and are not saved across restarts.
          </small>
        </label>
        <div className="workflow-probe">
          <button
            className="secondary-button"
            onClick={() => {
              setProbe("Checking…");
              void probeCli({
                provider: stage.provider,
                executablePath: profile?.executablePath,
                extraArgs: profile?.extraArgs,
              })
                .then((tool) =>
                  setProbe(
                    tool.installed
                      ? tool.version || "Installed and ready"
                      : "Probe failed",
                  ),
                )
                .catch((error) => setProbe(String(error)));
            }}
          >
            <RefreshCw />
            Probe CLI
          </button>
          {probe && <small role="status">{probe}</small>}
        </div>
      </details>
    </article>
  );
}

function RunDetails({ run }: { run: WorkflowRun }) {
  const state = useCoDesStore();
  const task = state.tasks.find((item) => item.id === run.taskId);
  const active = workflowIsActive(run.id);
  const completed = run.stageRuns.filter((item) => item.status === "passed").length;
  const latestByStage = [...run.stageRuns].reverse().filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.stageId === item.stageId) === index,
  ).reverse();
  return (
    <section className="workflow-run-detail">
      <header>
        <div>
          <span>{run.templateName}</span>
          <h2>{task?.title ?? "Workflow run"}</h2>
        </div>
        <span className={`workflow-status ${run.status}`}>{run.status.replace("_", " ")}</span>
      </header>
      <div className="workflow-run-meta">
        <span>{completed} completed stage attempts</span>
        <span>Repair cycle {run.cycle}</span>
        <span>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not started"}</span>
      </div>
      <div className="workflow-stage-rail" aria-label="Workflow progression">
        {latestByStage.map((stage) => (
          <button
            key={stage.id}
            className={stage.status}
            onClick={() => {
              if (stage.sessionId) state.setActiveSession(stage.sessionId);
            }}
          >
            <span>{stage.status === "passed" ? <Check /> : <ProviderIcon provider={stage.provider} />}</span>
            <strong>{stage.name}</strong>
            <small>{stage.status.replace("_", " ")}</small>
          </button>
        ))}
      </div>
      <div className="workflow-run-actions">
        {["paused", "interrupted", "failed"].includes(run.status) && (
          <button
            className="primary-button"
            onClick={() => {
              setWorkflowPauseAfterStage(run.id, false);
              void dispatchWorkflowTask(run.taskId, run.id);
            }}
          >
            <Play />
            Resume
          </button>
        )}
        {["failed", "paused", "interrupted"].includes(run.status) &&
          run.stageRuns.some((item) =>
            ["failed", "blocked", "needs_review", "cancelled"].includes(
              item.status,
            ),
          ) && (
            <button
              className="secondary-button"
              onClick={() => {
                retryWorkflowStage(run.id);
                void dispatchWorkflowTask(run.taskId, run.id);
              }}
            >
              <RefreshCw />
              Retry stage
            </button>
          )}
        {active && (
          <>
            <button
              className="secondary-button"
              onClick={() => {
                setWorkflowPauseAfterStage(run.id, !run.pauseAfterStage);
              }}
            >
              {run.pauseAfterStage ? <Play /> : <Square />}
              {run.pauseAfterStage ? "Keep running" : "Pause after stage"}
            </button>
            <button
              className="danger-button"
              onClick={() => void cancelWorkflow(run.id)}
            >
              <Square />
              Cancel
            </button>
          </>
        )}
        {run.reportPath && (
          <button
            className="secondary-button"
            onClick={() => void revealPath(run.reportPath!)}
          >
            <FileText />
            Open report
          </button>
        )}
      </div>
      {run.error && <p className="workflow-error">{run.error}</p>}
      {run.plan && <details><summary>Plan</summary><pre>{run.plan}</pre></details>}
      {run.implementation && <details><summary>Implementation</summary><pre>{run.implementation}</pre></details>}
      {run.verification && <details><summary>Verification findings</summary><pre>{run.verification}</pre></details>}
      {run.reportMarkdown && <details open><summary>Final report</summary><pre>{run.reportMarkdown}</pre></details>}
      <details>
        <summary>Stage attempts and terminal evidence</summary>
        <div className="workflow-attempts">
          {[...run.stageRuns].reverse().map((stage) => (
            <article key={stage.id}>
              <header>
                <strong>{stage.name}</strong>
                <span>{stage.status} · attempt {stage.attempt} · cycle {stage.cycle}</span>
              </header>
              {stage.artifact?.summary && <p>{stage.artifact.summary}</p>}
              {stage.error && <p className="workflow-error">{stage.error}</p>}
              {stage.output && <pre>{stage.output}</pre>}
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}

export function WorkflowHub({
  topbar,
}: {
  topbar: React.ReactNode;
}) {
  const state = useCoDesStore();
  const templates = state.workflowTemplates;
  const [templateId, setTemplateId] = useState(
    state.settings.defaultWorkflowTemplateId,
  );
  const template =
    templates.find((item) => item.id === templateId) ?? templates[0];
  const projectRuns = useMemo(
    () =>
      state.workflowRuns
        .filter((item) => item.projectId === state.activeProjectId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.workflowRuns, state.activeProjectId],
  );
  const [runId, setRunId] = useState<string>();
  const run =
    projectRuns.find(
      (item) => item.id === (runId ?? state.activeWorkflowRunId),
    ) ?? projectRuns[0];
  const updateStage = (stageId: string, patch: Partial<WorkflowStage>) => {
    if (!template) return;
    state.updateWorkflowTemplate(template.id, {
      stages: template.stages.map((stage) =>
        stage.id === stageId ? { ...stage, ...patch } : stage,
      ),
    });
  };
  return (
    <main className="main-scroll workflows-view">
      {topbar}
      <div className="workflow-layout">
        <aside className="workflow-template-list">
          <header>
            <span>Templates</span>
            <button
              className="icon-button"
              aria-label="Add workflow template"
              onClick={() => {
                const id = state.addWorkflowTemplate();
                setTemplateId(id);
              }}
            >
              <Plus />
            </button>
          </header>
          {templates.map((item) => (
            <button
              key={item.id}
              className={item.id === template?.id ? "active" : ""}
              onClick={() => {
                setTemplateId(item.id);
                setRunId(undefined);
                state.setActiveWorkflowRun(undefined);
              }}
            >
              <ArrowRightLeft />
              <span><strong>{item.name}</strong><small>{item.stages.length} stages</small></span>
            </button>
          ))}
          <header className="run-history-heading"><span>Run history</span></header>
          {projectRuns.map((item) => (
            <button
              key={item.id}
              className={item.id === run?.id ? "active" : ""}
              onClick={() => {
                setRunId(item.id);
                state.setActiveWorkflowRun(item.id);
              }}
            >
              <span className={`run-dot ${item.status}`} />
              <span>
                <strong>{state.tasks.find((task) => task.id === item.taskId)?.title ?? item.templateName}</strong>
                <small>{item.status.replace("_", " ")}</small>
              </span>
            </button>
          ))}
        </aside>
        <div className="workflow-main">
          {run && (runId || state.activeWorkflowRunId) ? (
            <RunDetails run={run} />
          ) : template ? (
            <section className="workflow-editor">
              <header className="workflow-editor-heading">
                <div>
                  <input
                    value={template.name}
                    aria-label="Workflow name"
                    onChange={(event) =>
                      state.updateWorkflowTemplate(template.id, {
                        name: event.target.value,
                      })
                    }
                  />
                  <textarea
                    rows={2}
                    value={template.description}
                    aria-label="Workflow description"
                    onChange={(event) =>
                      state.updateWorkflowTemplate(template.id, {
                        description: event.target.value,
                      })
                    }
                  />
                </div>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const id = state.duplicateWorkflowTemplate(template.id);
                    setTemplateId(id);
                  }}
                >
                  <Copy />
                  Duplicate
                </button>
                {!template.builtIn && (
                  <button
                    className="danger-button"
                    onClick={() => {
                      state.removeWorkflowTemplate(template.id);
                      setTemplateId(state.settings.defaultWorkflowTemplateId);
                    }}
                  >
                    <Trash2 />
                    Delete
                  </button>
                )}
              </header>
              <div className="workflow-policy">
                <label>
                  <span>Repair cycles</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={template.maxRepairCycles}
                    onChange={(event) =>
                      state.updateWorkflowTemplate(template.id, {
                        maxRepairCycles: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  <span>Report path</span>
                  <input
                    value={template.reportPathTemplate}
                    disabled={!template.writeReport}
                    onChange={(event) =>
                      state.updateWorkflowTemplate(template.id, {
                        reportPathTemplate: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="setting-toggle compact-toggle">
                  <span><strong>Write Markdown</strong><small>Also keep the report in CoDes</small></span>
                  <input
                    type="checkbox"
                    checked={template.writeReport}
                    onChange={(event) =>
                      state.updateWorkflowTemplate(template.id, {
                        writeReport: event.target.checked,
                      })
                    }
                  />
                </label>
              </div>
              <div className="workflow-stage-list">
                {template.stages.map((stage, index) => (
                  <StageEditor
                    key={stage.id}
                    stage={stage}
                    index={index}
                    count={template.stages.length}
                    onChange={(patch) => updateStage(stage.id, patch)}
                    onMove={(direction) => {
                      const stages = [...template.stages];
                      const target = index + direction;
                      if (target < 0 || target >= stages.length) return;
                      [stages[index], stages[target]] = [stages[target], stages[index]];
                      state.updateWorkflowTemplate(template.id, { stages });
                    }}
                    onRemove={() =>
                      state.updateWorkflowTemplate(template.id, {
                        stages: template.stages.filter((item) => item.id !== stage.id),
                      })
                    }
                  />
                ))}
                <button
                  className="secondary-button workflow-add-stage"
                  onClick={() =>
                    state.updateWorkflowTemplate(template.id, {
                      stages: [
                        ...template.stages,
                        {
                          id: crypto.randomUUID(),
                          name: "New stage",
                          role: "implement",
                          provider: state.settings.defaultProvider,
                          mode: state.settings.defaultSessionMode,
                          promptTemplate:
                            "Complete this workflow stage for {task.title}. Use the prior plan: {plan}",
                          timeoutMinutes: 30,
                          retryCount: 1,
                        },
                      ],
                    })
                  }
                >
                  <Plus />
                  Add stage
                </button>
              </div>
            </section>
          ) : (
            <div className="widget-empty">
              <ArrowRightLeft />
              <strong>No workflow templates</strong>
              <span>Create a template to coordinate provider stages.</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
