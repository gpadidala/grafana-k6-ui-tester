# Frontend UI

The GrafanaProbe React frontend runs at http://localhost:3001 and provides a full-featured dashboard for running tests, reviewing reports, and managing configuration. It communicates with the backend via REST API and WebSocket for live streaming.

---

## Navigation

The left sidebar contains the main navigation:

```
GrafanaProbe
├── Dashboard       — Overview and recent runs
├── Run Tests       — Execute test categories
├── Reports         — History and HTML reports
├── Settings        — Environments and LLM config
└── Schedules       — Cron job setup
```

Each page is a React single-page route; navigation does not trigger a full page reload.

---

## Dashboard page

The Dashboard page is the landing page. It provides an at-a-glance view of your Grafana instance's health.

### Overview stats

At the top of the page, four stat cards show aggregate counts from the most recent run:

| Card | Shows |
|------|-------|
| Total Tests | Number of individual tests run |
| Passed | Count with PASS status |
| Warnings | Count with WARN status |
| Failed | Count with FAIL status |

### Environment cards

Below the stats, one card per configured environment (DEV, PERF, PROD) shows:
- Environment name
- Grafana URL
- Connection status (green = reachable, red = unreachable)
- Last run timestamp

Click an environment card to switch the active environment for the next test run.

### Recent runs

A paginated list of recent test runs, showing:
- Run timestamp
- Environment used
- Duration
- Summary counts (PASS/WARN/FAIL)
- Status badge for the overall run

**Pagination:** 10 runs per page. Use the previous/next buttons at the bottom.

**Delete:** Click the trash icon on any run to delete it (with confirmation). The **Delete All** button removes all runs after a two-step confirmation.

---

## Run Tests page

The Run Tests page is where you execute test categories against your Grafana instance.

### Category selector

A checkbox list of all 17 categories, each showing:
- Category icon
- Category name
- Brief description

Check specific categories to run only those, or leave all unchecked to run all 17. A **Select All** / **Deselect All** toggle is available.

### Environment selector

A dropdown showing your configured environments (DEV, PERF, PROD) plus the default from `.env`. Select the target environment before running.

### Run button

Click **Run** to start the test. The button changes to **Running...** and is disabled while a run is in progress.

### Live status board

As tests execute, a real-time status board updates via WebSocket:

```
💚 API Health          ✓ PASS   (1.2s)
🔌 Data Sources        ✓ PASS   (3.4s)
📊 Dashboards          ⚠ WARN   (5.1s)
🔲 Panels              ● Running...
🔔 Alerts              ● Queued
```

Each row shows the category name, current status, and elapsed time.

### Live log stream

Below the status board, a scrolling log panel shows individual test results as they stream in:

```
[14:22:01] ✓ API Health — Connectivity OK (142ms)
[14:22:01] ✓ API Health — Authentication OK (user: service-account-grafana-probe)
[14:22:03] ✓ Data Sources — Prometheus health: OK
[14:22:04] ⚠ Dashboards — Dashboard 'Node Overview' has 58 panels (> 50 recommended)
[14:22:05] ✗ Panels — Panel 'CPU Usage' on 'Old Dashboard' — empty query expression
```

### Expandable results

After a run completes, click any category row to expand it and see all individual test results with:
- Status badge (PASS / WARN / FAIL / ERROR)
- Test name and message
- **Grafana link** icon — click to open the affected resource directly in Grafana
- **AI Analysis** button (if LLM is configured)

---

## Reports page

The Reports page lists all past test runs stored in SQLite. This is the permanent record — unlike the Run Tests page which only shows the current session.

### Report list

Each run shows:
- Timestamp
- Environment
- Duration
- Summary counts

### Expanding a report

Click a report row to expand it and see per-category results. The same expandable detail view as Run Tests is shown.

### HTML report

Click the **HTML** button on any report row to open the self-contained HTML report in a new browser tab. The HTML report is suitable for sharing with team members who don't have access to GrafanaProbe.

### Delete controls

- **Trash icon** on a single report — deletes that run (with confirmation dialog)
- **Delete All** button at the top — deletes all reports (two-step confirmation)

---

## Settings page

The Settings page manages environment configuration and LLM integration.

### Environments section

Three environment slots: **DEV**, **PERF**, **PROD**.

For each environment:

| Field | Description |
|-------|-------------|
| Name | Display name (preset: DEV / PERF / PROD) |
| Grafana URL | Full URL including protocol and port |
| API Token | Service Account token (`glsa_...`) |

**Test Connection:** Click to verify that GrafanaProbe can reach Grafana with the given URL and token. Shows:
- Grafana version
- Database type
- Authenticated user login
- Response time in ms

**Save:** Persists all environment configs to browser `localStorage`.

### LLM configuration section

| Field | Description |
|-------|-------------|
| Provider | `openai` or `anthropic` |
| API Key | Your OpenAI or Anthropic API key |
| Model | Model name (default: `gpt-4o` or `claude-sonnet-4-6`) |

> **Note:** API keys entered in the Settings page are stored in browser `localStorage`. They are sent directly from the browser to the LLM provider's API — they do not pass through the GrafanaProbe backend.

---

## Schedules page

The Schedules page lets you configure automated, recurring test runs.

### Creating a schedule

1. Click **Add Schedule**
2. Configure:
   - **Environment** — which environment to test
   - **Categories** — which test categories to run
   - **Schedule** — choose a preset or enter a custom cron expression

### Schedule presets

| Preset | Cron expression | When it runs |
|--------|----------------|--------------|
| Hourly | `0 * * * *` | Top of every hour |
| Daily (midnight) | `0 0 * * *` | Every day at 00:00 |
| Daily (6am) | `0 6 * * *` | Every day at 06:00 |
| Weekly (Monday) | `0 0 * * 1` | Every Monday at 00:00 |

Custom cron expressions are also supported using standard cron syntax.

### Scheduled run results

Scheduled runs appear in the Reports page like any manual run, tagged with the schedule name.

---

## Status badges

Status badges appear throughout the UI:

| Badge | Color | Meaning |
|-------|-------|---------|
| `PASS` | Green | Test passed — no issue |
| `WARN` | Yellow/Orange | Potential issue — review recommended |
| `FAIL` | Red | Issue found — action required |
| `ERROR` | Dark red | Test could not execute |
| `Running` | Blue (animated) | Currently executing |
| `Queued` | Gray | Waiting to execute |

---

## AI Analysis panel

The AI Analysis panel appears in test result details when an LLM is configured.

### Triggering analysis

After a run, expand a category with FAIL or WARN results and click **Analyze with AI**.

### Analysis display

The panel shows:
- **Provider badge** — OpenAI or Anthropic
- **Analysis text** — structured LLM output with root cause and remediation steps
- **Copy button** — copies the analysis to clipboard
- **Loading spinner** — shown while the LLM is processing

---

## Browser requirements

GrafanaProbe frontend is tested on:

| Browser | Minimum version |
|---------|----------------|
| Chrome / Chromium | 100+ |
| Firefox | 100+ |
| Safari | 15+ |
| Edge (Chromium) | 100+ |

> **Note:** Internet Explorer is not supported.

---

## What's next?

- [API Reference](../api/reference.md) — interact with GrafanaProbe programmatically
- [Configuration](../getting-started/configuration.md) — LLM setup and multi-environment config
- [Troubleshooting](../guides/troubleshooting.md) — fix common UI and connection issues
