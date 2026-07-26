import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  ExternalLink,
  GitCommit,
  GitPullRequest,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { appConfirm, appPrompt } from "../lib/dialogs";
import {
  cachedGitRepository,
  createGitReviewPrompt,
  deleteGitReviewPrompt,
  launchUrl,
  loadGitDiff,
  loadGitRepository,
  runGitOperation,
} from "../lib/native";
import { PROVIDER_IDS, providerMeta } from "../lib/providers";
import { sessionRuntime } from "../lib/sessionRuntime";
import { useCoDesStore } from "../store";
import type {
  GitDiff,
  GitOperation,
  GitProposal,
  GitRepositoryState,
  Provider,
} from "../types";

type GitTab = "changes" | "history" | "branches" | "pull_requests";
const secretValuePattern =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*["']?([^"',\s}\\]{12,})/i;
const credentialPrefixPattern =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{20,})/i;
const safeSecretValuePattern =
  /(?:process\.env|import\.meta\.env|\$\{|placeholder|example|sample|redacted|masked|your[_-]|change[_-]?me|undefined|null|^\*+$|^x+$)/i;

export function detectSecretRisk(paths: Iterable<string>, content: string) {
  for (const path of paths) {
    const name = path.split("\\").join("/").split("/").pop() ?? "";
    if (
      /^(?:id_rsa|id_ed25519|id_ecdsa|credentials|service-account)(?:\.json)?$/i.test(
        name,
      ) ||
      (/^\.env(?:\.[\w-]+)?$/i.test(name) &&
        !/\.(?:example|sample|template|dist)$/i.test(name))
    )
      return `Sensitive file selected: ${path}`;
  }
  for (const line of content.split("\n")) {
    const diffLine = line.replace(/^[+-](?![+-])/, "");
    if (credentialPrefixPattern.test(diffLine))
      return "A value with a known credential format was found in the diff.";
    const assigned = diffLine.match(secretValuePattern)?.[1];
    if (
      assigned &&
      !safeSecretValuePattern.test(assigned) &&
      /[A-Za-z]/.test(assigned) &&
      /[0-9_-]/.test(assigned)
    )
      return "A credential-like literal was assigned in the diff.";
  }
  return undefined;
}

interface GraphRow {
  top: string[];
  bottom: string[];
  lane: number;
  parentLanes: number[];
}

export function buildCommitGraph(
  commits: GitRepositoryState["commits"],
): GraphRow[] {
  let lanes: string[] = [];
  return commits.map((commit) => {
    if (!lanes.includes(commit.hash)) lanes = [commit.hash, ...lanes];
    const top = [...lanes];
    const lane = top.indexOf(commit.hash);
    const remaining = top.filter((hash) => hash !== commit.hash);
    const parents = commit.parents ?? [];
    const bottom = [...remaining];
    parents.forEach((parent, index) => {
      if (!bottom.includes(parent))
        bottom.splice(Math.min(lane + index, bottom.length), 0, parent);
    });
    lanes = bottom;
    return {
      top,
      bottom,
      lane,
      parentLanes: parents.map((parent) => bottom.indexOf(parent)),
    };
  });
}

const graphColors = [
  "#d97757",
  "#5b8def",
  "#4fa47a",
  "#b779d0",
  "#d6a84b",
  "#d05e83",
];

function cleanTerminal(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
}

function jsonObjectCandidates(value: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

export function parseGitProposal(
  output: string,
  root: string,
  snapshotId: string,
  provider: Provider,
  allowedPaths: Set<string>,
): GitProposal {
  const clean = cleanTerminal(output).replace(/^```(?:json)?|```$/gim, "");
  const candidates = jsonObjectCandidates(clean);
  let value: Partial<GitProposal> | undefined;
  for (const candidate of [...candidates].reverse()) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GitProposal>;
      if (Array.isArray(parsed.commitGroups)) {
        value = parsed;
        break;
      }
    } catch {
      // Terminal output may contain other JSON-shaped status messages.
    }
  }
  if (!value)
    throw new Error("The provider did not return a structured Git proposal.");
  const commitGroups = Array.isArray(value.commitGroups)
    ? value.commitGroups.map((group) => {
        const proposedPaths = Array.isArray(group.paths)
          ? group.paths.filter(
              (path): path is string => typeof path === "string",
            )
          : [];
        const paths = proposedPaths.flatMap((path) => {
          const normalized = path.split("\\").join("/").replace(/\/+$/, "");
          if (allowedPaths.has(normalized)) return [normalized];
          const children = [...allowedPaths].filter((allowed) =>
            allowed.startsWith(`${normalized}/`),
          );
          if (children.length) return children;
          throw new Error(
            `The provider proposal added "${path}" outside the selected scope.`,
          );
        });
        return {
          paths,
          message: typeof group.message === "string" ? group.message.trim() : "",
        };
      })
    : [];
  const flattenedPaths = commitGroups.flatMap((group) => group.paths);
  if (
    !commitGroups.length ||
    commitGroups.some((group) => !group.paths.length || !group.message) ||
    new Set(flattenedPaths).size !== flattenedPaths.length
  )
    throw new Error("The provider proposal did not contain valid commit groups.");
  const proposedPaths = new Set(flattenedPaths);
  if (
    proposedPaths.size !== allowedPaths.size ||
    [...allowedPaths].some((path) => !proposedPaths.has(path))
  )
    throw new Error("The provider proposal changed the selected file scope.");
  const branchAction =
    value.branchAction &&
    (value.branchAction.kind === "create" ||
      value.branchAction.kind === "switch") &&
    typeof value.branchAction.name === "string" &&
    value.branchAction.name.trim()
      ? { kind: value.branchAction.kind, name: value.branchAction.name.trim() }
      : undefined;
  const pushTarget =
    value.pushTarget &&
    typeof value.pushTarget.remote === "string" &&
    value.pushTarget.remote.trim() &&
    typeof value.pushTarget.branch === "string" &&
    value.pushTarget.branch.trim()
      ? {
          remote: value.pushTarget.remote.trim(),
          branch: value.pushTarget.branch.trim(),
        }
      : undefined;
  const pullRequest =
    value.pullRequest &&
    typeof value.pullRequest.title === "string" &&
    value.pullRequest.title.trim()
      ? {
          title: value.pullRequest.title.trim(),
          body:
            typeof value.pullRequest.body === "string"
              ? value.pullRequest.body
              : "",
          base:
            typeof value.pullRequest.base === "string" &&
            value.pullRequest.base.trim()
              ? value.pullRequest.base.trim()
              : undefined,
          draft: value.pullRequest.draft !== false,
        }
      : undefined;
  return {
    repositoryRoot: root,
    snapshotId,
    provider,
    summary:
      typeof value.summary === "string" ? value.summary : "AI Git proposal",
    findings: Array.isArray(value.findings)
      ? value.findings.filter(
          (finding): finding is string => typeof finding === "string",
        )
      : [],
    commitGroups,
    branchAction,
    pushTarget,
    pullRequest,
  };
}

