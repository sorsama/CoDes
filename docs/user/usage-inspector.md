# Usage Inspector

The Usage Inspector tracks token consumption and cost evidence across your provider sessions.

## Overview

CoDes collects usage data from two sources:
1. **Local CLI records** — parsed from each provider's local log/transcript files
2. **Official API connectors** — direct queries to provider APIs (OpenAI, Anthropic, GitHub, Google) for billing data

All evidence is normalized and stored in SQLite.

## Accessing the Inspector

Open the **Inspector** view from the sidebar navigation.

## Data Sources

### Local Records

CoDes parses conversation history and telemetry files from each provider's local storage:
- **Codex** — structured session logs
- **Claude Code** — conversation transcripts
- **OpenCode** — telemetry data
- **Grok Build** — run records
- **Pi** — usage data

Parser coverage varies by provider. The inspector shows which providers have available local data and whether the parsed data is fresh.

### Official API Connectors

For providers that expose usage APIs, you can connect official data sources:

| Connector | Data Retrieved | Authentication |
|---|---|---|
| **OpenAI** | Token usage, cost per model | API key (stored in OS credential vault) |
| **Anthropic** | Token usage, cost per request | API key (stored in OS credential vault) |
| **GitHub** | Copilot usage metrics | GitHub token |
| **Google** | Vertex AI / Gemini usage | Service account credentials |

Connector keys are stored in the operating system's credential vault — not in CoDes configuration files.

## Viewing Data

### Dashboard

The inspector dashboard shows:
- **Total tokens** (input + output) across all sources
- **Estimated cost** with currency symbol
- **Session count** and average cost per session
- **Provider breakdown** — per-provider token and cost totals
- **Timeline** — usage over time (daily/weekly/monthly)

### Filters

- **Time range** — last 24h, 7 days, 30 days, custom range
- **Provider** — filter by one or more providers
- **Project** — scope to a specific project
- **Source** — local only, API only, or both

### Exports

Export usage data as:
- **CSV** — raw data for spreadsheet analysis
- **JSON** — structured data for programmatic use
- **Markdown** — formatted report

## Budget Alerts

Set budget limits per project or globally:

1. Open **Inspector → Budgets**
2. Set a monthly or weekly token/cost limit
3. Choose alert threshold percentages (50%, 75%, 90%, 100%)
4. CoDes shows a dashboard alert when thresholds are exceeded

Alerts appear in the workspace notification area and can trigger desktop notifications if enabled.

## Source Freshness

The inspector tracks when each data source was last updated:
- **Local records** — updated when a session ends or on manual refresh
- **API connectors** — refresh on demand with configurable auto-refresh interval
- **Stale data** is flagged in the UI so you can see when the displayed numbers may be incomplete

## Privacy

- Connector API keys are stored in the **OS credential vault** (not in CoDes files or SQLite)
- Workspace snapshots retain only non-secret connector metadata
- Local provider history files are read as inputs only — never modified

## See Also

- [Sessions](sessions.md) — session lifecycle and output capture
- [Provider Setup](provider-setup.md) — install and authenticate providers
