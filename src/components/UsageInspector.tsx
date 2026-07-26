import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CircleDot,
  ExternalLink,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Upload,
  Zap,
} from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import {
  deleteUsageCredential,
  loadUsage,
  loadUsageConnectors,
  saveUsageConnector,
  syncLocalUsage,
  syncUsageConnector,
} from "../lib/native";
import { providerMeta } from "../lib/providers";
import { useCoDesStore } from "../store";
import type {
  UsageConnector,
  UsageRecord,
  UsageSourceKind,
} from "../types";

const connectorDefaults: Array<
  Pick<UsageConnector, "kind" | "label"> & { detail: string }
> = [
  {
    kind: "openai",
    label: "OpenAI organization",
    detail: "Usage and Costs API · Admin key",
  },
  {
    kind: "anthropic",
    label: "Anthropic organization",
    detail: "Usage, Cost, and Claude Code · Admin key",
  },
  {
    kind: "github",
    label: "GitHub AI credits",
    detail: "Personal or organization billing · gh authentication",
  },
  {
    kind: "google",
    label: "Google Gemini API",
    detail: "Cloud Monitoring token metrics · gcloud authentication",
  },
];

function compact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function providerIcon(provider: string) {
  return provider === "openai"
    ? "codex"
    : provider === "anthropic"
      ? "claude"
      : provider === "google"
        ? "antigravity"
        : provider;
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.split('"').join('""')}"`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function ConnectorEditor({
  connector,
  onSaved,
}: {
  connector: UsageConnector;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(connector);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(connector), [connector]);
  const needsSecret = draft.kind === "openai" || draft.kind === "anthropic";
  return (
    <details className="usage-connector">
      <summary>
        <ProviderIcon provider={providerIcon(draft.kind)} compact />
        <span>
          <strong>{draft.label}</strong>
          <small>
            {draft.lastError
              ? draft.lastError
              : draft.lastSyncedAt
                ? `Updated ${new Date(draft.lastSyncedAt).toLocaleString()}`
                : draft.hasCredential || !needsSecret
                  ? "Ready to refresh"
                  : "Credential required"}
          </small>
        </span>
        <em
          className={
            draft.lastError
              ? "error"
              : draft.enabled
                ? "connected"
                : "disabled"
          }
        >
          {draft.lastError
            ? "Needs attention"
            : draft.enabled
              ? "Enabled"
              : "Off"}
        </em>
      </summary>
      <div>
        <label className="setting-toggle">
          <span>
            <strong>Include this source</strong>
            <small>Disabled connectors never contact the provider.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
          />
        </label>
        {needsSecret && (
          <label className="setting-field">
            <span>
              {draft.kind === "openai" ? "OpenAI admin key" : "Anthropic admin key"}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                draft.hasCredential
                  ? "Stored in the OS credential vault"
                  : "Required for official organization usage"
              }
            />
          </label>
        )}
        {draft.kind === "github" && (
          <>
            <label className="setting-field">
              <span>Account login</span>
              <input
                value={draft.accountId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, accountId: event.target.value })
                }
                placeholder="Leave blank to use gh auth account"
              />
            </label>
            <label className="setting-field">
              <span>Organization (optional)</span>
              <input
                value={draft.organizationId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, organizationId: event.target.value })
                }
                placeholder="Use organization billing instead"
              />
            </label>
          </>
        )}
        {draft.kind === "google" && (
          <label className="setting-field">
            <span>Google Cloud project ID</span>
            <input
              value={draft.projectId ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, projectId: event.target.value })
              }
              placeholder="my-gemini-project"
            />
          </label>
        )}
        {error && <small className="form-error">{error}</small>}
        <div className="usage-connector-actions">
          {draft.hasCredential && needsSecret && (
            <button
              className="danger-link"
              onClick={() => {
                setSaving(true);
                void deleteUsageCredential(draft.id)
                  .then(onSaved)
                  .catch((nextError) => setError(String(nextError)))
                  .finally(() => setSaving(false));
              }}
            >
              Delete stored credential
            </button>
          )}
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setError("");
              void saveUsageConnector(draft, secret || undefined)
                .then(onSaved)
                .then(() => setSecret(""))
                .catch((nextError) => setError(String(nextError)))
                .finally(() => setSaving(false));
            }}
          >
            {saving ? <RefreshCw className="spin" /> : <ShieldCheck />}
            Save connector
          </button>
        </div>
      </div>
    </details>
  );
}