export function branchIsProtected(branch: string, patterns: string[]) {
  return patterns.some((pattern) => {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .split("*")
      .join(".*");
    return new RegExp(`^${escaped}$`, "i").test(branch);
  });
}

export function mayAutoApplyGitProposal(
  mode: "verify_first" | "full_auto",
  credentialWarning?: string,
) {
  return mode === "full_auto" && !credentialWarning;
}

function formatCount(value?: number) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function diffHunks(content: string) {
  const lines = content.split("\n");
  const prefix: string[] = [];
  const hunks: Array<{ title: string; patch: string }> = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current)
        hunks.push({
          title: current[0],
          patch: [...prefix, ...current].join("\n"),
        });
      current = [line];
    } else if (current) current.push(line);
    else prefix.push(line);
  }
  if (current)
    hunks.push({
      title: current[0],
      patch: [...prefix, ...current].join("\n"),
    });
  return hunks;
}

function BranchGraph({
  commits,
}: {
  commits: GitRepositoryState["commits"];
}) {
  const rows = useMemo(() => buildCommitGraph(commits), [commits]);
  const laneWidth = 15;
  return (
    <div className="git-branch-graph" aria-label="Commit branch topology">
      {commits.map((commit, index) => {
        const row = rows[index];
        const laneCount = Math.max(row.top.length, row.bottom.length, 1);
        const width = laneCount * laneWidth + 10;
        const x = (lane: number) => 8 + lane * laneWidth;
        const surviving = row.top
          .map((hash, lane) => ({
            lane,
            target: row.bottom.indexOf(hash),
          }))
          .filter(
            (item) => item.lane !== row.lane && item.target >= 0,
          );
        return (
          <article key={commit.hash}>
            <svg
              viewBox={`0 0 ${width} 56`}
              width={width}
              height="56"
              aria-hidden="true"
            >
              {surviving.map((item) => (
                <path
                  key={`lane-${item.lane}`}
                  d={`M ${x(item.lane)} 0 C ${x(item.lane)} 28 ${x(item.target)} 28 ${x(item.target)} 56`}
                  stroke={graphColors[item.lane % graphColors.length]}
                />
              ))}
              <path
                d={`M ${x(row.lane)} 0 L ${x(row.lane)} 28`}
                stroke={graphColors[row.lane % graphColors.length]}
              />
              {row.parentLanes.map((parentLane, parentIndex) => (
                <path
                  key={`parent-${parentIndex}`}
                  d={`M ${x(row.lane)} 28 C ${x(row.lane)} 43 ${x(parentLane)} 43 ${x(parentLane)} 56`}
                  stroke={
                    graphColors[
                      (row.lane + parentIndex) % graphColors.length
                    ]
                  }
                />
              ))}
              <circle
                cx={x(row.lane)}
                cy="28"
                r="4.5"
                fill="var(--surface)"
                stroke={graphColors[row.lane % graphColors.length]}
              />
            </svg>
            <div>
              <strong>{commit.subject}</strong>
              <small>
                <code>{commit.hash}</code>
                <span>{commit.author}</span>
                <time dateTime={new Date(commit.timestamp).toISOString()}>
                  {new Date(commit.timestamp).toLocaleString()}
                </time>
              </small>
              {Boolean(commit.decorations?.length) && (
                <span className="git-graph-refs">
                  {commit.decorations?.map((reference) => (
                    <em key={reference}>{reference}</em>
                  ))}
                </span>
              )}
            </div>
          </article>
        );
      })}
      {!commits.length && (
        <div className="git-list-empty">
          <CircleDot />
          <strong>No commits yet</strong>
          <span>The branch graph appears after the first commit.</span>
        </div>
      )}
    </div>
  );
}

