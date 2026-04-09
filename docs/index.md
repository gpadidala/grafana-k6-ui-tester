# GrafanaProbe

**GrafanaProbe** is a production-grade testing and observability platform for Grafana. It automatically audits your Grafana instance across 17 test categories — from API health to Kubernetes dashboard validation — and delivers results through a real-time React dashboard, HTML reports, and optional AI-powered failure analysis.

> **Note:** GrafanaProbe is an open-source tool. It connects to your Grafana instance using a read-capable Service Account token and does not modify any Grafana configuration.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│              React Frontend (:3001)                  │
│  Dashboard │ Run Tests │ Reports │ Settings │ Cron   │
│            WebSocket (live progress) + REST          │
├─────────────────────────────────────────────────────┤
│            Node.js Backend (:4000)                   │
│  ┌──────────────┬───────────────┬─────────────────┐  │
│  │ Test Engine  │ Dep Graph     │ Query Profiler  │  │
│  │ (17 cats)    │ (DAG Builder) │ (Live Queries)  │  │
│  ├──────────────┼───────────────┼─────────────────┤  │
│  │ SQLite DB    │ Report Gen    │ AI Analysis     │  │
│  │ (Persistence)│ (HTML+JSON)   │ (OpenAI/Claude) │  │
│  └──────────────┴───────────────┴─────────────────┘  │
│               Grafana API Client                     │
│         (Multi-version: 9.x — 12.x)                 │
├─────────────────────────────────────────────────────┤
│          Grafana Enterprise Instance(s)              │
└─────────────────────────────────────────────────────┘
```

The **React frontend** at port 3001 communicates with the **Node.js backend** at port 4000 via REST and WebSocket (Socket.IO). The backend connects to your Grafana instance using its HTTP API and a Service Account token.

All test results are persisted in a local **SQLite** database. Reports are generated as both JSON and self-contained HTML files.

---

## Key features

| Feature | Description |
|---------|-------------|
| **17 test categories** | Comprehensive coverage: API health, data sources, dashboards, panels, alerts, plugins, users, links, annotations, query latency, config audit, provisioning, data freshness, capacity planning, and Kubernetes dashboards |
| **Live progress** | WebSocket streams test results in real time as each category completes |
| **Dependency graph** | Maps every data source → dashboard → panel → plugin relationship. Supports impact analysis: "if this data source goes down, which dashboards break?" |
| **AI failure analysis** | Connect OpenAI (GPT-4o) or Anthropic Claude to automatically analyze failures and suggest remediation steps |
| **HTML reports** | Generated after every run; viewable in the browser, shareable with teams |
| **Clickable Grafana links** | Every test result includes a deep-link directly to the affected resource in your Grafana UI |
| **Multi-environment** | Configure DEV, PERF, and PROD environments with separate URLs and tokens, switchable from the Settings page |
| **Scheduled runs** | Set up cron jobs (hourly, daily, weekly) from the Schedules UI |
| **SQLite persistence** | All runs and results stored in a local database, with pagination and delete support |
| **Grafana 9.x – 12.x** | Automatic API fallback for version compatibility across major Grafana releases |
| **Docker + Podman** | Single-command demo mode with a bundled Grafana container |

---

## Who it's for

- **Platform / SRE teams** managing shared Grafana instances who need automated health checks before and after upgrades
- **Developers** building Grafana dashboards who want to validate their work meets standards (no broken DS references, no deprecated panel types)
- **Security teams** auditing Grafana for anonymous access, weak auth, or over-privileged service accounts
- **DevOps engineers** integrating Grafana validation into CI/CD pipelines for upgrade pre/post checks

---

## Supported Grafana versions

| Grafana version | Support status |
|----------------|----------------|
| 12.x | Full support |
| 11.x | Full support |
| 10.x | Full support |
| 9.x | Full support (API fallback active) |
| 8.x and earlier | Not tested — some categories may fail |

> **Note:** GrafanaProbe uses automatic API version fallback. If an API endpoint changes between Grafana releases, the client retries with the previous version's path.

---

## What's next?

- [Installation](getting-started/installation.md) — set up GrafanaProbe in under 5 minutes
- [Quick Start](getting-started/quickstart.md) — run your first test with Docker or manually
- [Configuration](getting-started/configuration.md) — environment variables, multi-environment setup, LLM config
- [Test Categories](features/test-categories.md) — deep dive into all 17 test categories
