# Changelog

All notable changes to GrafanaProbe are documented here.

---

## V2.0.0

### Overview

V2.0 is a complete rewrite introducing a React frontend, SQLite persistence, and 10 new test categories. It replaces the original CLI-only V1 with a full-featured web application.

### New features

#### Core platform
- **React frontend** on port 3001 with live WebSocket streaming of test results
- **SQLite persistence** — all runs and results stored in a local database
- **HTML report generation** — self-contained HTML report created after every run
- **Pagination and delete** — manage run history with per-run or bulk delete
- **Multi-environment support** — configure DEV, PERF, PROD environments with separate URLs and tokens
- **Scheduled runs** — cron job setup with hourly, daily, and weekly presets

#### Test engine
- **17 test categories** (up from 7 in V1)
- **WebSocket live progress** — results stream to the UI as each test completes
- **Grafana 9.x – 12.x support** — automatic API version fallback
- **Clickable Grafana deep-links** — every result links to the affected resource in Grafana

#### New test categories (added in V2)
- Query Latency — live query execution and per-panel timing
- Config Audit — security settings, anonymous access, feature toggles
- Provisioning — drift detection and provisioned dashboard state
- Data Freshness — stale data detection per dashboard
- Capacity Planning — dashboard density and data source load estimation
- K8s Dashboards — Kubernetes dashboard discovery and variable validation
- App Plugins — app plugin health and settings validation
- Links — dashboard link validation and broken URL detection
- Annotations — annotation volume, orphan detection, and integrity
- Panels — deep panel query and configuration inspection

#### Dependency graph
- **DAG builder** — maps every data source → dashboard → panel → plugin relationship
- **Impact analysis API** — "which dashboards break if this data source goes down?"
- **Plugin impact analysis** — find all dashboards using a specific plugin

#### AI failure analysis
- **OpenAI integration** — GPT-4o analyzes failures and suggests remediation
- **Anthropic Claude integration** — Claude analyzes failures with structured output
- **AI analysis stored with reports** — analysis is persisted alongside the run

#### Docker and deployment
- **Docker + Podman support** — `demo-run.sh` supports both runtimes
- **One-command demo** — `./demo-run.sh` starts Grafana + backend + frontend
- **`cross-env` for Windows** — frontend npm scripts work on Windows PowerShell without configuration

### Breaking changes from V1

- V1's CLI-only mode (`node run.js`) is replaced by the backend API server
- V1 report format (plain text) is replaced by structured JSON + HTML
- V1's flat configuration is replaced by the `.env`-based config with multi-environment support
- The `run.sh` script remains for backward compatibility but the full V2 feature set requires the backend server

---

## V1.0.0

### Overview

Initial release of the GrafanaProbe testing platform as a Node.js CLI tool.

### Features

- **7 test categories** covering core Grafana functionality
- CLI-based test runner (`node run.js` or `./run.sh`)
- Plain text output with PASS/FAIL indicators
- Basic Grafana API client with token authentication
- k6 load test integration for performance testing scenarios
- Configurable via environment variables

### Test categories (V1)

1. API Health — connectivity and authentication
2. Data Sources — health checks and config validation
3. Folders — structure and permissions
4. Dashboards — panel count, deprecated types, DS references
5. Alerts — rules, contact points, notification policies
6. Plugins — signatures, types, version audit
7. Users & Access — user list, org membership, team membership

### Limitations (addressed in V2)

- No web UI — results only in terminal
- No persistence — reports not saved between runs
- No live streaming — all results shown after run completes
- No multi-environment support
- No AI analysis
- No dependency graph
- No Docker demo
- No Windows support (PowerShell incompatible)

---

## What's next?

Planned for future releases:
- Visual dependency graph UI (force-directed D3.js layout in the frontend)
- Grafana Cloud native integration (API key auto-discovery)
- Slack and PagerDuty notification integrations
- Dashboard quality score (0–100) with trend tracking over time
- RBAC-aware test runner (test with different permission levels)