export function GitWorkspace({ topbar }: { topbar: React.ReactNode }) {
  const app = useCoDesStore();
  const project = app.projects.find((item) => item.id === app.activeProjectId);
  const [repository, setRepository] = useState<GitRepositoryState | undefined>(
    () => (project ? cachedGitRepository(project.path) : undefined),
  );
  const [tab, setTab] = useState<GitTab>("changes");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string>();
  const [diff, setDiff] = useState<GitDiff>();
  const [stagedDiff, setStagedDiff] = useState(false);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<Provider>(
    app.settings.gitDefaultProvider,
  );
  const [profileId, setProfileId] = useState(
    app.settings.gitDefaultProfileId ?? "",
  );
  const [model, setModel] = useState("");
  const [targetRemote, setTargetRemote] = useState("origin");
  const [targetBranch, setTargetBranch] = useState("");
  const [proposal, setProposal] = useState<GitProposal>();
  const [proposalWarning, setProposalWarning] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const operationCounter = useRef(0);

  const refresh = async (force = false, silent = false) => {
    if (!project) return;
    const counter = ++operationCounter.current;
    if (!silent) setBusy("Reading repository");
    setError("");
    try {
      const next = await loadGitRepository(project.path, force);
      if (counter !== operationCounter.current) return;
      setRepository(next);
      setTargetRemote((current) =>
        next.remotes.some((remote) => remote.name === current)
          ? current
          : (next.remotes[0]?.name ?? ""),
      );
      setTargetBranch((current) => current || next.head || "");
      setSelected((current) => {
        const valid = new Set(next.files.map((file) => file.path));
        return new Set([...current].filter((path) => valid.has(path)));
      });
      if (activeFile && !next.files.some((file) => file.path === activeFile))
        setActiveFile(undefined);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      if (counter === operationCounter.current) setBusy("");
    }
  };

  useEffect(() => {
    if (!project) {
      setRepository(undefined);
      return;
    }
    const cached = cachedGitRepository(project.path);
    setRepository(cached);
    void refresh(false, Boolean(cached));
  }, [project?.path]);

  useEffect(() => {
    if (!project || !activeFile) {
      setDiff(undefined);
      return;
    }
    setBusy("Reading diff");
    void loadGitDiff(project.path, activeFile, stagedDiff)
      .then(setDiff)
      .catch((nextError) => setError(String(nextError)))
      .finally(() => setBusy(""));
  }, [project?.path, activeFile, stagedDiff, repository?.files]);

  const execute = async (operation: GitOperation, label: string) => {
    if (!project) return;
    setBusy(label);
    setError("");
    try {
      const result = await runGitOperation(project.path, operation);
      setRepository(result.state);
      setDiff(undefined);
      if (result.output) app.setMessage(result.output);
      return result.state;
    } catch (nextError) {
      const detail = String(nextError);
      setError(detail);
      app.setMessage(detail);
      throw nextError;
    } finally {
      setBusy("");
    }
  };

  const selectedFiles = useMemo(
    () => repository?.files.filter((file) => selected.has(file.path)) ?? [],
    [repository?.files, selected],
  );
  const stagedOutsideSelection =
    repository?.files.some((file) => file.staged && !selected.has(file.path)) ??
    false;

  async function commit() {
    if (!message.trim()) {
      setError("Write a commit message before committing.");
      return;
    }
    await execute(
      { kind: "commit", message: message.trim(), amend },
      amend ? "Amending commit" : "Creating commit",
    );
    setMessage("");
    setAmend(false);
  }

  async function snapshotSelection() {
    if (!project || !repository?.root || !selected.size)
      throw new Error("Select the files the AI may include.");
    const chunks = await Promise.all(
      [...selected].map(async (path) => {
        const file = repository.files.find((item) => item.path === path);
        const values: string[] = [];
        if (!file?.staged || file.partiallyStaged) {
          const value = await loadGitDiff(project.path, path, false);
          values.push(value.content);
        }
        if (file?.staged) {
          const value = await loadGitDiff(project.path, path, true);
          values.push(value.content);
        }
        return `### ${path}\n${values.join("\n")}`.slice(0, 80_000);
      }),
    );
    const content = chunks.join("\n\n").slice(0, 240_000);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${repository.root}\n${content}`),
    );
    const snapshotId = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return { content, snapshotId };
  }

  async function runAiReview() {
    if (!project || !repository?.root) return;
    if (!selected.size) {
      setError("Select the files the AI may review and commit.");
      return;
    }
    if (stagedOutsideSelection) {
      setError(
        "Unstage files outside the selection before running an AI commit.",
      );
      return;
    }
    setReviewing(true);
    setProposal(undefined);
    setProposalWarning("");
    setAiOutput("");
    setError("");
    let reviewPromptPath: string | undefined;
    try {
      const { content, snapshotId } = await snapshotSelection();
      const secretRisk = detectSecretRisk(selected, content);
      if (secretRisk) {
        const confirmed = await appConfirm({
          title: "Possible credential in selected changes",
          detail: `${secretRisk} Continue only if you checked the selected diff and it does not contain a real credential. Continuing sends the diff to ${providerMeta(provider).label}; Full Auto will pause for manual verification.`,
          confirmLabel: "Review with AI anyway",
          cancelLabel: "Keep changes private",
          tone: "danger",
        });
        if (!confirmed) {
          setError("AI review canceled. No selected changes were sent.");
          return;
        }
        setProposalWarning(secretRisk);
      }
      const prompt = `Review only the supplied Git diff. Return one JSON object and no prose.
Schema:
{"summary":"string","findings":["string"],"commitGroups":[{"paths":["exact/path"],"message":"type(scope): concise message"}],"branchAction":{"kind":"create|switch","name":"optional"},"pushTarget":{"remote":"optional","branch":"optional"},"pullRequest":{"title":"optional","body":"optional","base":"optional","draft":true}}
Rules:
- Every selected path must appear exactly once across commitGroups.
- Never add a path not listed below.
- Use Conventional Commit messages.
- Do not request force push, reset, checkout/discard, branch deletion, or conflict resolution.
- Findings must call out risky or unrelated changes.

Repository: ${repository.root}
Current branch: ${repository.head ?? "detached HEAD"}
Requested target: ${targetRemote || "(no remote)"}/${targetBranch || repository.head || "(no branch)"}
Selected paths:
${[...selected].map((path) => `- ${path}`).join("\n")}

Diff:
${content}`;
      const interactiveReview = provider === "antigravity";
      let launchPrompt: string | undefined;
      if (!interactiveReview) {
        reviewPromptPath = await createGitReviewPrompt(project.path, prompt);
        launchPrompt = `Read the complete UTF-8 Git review request at ${JSON.stringify(
          reviewPromptPath,
        )}. Follow that file exactly and return only the requested JSON object. Do not modify or delete the request file.`;
      }
      const sessionId = app.addSession(provider, "Git review", {
        projectId: project.id,
        cwd: project.path,
        mode: "plan",
        initialPrompt: launchPrompt,
        model: model.trim() || undefined,
        cliProfileId: profileId || undefined,
      });
      const session = useCoDesStore
        .getState()
        .sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error("Could not create the Git review session.");
      let output = "";
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = window.setTimeout(() => {
          finish(
            new Error(
              `${providerMeta(provider).label} did not return a Git proposal within 5 minutes.`,
            ),
          );
        }, 300_000);
        const finish = (failure?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          unsubscribe();
          unsubscribeOutput();
          if (failure) reject(failure);
          else resolve();
        };
        const unsubscribeOutput = sessionRuntime.subscribeOutput(
          session,
          (chunk) => {
            output += chunk;
            setAiOutput(cleanTerminal(output).slice(-8_000));
            if (interactiveReview) {
              try {
                parseGitProposal(
                  output,
                  repository.root ?? project.path,
                  snapshotId,
                  provider,
                  selected,
                );
                finish();
              } catch {
                // Keep collecting terminal output until a complete valid proposal arrives.
              }
            }
          },
        );
        const unsubscribe = sessionRuntime.subscribe(session, (event) => {
          if (event.event === "error") {
            finish(new Error(event.data.message));
          }
          if (event.event === "exit") {
            if (event.data.code === 0 && !interactiveReview) finish();
            else
              finish(
                new Error(
                  interactiveReview
                    ? `${providerMeta(provider).label} exited before returning a valid Git proposal.`
                    : `The ${providerMeta(provider).label} review exited with ${event.data.code ?? "a signal"}.`,
                ),
              );
          }
        });
        if (interactiveReview)
          void sessionRuntime
            .ensure(session)
            .then(() => sessionRuntime.prompt(session.id, prompt))
            .catch((error) => finish(new Error(String(error))));
      });
      if (interactiveReview) {
        await sessionRuntime.stop(session.id).catch(() => undefined);
        app.updateSession(session.id, {
          status: "completed",
          exitedAt: Date.now(),
        });
      }
      const next = parseGitProposal(
        output,
        repository.root,
        snapshotId,
        provider,
        selected,
      );
      if (
        next.pushTarget &&
        (next.pushTarget.remote !== targetRemote ||
          next.pushTarget.branch !== targetBranch)
      )
        throw new Error(
          "The provider changed the selected remote or target branch.",
      );
      setProposal(next);
      if (
        mayAutoApplyGitProposal(
          app.settings.gitAutomationMode,
          secretRisk,
        )
      )
        await applyProposal(next);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      if (reviewPromptPath)
        await deleteGitReviewPrompt(
          project.path,
          reviewPromptPath,
        ).catch(() => undefined);
      setReviewing(false);
    }
  }

  async function applyProposal(next = proposal) {
    if (!next || !repository || !project) return;
    const currentSnapshot = await snapshotSelection();
    if (currentSnapshot.snapshotId !== next.snapshotId) {
      setError(
        "The working tree changed after the AI review. Run the review again.",
      );
      return;
    }
    if (next.branchAction) {
      if (next.branchAction.kind === "create")
        await execute(
          { kind: "create_branch", name: next.branchAction.name },
          "Creating branch",
        );
      else
        await execute(
          { kind: "switch_branch", name: next.branchAction.name },
          "Switching branch",
        );
    }
    const selectedTracked = selectedFiles.filter(
      (file) => file.indexStatus !== "untracked",
    );
    if (selectedTracked.length)
      await execute(
        {
          kind: "unstage",
          paths: selectedTracked.map((file) => file.path),
        },
        "Preparing commit groups",
      );
    for (const group of next.commitGroups) {
      await execute({ kind: "stage", paths: group.paths }, "Staging commit");
      await execute(
        { kind: "commit", message: group.message },
        "Creating AI commit",
      );
    }
    if (next.pushTarget) {
      if (
        branchIsProtected(
          next.pushTarget.branch,
          app.settings.gitProtectedBranches,
        )
      ) {
        setError(
          `${next.pushTarget.branch} is protected. Review the commits and push manually.`,
        );
        return;
      }
      await execute(
        {
          kind: "push",
          remote: next.pushTarget.remote,
          branch: next.pushTarget.branch,
          setUpstream: true,
        },
        "Pushing AI commits",
      );
      if (next.pullRequest)
        await execute(
          {
            kind: "create_pr",
            title: next.pullRequest.title,
            body: next.pullRequest.body,
            base: next.pullRequest.base,
            draft: next.pullRequest.draft,
          },
          "Creating AI pull request",
        );
    }
    setProposal(undefined);
    setProposalWarning("");
    setSelected(new Set());
    app.setMessage("AI Git proposal applied.");
  }

  async function createPullRequest() {
    const title = await appPrompt({
      title: "Create pull request",
      inputLabel: "Title",
      inputPlaceholder: "Describe the change",
      confirmLabel: "Continue",
    });
    if (!title) return;
    const body =
      (await appPrompt({
        title: "Pull request details",
        inputLabel: "Description",
        inputPlaceholder: "What changed and how was it tested?",
        confirmLabel: "Create draft",
      })) ?? "";
    await execute(
      { kind: "create_pr", title, body, draft: true },
      "Creating draft pull request",
    );
  }

  if (!project)
    return (
      <main className="main-scroll git-workspace">
        {topbar}
        <div className="git-empty">
          <GitCommit />
          <h2>Select a project</h2>
          <p>Git follows the active project in this workspace.</p>
        </div>
      </main>
    );

  return (
    <main className="git-workspace">
      {topbar}
      <header className="git-command-bar">
        <div className="git-repository-mark">
          <GitCommit />
          <span>
            <strong>{project.name}</strong>
            <small>
              {repository?.isRepository
                ? `${repository.head ?? "detached HEAD"} · ↑${repository.ahead} ↓${repository.behind}`
                : "Not initialized"}
            </small>
          </span>
        </div>
        <nav aria-label="Git workspace">
          {(
            [
              ["changes", `Changes ${repository?.files.length ?? 0}`],
              ["history", "History"],
              ["branches", "Branches"],
              ["pull_requests", "Pull requests"],
            ] as Array<[GitTab, string]>
          ).map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="git-sync-actions">
          <button
            className="secondary-button"
            disabled={Boolean(busy) || !repository?.isRepository}
            onClick={() => void execute({ kind: "fetch" }, "Fetching remotes")}
          >
            <RefreshCw className={busy ? "spin" : ""} /> Fetch
          </button>
          <button
            className="secondary-button"
            disabled={Boolean(busy) || !repository?.isRepository}
            onClick={() =>
              void execute({ kind: "pull" }, "Pulling fast-forward changes")
            }
          >
            <ChevronRight /> Pull
          </button>
          <button
            className="primary-button"
            disabled={
              Boolean(busy) ||
              !repository?.head ||
              !repository.remotes.length
            }
            onClick={() => {
              if (!repository?.head) return;
              const head = repository.head;
              const push = () =>
                execute(
                  {
                    kind: "push",
                    remote: repository.remotes[0]?.name ?? "origin",
                    branch: head,
                    setUpstream: true,
                  },
                  "Pushing branch",
                );
              if (
                branchIsProtected(head, app.settings.gitProtectedBranches)
              ) {
                void appConfirm({
                  title: `Push protected branch ${head}?`,
                  detail:
                    "This branch is protected by your CoDes policy. Review the commits and remote before continuing.",
                  confirmLabel: "Push after review",
                }).then((confirmed) => {
                  if (confirmed) return push();
                });
                return;
              }
              void push();
            }}
          >
            <Upload /> Push
          </button>
        </div>
      </header>
      {(error || busy) && (
        <div className={`git-notice ${error ? "error" : ""}`} role="status">
          {error ? <AlertTriangle /> : <RefreshCw className="spin" />}
          <span>{error || busy}</span>
          {error && (
            <button onClick={() => setError("")} aria-label="Dismiss Git error">
              ×
            </button>
          )}
        </div>
      )}
      {repository?.isRepository &&
        (repository.mergeInProgress ||
          repository.rebaseInProgress ||
          repository.cherryPickInProgress ||
          repository.revertInProgress) && (
          <div className="git-conflict-bar" role="status">
            <AlertTriangle />
            <span>
              <strong>
                {repository.rebaseInProgress
                  ? "Rebase"
                  : repository.cherryPickInProgress
                    ? "Cherry-pick"
                    : repository.revertInProgress
                      ? "Revert"
                      : "Merge"}{" "}
                paused
              </strong>
              <small>
                Resolve the listed conflicts, stage the resolutions, then
                continue or abort.
              </small>
            </span>
            <button
              onClick={() => {
                const operation = repository.rebaseInProgress
                  ? "rebase"
                  : repository.cherryPickInProgress
                    ? "cherry_pick"
                    : repository.revertInProgress
                      ? "revert"
                      : "merge";
                void execute(
                  { kind: "continue", operation },
                  `Continuing ${operation.replace("_", "-")}`,
                );
              }}
            >
              Continue
            </button>
            <button
              className="danger-link"
              onClick={() => {
                const operation = repository.rebaseInProgress
                  ? "rebase"
                  : repository.cherryPickInProgress
                    ? "cherry_pick"
                    : repository.revertInProgress
                      ? "revert"
                      : "merge";
                void execute(
                  { kind: "abort", operation },
                  `Aborting ${operation.replace("_", "-")}`,
                );
              }}
            >
              Abort
            </button>
          </div>
        )}
      {!repository?.isRepository ? (
        <section className="git-empty">
          <CircleDot />
          <h2>Start tracking this project</h2>
          <p>
            Initialize a repository here. CoDes will not create a remote or
            publish anything.
          </p>
          <button
            className="primary-button"
            onClick={() =>
              void execute({ kind: "init" }, "Initializing repository")
            }
          >
            Initialize Git
          </button>
        </section>
      ) : tab === "changes" ? (
        <section className="git-changes-layout">
          <aside className="git-change-list">
            <header>
              <label>
                <input
                  type="checkbox"
                  checked={
                    Boolean(repository.files.length) &&
                    selected.size === repository.files.length
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(repository.files.map((file) => file.path))
                        : new Set(),
                    )
                  }
                />
                <span>{selected.size || repository.files.length} files</span>
              </label>
              <button
                className="icon-button"
                onClick={() => void refresh(true)}
                aria-label="Refresh changes"
              >
                <RefreshCw />
              </button>
            </header>
            <div>
              {repository.files.map((file) => (
                <button
                  className={`git-file ${activeFile === file.path ? "active" : ""}`}
                  key={file.path}
                  onClick={() => {
                    setActiveFile(file.path);
                    setStagedDiff(file.staged);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    aria-label={`Select ${file.path}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(file.path);
                        else next.delete(file.path);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>
                      {file.path.split("/")[file.path.split("/").length - 1]}
                    </strong>
                    <small>{file.path}</small>
                  </span>
                  <em
                    className={
                      file.worktreeStatus !== "unknown"
                        ? file.worktreeStatus
                        : file.indexStatus
                    }
                  >
                    {file.partiallyStaged
                      ? "±"
                      : file.staged
                        ? "S"
                        : file.worktreeStatus.slice(0, 1).toUpperCase()}
                  </em>
                </button>
              ))}
              {!repository.files.length && (
                <div className="git-list-empty">
                  <Check />
                  <strong>Working tree clean</strong>
                  <span>New changes will appear here.</span>
                </div>
              )}
            </div>
            <footer>
              <button
                disabled={!selected.size}
                onClick={() =>
                  void execute(
                    { kind: "stage", paths: [...selected] },
                    "Staging files",
                  )
                }
              >
                Stage selected
              </button>
              <button
                disabled={!selectedFiles.some((file) => file.staged)}
                onClick={() =>
                  void execute(
                    {
                      kind: "unstage",
                      paths: selectedFiles
                        .filter((file) => file.staged)
                        .map((file) => file.path),
                    },
                    "Unstaging files",
                  )
                }
              >
                Unstage
              </button>
            </footer>
          </aside>
          <div className="git-diff-stage">
            <header>
              <span>
                <strong>{activeFile ?? "Select a changed file"}</strong>
                {diff && (
                  <small>
                    {diff.staged ? "Staged diff" : "Working tree diff"}
                    {diff.truncated ? " · truncated at 1 MB" : ""}
                  </small>
                )}
              </span>
              {activeFile && (
                <div className="segmented-control">
                  <button
                    className={!stagedDiff ? "active" : ""}
                    onClick={() => setStagedDiff(false)}
                  >
                    Working
                  </button>
                  <button
                    className={stagedDiff ? "active" : ""}
                    onClick={() => setStagedDiff(true)}
                  >
                    Staged
                  </button>
                </div>
              )}
            </header>
            {diff?.binary ? (
              <div className="git-diff-empty">Binary file cannot be previewed.</div>
            ) : diff?.content ? (
              <div className="git-hunks">
                {diffHunks(diff.content).length ? (
                  diffHunks(diff.content).map((hunk, index) => (
                    <section key={`${hunk.title}-${index}`}>
                      <header>
                        <code>{hunk.title}</code>
                        <button
                          onClick={() =>
                            void execute(
                              stagedDiff
                                ? {
                                    kind: "unstage_patch",
                                    patch: hunk.patch,
                                  }
                                : {
                                    kind: "stage_patch",
                                    patch: hunk.patch,
                                  },
                              stagedDiff ? "Unstaging hunk" : "Staging hunk",
                            )
                          }
                        >
                          {stagedDiff ? "Unstage hunk" : "Stage hunk"}
                        </button>
                      </header>
                      <pre className="git-diff">{hunk.patch}</pre>
                    </section>
                  ))
                ) : (
                  <pre className="git-diff">{diff.content}</pre>
                )}
              </div>
            ) : (
              <div className="git-diff-empty">
                <Search />
                <span>
                  {activeFile
                    ? "No diff exists in this layer."
                    : "Choose a file to inspect its exact patch."}
                </span>
              </div>
            )}
          </div>
          <aside className="git-commit-rail">
            <section className="git-ai-review">
              <header>
                <Sparkles />
                <span>
                  <strong>AI commit architect</strong>
                  <small>
                    {app.settings.gitAutomationMode === "full_auto"
                      ? "Full auto with safety stops"
                      : "Proposal requires verification"}
                  </small>
                </span>
              </header>
              <label>
                <span>Provider</span>
                <div className="provider-select">
                  <ProviderIcon provider={provider} compact />
                  <select
                    value={provider}
                    onChange={(event) => {
                      const next = event.target.value as Provider;
                      setProvider(next);
                      setProfileId("");
                      app.updateSettings({ gitDefaultProvider: next });
                    }}
                  >
                    {PROVIDER_IDS.map((id) => (
                      <option value={id} key={id}>
                        {providerMeta(id).label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <div className="git-ai-grid">
                <label>
                  <span>Profile</span>
                  <select
                    value={profileId}
                    onChange={(event) => {
                      setProfileId(event.target.value);
                      app.updateSettings({
                        gitDefaultProfileId: event.target.value || undefined,
                      });
                    }}
                  >
                    <option value="">Default CLI</option>
                    {app.cliProfiles
                      .filter((profile) => profile.provider === provider)
                      .map((profile) => (
                        <option value={profile.id} key={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>Model / profile</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Provider default"
                  />
                </label>
                <label>
                  <span>Remote</span>
                  <select
                    value={targetRemote}
                    onChange={(event) => setTargetRemote(event.target.value)}
                  >
                    {!repository.remotes.length && (
                      <option value="">No remote</option>
                    )}
                    {repository.remotes.map((remote) => (
                      <option value={remote.name} key={remote.name}>
                        {remote.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Target branch</span>
                  <input
                    value={targetBranch}
                    onChange={(event) => setTargetBranch(event.target.value)}
                    placeholder={repository.head ?? "feature/name"}
                  />
                </label>
              </div>
              <button
                className="ai-review-button"
                disabled={!selected.size || reviewing || Boolean(busy)}
                onClick={() => void runAiReview()}
              >
                {reviewing ? <RefreshCw className="spin" /> : <Bot />}
                {reviewing ? "Reviewing selected diff" : "Review and propose"}
              </button>
              {aiOutput && reviewing && <pre>{aiOutput}</pre>}
              {proposal && (
                <div className="git-proposal">
                  <strong>{proposal.summary}</strong>
                  {proposalWarning && (
                    <p>
                      <ShieldCheck /> You approved a possible credential warning.
                      Review this proposal manually before applying it.
                    </p>
                  )}
                  {proposal.findings.map((finding) => (
                    <p key={finding}>
                      <AlertTriangle /> {finding}
                    </p>
                  ))}
                  {proposal.commitGroups.map((group) => (
                    <div key={group.message}>
                      <GitCommit />
                      <span>
                        <strong>{group.message}</strong>
                        <small>{group.paths.join(", ")}</small>
                      </span>
                    </div>
                  ))}
                  <button
                    className="primary-button"
                    onClick={() => void applyProposal()}
                  >
                    <ShieldCheck /> Apply verified proposal
                  </button>
                </div>
              )}
            </section>
            <section className="git-manual-commit">
              <label>
                <span>Commit message</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="type(scope): describe the change"
                  rows={4}
                />
              </label>
              <label className="git-amend">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(event) => setAmend(event.target.checked)}
                />
                Amend the previous commit
              </label>
              <button
                className="primary-button"
                disabled={
                  !message.trim() ||
                  !repository.files.some((file) => file.staged)
                }
                onClick={() => void commit()}
              >
                <GitCommit /> {amend ? "Amend commit" : "Commit staged"}
              </button>
            </section>
          </aside>
        </section>
      ) : tab === "history" ? (
        <section className="git-ledger">
          <header>
            <h2>Commit ledger</h2>
            <span>{repository.commits.length} recent commits</span>
          </header>
          {repository.commits.map((commit) => (
            <article key={commit.hash}>
              <GitCommit />
              <span>
                <strong>{commit.subject}</strong>
                <small>
                  {commit.hash} · {commit.author} ·{" "}
                  {new Date(commit.timestamp).toLocaleString()}
                </small>
              </span>
              <button
                onClick={() =>
                  void appConfirm({
                    title: `Revert ${commit.hash}?`,
                    detail:
                      "This creates a new commit that reverses the selected commit.",
                    confirmLabel: "Create revert commit",
                  }).then((confirmed) => {
                    if (confirmed)
                      return execute(
                        { kind: "revert", revision: commit.hash },
                        "Reverting commit",
                      );
                  })
                }
              >
                Revert
              </button>
              <button
                onClick={() =>
                  void execute(
                    { kind: "cherry_pick", revision: commit.hash },
                    "Cherry-picking commit",
                  )
                }
              >
                Cherry-pick
              </button>
            </article>
          ))}
        </section>
      ) : tab === "branches" ? (
        <section className="git-refs-layout">
          <div className="git-branch-graph-panel">
            <header>
              <span>
                <h2>Branch topology</h2>
                <small>
                  {repository.commits.length} commits across local and remote
                  refs
                </small>
              </span>
              <span className="git-graph-key" aria-label="Graph color legend">
                {graphColors.slice(0, 4).map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
            </header>
            <BranchGraph commits={repository.commits} />
          </div>
          <div className="git-branch-list-panel">
            <header>
              <h2>Branches</h2>
              <button
                className="secondary-button"
                onClick={() =>
                  void appPrompt({
                    title: "Create branch",
                    inputLabel: "Branch name",
                    inputPlaceholder: "feature/short-name",
                    confirmLabel: "Create branch",
                  }).then((name) => {
                    if (name)
                      return execute(
                        { kind: "create_branch", name },
                        "Creating branch",
                      );
                  })
                }
              >
                <Plus /> Create branch
              </button>
            </header>
            {repository.branches.map((branch) => (
              <article key={`${branch.remote}-${branch.name}`}>
                <CircleDot filled={branch.current} />
                <span>
                  <strong>{branch.name}</strong>
                  <small>
                    {branch.remote
                      ? "Remote branch"
                      : branch.upstream
                        ? `${branch.upstream} · ↑${branch.ahead} ↓${branch.behind}`
                        : "Local branch"}
                  </small>
                </span>
                {!branch.current && !branch.remote && (
                  <>
                    <button
                      onClick={() =>
                        void execute(
                          { kind: "switch_branch", name: branch.name },
                          "Switching branch",
                        )
                      }
                    >
                      Switch
                    </button>
                    <button
                      onClick={() =>
                        void execute(
                          { kind: "merge", branch: branch.name },
                          "Merging branch",
                        )
                      }
                    >
                      Merge
                    </button>
                    <button
                      onClick={() =>
                        void execute(
                          { kind: "rebase", branch: branch.name },
                          "Rebasing branch",
                        )
                      }
                    >
                      Rebase
                    </button>
                    <button
                      className="danger-link"
                      onClick={() =>
                        void appConfirm({
                          title: `Delete ${branch.name}?`,
                          detail:
                            "Git will refuse if the branch contains unmerged commits.",
                          confirmLabel: "Delete branch",
                          tone: "danger",
                        }).then((confirmed) => {
                          if (confirmed)
                            return execute(
                              {
                                kind: "delete_branch",
                                name: branch.name,
                              },
                              "Deleting branch",
                            );
                        })
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
                {branch.current && (
                  <button
                    onClick={() =>
                      void appPrompt({
                        title: "Rename current branch",
                        inputLabel: "Branch name",
                        inputValue: branch.name,
                        confirmLabel: "Rename branch",
                      }).then((name) => {
                        if (name && name !== branch.name)
                          return execute(
                            { kind: "rename_branch", name },
                            "Renaming branch",
                          );
                      })
                    }
                  >
                    Rename
                  </button>
                )}
              </article>
            ))}
          </div>
          <div>
            <section>
              <header>
                <h2>Stashes</h2>
                <button
                  onClick={() =>
                    void execute(
                      { kind: "stash", includeUntracked: true },
                      "Stashing changes",
                    )
                  }
                >
                  Stash changes
                </button>
              </header>
              {repository.stashes.map((stash) => (
                <article key={stash.reference}>
                  <span>
                    <strong>{stash.reference}</strong>
                    <small>{stash.message}</small>
                  </span>
                  <button
                    onClick={() =>
                      void execute(
                        { kind: "stash_apply", index: stash.index },
                        "Applying stash",
                      )
                    }
                  >
                    Apply
                  </button>
                  <button
                    onClick={() =>
                      void execute(
                        { kind: "stash_apply", index: stash.index, pop: true },
                        "Popping stash",
                      )
                    }
                  >
                    Pop
                  </button>
                </article>
              ))}
              {!repository.stashes.length && <p>No saved stashes.</p>}
            </section>
            <section>
              <header>
                <h2>Tags</h2>
                <button
                  onClick={() =>
                    void appPrompt({
                      title: "Create tag",
                      inputLabel: "Tag name",
                      inputPlaceholder: "v1.0.0",
                      confirmLabel: "Create tag",
                    }).then((name) => {
                      if (name)
                        return execute(
                          { kind: "create_tag", name },
                          "Creating tag",
                        );
                    })
                  }
                >
                  Create tag
                </button>
              </header>
              {repository.tags.map((tag) => (
                <article key={tag.name}>
                  <span>
                    <strong>{tag.name}</strong>
                    <small>{tag.target}</small>
                  </span>
                  <button
                    className="danger-link"
                    onClick={() =>
                      void appConfirm({
                        title: `Delete tag ${tag.name}?`,
                        detail: "This deletes the local tag only.",
                        confirmLabel: "Delete tag",
                        tone: "danger",
                      }).then((confirmed) => {
                        if (confirmed)
                          return execute(
                            { kind: "delete_tag", name: tag.name },
                            "Deleting tag",
                          );
                      })
                    }
                  >
                    Delete
                  </button>
                </article>
              ))}
              {!repository.tags.length && <p>No repository tags.</p>}
            </section>
            <section>
              <header>
                <h2>Remotes</h2>
                <button
                  onClick={() =>
                    void appPrompt({
                      title: "Add remote",
                      inputLabel: "Remote name",
                      inputPlaceholder: "origin",
                      confirmLabel: "Continue",
                    }).then(async (name) => {
                      if (!name) return;
                      const url = await appPrompt({
                        title: `Add ${name}`,
                        inputLabel: "Remote URL",
                        inputPlaceholder: "https://github.com/owner/repo.git",
                        confirmLabel: "Add remote",
                      });
                      if (url)
                        return execute(
                          { kind: "add_remote", name, url },
                          "Adding remote",
                        );
                    })
                  }
                >
                  Add remote
                </button>
              </header>
              {repository.remotes.map((remote) => (
                <article key={remote.name}>
                  <Rocket />
                  <span>
                    <strong>{remote.name}</strong>
                    <small>{remote.fetchUrl}</small>
                  </span>
                  <button
                    className="danger-link"
                    onClick={() =>
                      void appConfirm({
                        title: `Delete remote ${remote.name}?`,
                        detail:
                          "This removes the local remote configuration without deleting the hosted repository.",
                        confirmLabel: "Delete remote",
                        tone: "danger",
                      }).then((confirmed) => {
                        if (confirmed)
                          return execute(
                            { kind: "remove_remote", name: remote.name },
                            "Deleting remote",
                          );
                      })
                    }
                  >
                    Delete
                  </button>
                </article>
              ))}
              {!repository.remotes.length && <p>No remotes configured.</p>}
            </section>
          </div>
        </section>
      ) : (
        <section className="git-pr-workspace">
          <header>
            <span>
              <h2>Pull requests</h2>
              <small>
                {repository.githubAuthenticated
                  ? "Authenticated through GitHub CLI"
                  : "Run gh auth login to enable pull requests"}
              </small>
            </span>
            <button
              className="primary-button"
              disabled={!repository.githubAuthenticated}
              onClick={() => void createPullRequest()}
            >
              <GitPullRequest /> Create draft PR
            </button>
          </header>
          {repository.pullRequests.map((pullRequest) => (
            <article className="git-pr-row" key={pullRequest.number}>
              <GitPullRequest />
              <span>
                <strong>
                  #{pullRequest.number} {pullRequest.title}
                </strong>
                <small>
                  {pullRequest.draft ? "DRAFT" : pullRequest.state} ·{" "}
                  {pullRequest.checks}
                </small>
              </span>
              <button
                onClick={() =>
                  void execute(
                    { kind: "checkout_pr", number: pullRequest.number },
                    "Checking out pull request",
                  )
                }
              >
                Checkout
              </button>
              {pullRequest.draft && (
                <button
                  onClick={() =>
                    void execute(
                      { kind: "mark_pr_ready", number: pullRequest.number },
                      "Marking pull request ready",
                    )
                  }
                >
                  Mark ready
                </button>
              )}
              <button
                className="icon-button"
                onClick={() => void launchUrl(pullRequest.url)}
                aria-label={`Open pull request ${pullRequest.number} on GitHub`}
              >
                <ExternalLink />
              </button>
            </article>
          ))}
          {!repository.pullRequests.length && (
            <div className="git-list-empty">
              <GitPullRequest />
              <strong>No open pull requests</strong>
              <span>
                Push a branch, then create a draft for review from this
                workspace.
              </span>
            </div>
          )}
        </section>
      )}
      <span className="sr-only" aria-live="polite">
        {formatCount(selected.size)} selected files
      </span>
    </main>
  );
}