export function UsageInspector({ topbar }: { topbar: React.ReactNode }) {
  const app = useCoDesStore();
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [connectors, setConnectors] = useState<UsageConnector[]>([]);
  const [period, setPeriod] = useState<7 | 30 | 90 | 0>(30);
  const [provider, setProvider] = useState("");
  const [sourceKind, setSourceKind] = useState<UsageSourceKind | "">("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const activeProject = app.projects.find(
    (project) => project.id === app.activeProjectId,
  );

  const reloadConnectors = async () => {
    const stored = await loadUsageConnectors();
    const merged = connectorDefaults.map((item) => {
      const existing = stored.find((connector) => connector.kind === item.kind);
      return (
        existing ?? {
          id: `official-${item.kind}`,
          kind: item.kind,
          label: item.label,
          enabled: false,
          hasCredential: false,
        }
      );
    });
    setConnectors(merged);
  };

  const reload = async () => {
    const startAt = period ? Date.now() - period * 86_400_000 : undefined;
    const values = await loadUsage({
      provider: provider || undefined,
      sourceKind: sourceKind || undefined,
      projectId: undefined,
      startAt,
      limit: 5_000,
    });
    setRecords(values);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading("Reading local provider usage");
    void Promise.all([reloadConnectors(), syncLocalUsage()])
      .then(() => reload())
      .catch((nextError) => !cancelled && setError(String(nextError)))
      .finally(() => !cancelled && setLoading(""));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void reload().catch((nextError) => setError(String(nextError)));
  }, [period, provider, sourceKind]);

  const aggregate = useMemo(
    () =>
      records.reduce(
        (total, record) => ({
          input: total.input + (record.inputTokens ?? 0),
          output: total.output + (record.outputTokens ?? 0),
          cached: total.cached + (record.cachedTokens ?? 0),
          reasoning: total.reasoning + (record.reasoningTokens ?? 0),
          tokens: total.tokens + (record.totalTokens ?? 0),
          requests: total.requests + (record.requestCount ?? 0),
          usd:
            total.usd +
            (record.costCurrency === "USD" ? (record.costAmount ?? 0) : 0),
        }),
        {
          input: 0,
          output: 0,
          cached: 0,
          reasoning: 0,
          tokens: 0,
          requests: 0,
          usd: 0,
        },
      ),
    [records],
  );

  const providers = useMemo(
    () => [...new Set(records.map((record) => record.provider))].sort(),
    [records],
  );
  const breakdown = useMemo(() => {
    const grouped = new Map<
      string,
      { tokens: number; cost: number; records: number }
    >();
    records.forEach((record) => {
      const value = grouped.get(record.provider) ?? {
        tokens: 0,
        cost: 0,
        records: 0,
      };
      value.tokens += record.totalTokens ?? 0;
      value.cost +=
        record.costCurrency === "USD" ? (record.costAmount ?? 0) : 0;
      value.records += 1;
      grouped.set(record.provider, value);
    });
    return [...grouped.entries()].sort(
      (a, b) => b[1].tokens - a[1].tokens || b[1].cost - a[1].cost,
    );
  }, [records]);
  const daily = useMemo(() => {
    const buckets = new Map<string, number>();
    records.forEach((record) => {
      const day = new Date(record.startedAt).toISOString().slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + (record.totalTokens ?? 0));
    });
    const days = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
    return days.slice(-31);
  }, [records]);
  const maxDaily = Math.max(1, ...daily.map(([, value]) => value));
  const budget = app.settings.usageBudgetUsd;
  const budgetPercent =
    budget && budget > 0 ? Math.min(100, (aggregate.usd / budget) * 100) : 0;

  useEffect(() => {
    if (!budget || budget <= 0 || aggregate.usd < budget || !activeProject)
      return;
    const title = `Usage budget reached · ${new Date().toISOString().slice(0, 7)}`;
    if (app.alerts.some((alert) => alert.title === title)) return;
    app.addAlert({
      projectId: activeProject.id,
      kind: "info",
      title,
      detail: `Exact provider-reported cost is $${aggregate.usd.toFixed(2)} against a $${budget.toFixed(2)} local budget.`,
    });
  }, [aggregate.usd, budget, activeProject?.id]);

  async function refreshAll() {
    setLoading("Refreshing usage sources");
    setError("");
    try {
      await syncLocalUsage();
      for (const connector of connectors.filter((item) => item.enabled))
        await syncUsageConnector(connector.id);
      await Promise.all([reload(), reloadConnectors()]);
    } catch (nextError) {
      setError(String(nextError));
      await Promise.all([reload(), reloadConnectors()]);
    } finally {
      setLoading("");
    }
  }

  useEffect(() => {
    if (app.settings.usageRefreshMinutes <= 0) return;
    const timer = window.setInterval(
      () => void refreshAll(),
      app.settings.usageRefreshMinutes * 60_000,
    );
    return () => window.clearInterval(timer);
  }, [app.settings.usageRefreshMinutes, connectors]);

  function exportCsv() {
    const headers = [
      "provider",
      "product",
      "model",
      "startedAt",
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "reasoningTokens",
      "totalTokens",
      "requestCount",
      "costAmount",
      "costCurrency",
      "nativeUnit",
      "nativeQuantity",
      "source",
      "sourceKind",
      "confidence",
    ];
    const rows = records.map((record) =>
      headers
        .map((key) => csvCell(record[key as keyof UsageRecord]))
        .join(","),
    );
    download(
      `codes-usage-${new Date().toISOString().slice(0, 10)}.csv`,
      [headers.join(","), ...rows].join("\n"),
      "text/csv",
    );
  }

  return (
    <main className="main-scroll usage-inspector">
      {topbar}
      <section className="usage-toolbar">
        <div className="usage-filters">
          <label>
            <span>Period</span>
            <select
              value={period}
              onChange={(event) =>
                setPeriod(Number(event.target.value) as 7 | 30 | 90 | 0)
              }
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={0}>All recorded</option>
            </select>
          </label>
          <label>
            <span>Platform</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="">All platforms</option>
              {providers.map((item) => (
                <option value={item} key={item}>
                  {providerMeta(providerIcon(item)).label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Evidence</span>
            <select
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as UsageSourceKind | "")
              }
            >
              <option value="">All evidence</option>
              <option value="local_structured">Local structured</option>
              <option value="local_terminal">CLI reported</option>
              <option value="official_api">Official account API</option>
            </select>
          </label>
        </div>
        <div>
          <button className="secondary-button" onClick={exportCsv}>
            <Upload /> Export CSV
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              download(
                `codes-usage-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(records, null, 2),
                "application/json",
              )
            }
          >
            Export JSON
          </button>
          <button
            className="primary-button"
            disabled={Boolean(loading)}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className={loading ? "spin" : ""} />
            {loading || "Refresh sources"}
          </button>
        </div>
      </section>
      {error && (
        <div className="usage-warning" role="status">
          <AlertTriangle />
          <span>
            <strong>Some usage could not be refreshed.</strong>
            <small>{error} Last successful records remain visible.</small>
          </span>
          <button onClick={() => setError("")} aria-label="Dismiss usage error">
            ×
          </button>
        </div>
      )}
      <section className="usage-overview">
        <div className="usage-primary-metric">
          <span>Observed tokens</span>
          <strong>{compact(aggregate.tokens)}</strong>
          <small>
            {compact(aggregate.input)} input · {compact(aggregate.output)} output
          </small>
          <div>
            <i
              style={{
                width: `${aggregate.tokens ? (aggregate.input / aggregate.tokens) * 100 : 0}%`,
              }}
            />
            <i
              style={{
                width: `${aggregate.tokens ? (aggregate.output / aggregate.tokens) * 100 : 0}%`,
              }}
            />
            <i
              style={{
                width: `${aggregate.tokens ? (aggregate.cached / aggregate.tokens) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <dl>
          <div>
            <dt>
              <Zap /> Requests
            </dt>
            <dd>{compact(aggregate.requests)}</dd>
            <small>provider-reported only</small>
          </div>
          <div>
            <dt>
              <CircleDot /> Exact USD cost
            </dt>
            <dd>${aggregate.usd.toFixed(2)}</dd>
            <small>no inferred pricing</small>
          </div>
          <div>
            <dt>
              <Gauge /> Cached tokens
            </dt>
            <dd>{compact(aggregate.cached)}</dd>
            <small>{compact(aggregate.reasoning)} reasoning</small>
          </div>
          <div>
            <dt>
              <Activity /> Evidence
            </dt>
            <dd>{records.length}</dd>
            <small>normalized records</small>
          </div>
        </dl>
      </section>
      {budget && budget > 0 && (
        <section className="usage-budget">
          <header>
            <span>
              <strong>Local USD budget</strong>
              <small>
                ${aggregate.usd.toFixed(2)} of ${budget.toFixed(2)}
              </small>
            </span>
            <em>{budgetPercent.toFixed(0)}%</em>
          </header>
          <i>
            <b style={{ width: `${budgetPercent}%` }} />
          </i>
        </section>
      )}
      <section className="usage-main-grid">
        <div className="usage-analysis">
          <section className="usage-trend">
            <header>
              <span>
                <h2>Daily token volume</h2>
                <small>Only explicit provider token counters</small>
              </span>
            </header>
            {daily.length ? (
              <div className="usage-bars" aria-label="Daily token volume chart">
                {daily.map(([day, value]) => (
                  <div key={day}>
                    <i
                      style={{ height: `${Math.max(3, (value / maxDaily) * 100)}%` }}
                      title={`${day}: ${value.toLocaleString()} tokens`}
                    />
                    <span>{new Date(`${day}T00:00:00`).getDate()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="usage-empty">
                <Activity />
                <strong>No token evidence in this period</strong>
                <span>
                  Refresh local records or enable an official connector.
                </span>
              </div>
            )}
          </section>
          <section className="usage-platforms">
            <header>
              <h2>Platform ledger</h2>
              <small>Tokens and actual billed USD stay separate</small>
            </header>
            {breakdown.map(([name, value]) => (
              <article key={name}>
                <ProviderIcon provider={providerIcon(name)} />
                <span>
                  <strong>{providerMeta(providerIcon(name)).label}</strong>
                  <small>{value.records} evidence records</small>
                </span>
                <div>
                  <strong>{compact(value.tokens)}</strong>
                  <small>tokens</small>
                </div>
                <div>
                  <strong>${value.cost.toFixed(2)}</strong>
                  <small>exact USD</small>
                </div>
              </article>
            ))}
          </section>
          <section className="usage-records">
            <header>
              <h2>Evidence log</h2>
              <small>Newest normalized records first</small>
            </header>
            <div>
              {records.slice(0, 250).map((record) => (
                <article key={record.id}>
                  <ProviderIcon provider={providerIcon(record.provider)} compact />
                  <span>
                    <strong>
                      {record.product}
                      {record.model ? ` · ${record.model}` : ""}
                    </strong>
                    <small>
                      {new Date(record.startedAt).toLocaleString()} ·{" "}
                      {record.source}
                    </small>
                  </span>
                  <em className={record.sourceKind}>
                    {record.sourceKind === "official_api"
                      ? "Official"
                      : record.sourceKind === "local_structured"
                        ? "Local record"
                        : "CLI reported"}
                  </em>
                  <div>
                    <strong>{compact(record.totalTokens ?? 0)}</strong>
                    <small>tokens</small>
                  </div>
                  <div>
                    <strong>
                      {record.costCurrency === "USD"
                        ? `$${(record.costAmount ?? 0).toFixed(2)}`
                        : record.nativeQuantity !== undefined
                          ? `${record.nativeQuantity} ${record.nativeUnit ?? ""}`
                          : "—"}
                    </strong>
                    <small>{record.confidence}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <aside className="usage-sources">
          <header>
            <span>
              <h2>Usage sources</h2>
              <small>Secrets stay in the operating-system vault</small>
            </span>
            <ShieldCheck />
          </header>
          <div className="usage-local-source">
            <Check />
            <span>
              <strong>Local CLI records</strong>
              <small>
                Codex, Claude, Pi, and Grok structured token fields
              </small>
            </span>
            <em>Always local</em>
          </div>
          {connectors.map((connector) => (
            <ConnectorEditor
              connector={connector}
              key={connector.id}
              onSaved={async () => {
                await reloadConnectors();
                await reload();
              }}
            />
          ))}
          <p className="usage-source-note">
            <ExternalLink />
            Antigravity activity is never labeled Gemini API usage without a
            connected Google Cloud project.
          </p>
          {activeProject && (
            <p className="usage-source-note">
              Current workspace: <strong>{activeProject.name}</strong>. Account
              records may span projects and remain labeled by source.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
