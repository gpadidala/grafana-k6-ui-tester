# 🛡 Grafana Sentinel V3
## Enterprise UI Testing, Upgrade Validation & Observability Platform

**by Gopal Padidala**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Grafana 9–12](https://img.shields.io/badge/grafana-9.x–12.x-orange)](https://grafana.com)

Grafana Sentinel is a production-grade platform that validates Grafana UI health, automates upgrade validation with before/after snapshots, monitors performance trends, and compares multi-instance configurations.

---

## Architecture

```
CLI (sentinel)  ←→  Backend (Express+WS, :4000)  ←→  Grafana API
                         │
                    React Frontend (:3001)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Core Engine   Snapshot/Diff  Monitor+Alerts
       config.js     capture.js     scheduler.js
       grafana-      diff-engine.js baseline-tracker.js
       client.js     visual-diff.js trend-analyzer.js
       health-       migration-     incident-manager.js
       scorer.js     advisor.js
```

---

## Quick Start

### Prerequisites
- Node.js 18+, a running Grafana instance, a Service Account token (Admin role)

### Install & Run

```bash
git clone https://github.com/your-org/grafana-sentinel && cd grafana-sentinel
npm install && cd backend && npm install && cd ../frontend && npm install && cd ..

# Start backend
GRAFANA_URL=http://localhost:3000 GRAFANA_TOKEN=glsa_xxx npm start

# Start frontend (new terminal)
cd frontend && npm start
# → http://localhost:3001
```

### One-command Demo (Docker)

```bash
docker-compose up
# Grafana:  http://localhost:3000  (admin/admin)
# Sentinel: http://localhost:4000
# Frontend: http://localhost:3001
```

---

## CLI Reference

```bash
sentinel run --url URL --token TOKEN --level smoke|standard|full
sentinel snapshot capture --url URL --token TOKEN --label pre-v11
sentinel snapshot compare --before pre-v11 --after post-v12 --report ./report.html
sentinel monitor start --url URL --token TOKEN --schedule "0 7 * * *"
sentinel compare --source-url STAGING --source-token T1 --target-url PROD --target-token T2
sentinel dashboard serve --port 4000
sentinel report executive --run-id latest
sentinel report push --pushgateway http://pushgateway:9091
```

---

## Upgrade Validation Workflow

```
1. BEFORE UPGRADE:
   sentinel snapshot capture --label pre-v11

2. UPGRADE GRAFANA

3. AFTER UPGRADE:
   sentinel snapshot capture --label post-v12
   sentinel snapshot compare --before pre-v11 --after post-v12
   → Generates: dashboard diff, plugin changes, datasource UID changes,
     visual pixel diff, migration advisor with actionable fixes

4. VALIDATE:
   sentinel run --level full
```

---

## Test Categories (17)

| Category | Description |
|----------|-------------|
| `api-health` | Connectivity, auth, response time SLA |
| `datasources` | Health check + query test per datasource |
| `dashboards` | Render, panels, errors, load time for ALL dashboards |
| `panels` | Deep per-type: timeseries, stat, gauge, table, piechart, heatmap, logs, geomap |
| `alerts` | Rules, groups, silences, contact points, notification policies |
| `plugins` | Plugin catalog, app plugin UI pages |
| `variables` | Template variable dropdowns and panel reload |
| `annotations` | Create + display validation |
| `explore` | Explore page + all datasources |
| `navigation` | All 20 core pages, sidebar, breadcrumbs |
| `teams-users` | Users, teams, roles |
| `rbac` | Enterprise RBAC permissions pages |
| `enterprise` | Reporting, usage insights, licensing |
| `admin` | Server admin, stats, settings |

---

## Test Scenarios

| Scenario | Duration | Use Case |
|----------|----------|----------|
| `smoke` | ~5 min | CI gate on every PR |
| `standard` | ~15 min | Daily health check |
| `full` | ~2 hr | Pre-release validation |
| `upgrade-pre/post` | ~10–15 min | Upgrade validation |
| `regression` | ~1 min | Compare two run results |
| `daily-ops` | ~10 min | Morning on-call check |
| `performance` | ~30 min | Load time benchmarking |

---

## Health Score (0–100)

| Component | Weight |
|-----------|--------|
| Dashboard pass rate | 35% |
| Datasource health | 20% |
| Alert pass rate | 15% |
| Performance | 10% |
| Core pages | 10% |
| No-data rate | 5% |
| Plugin health | 5% |

Grades: **A+** ≥95 · **A** ≥90 · **B** ≥80 · **C** ≥70 · **D** ≥60 · **F** <60

---

## Monitoring & Alerting

```yaml
# config/default.yaml
monitoring:
  enabled: true
  schedule: "0 7 * * *"
  retention_days: 30

notifications:
  enabled: true
  channels:
    - type: slack
      webhook_url: "https://hooks.slack.com/..."
    - type: pagerduty
      routing_key: "your-key"
      min_severity: critical
```

---

## Multi-Instance Comparison

```yaml
# config/instances.yaml
instances:
  - id: production
    url: "http://grafana-prod.company.com"
    environment: production
  - id: staging
    url: "http://grafana-staging.company.com"
    environment: staging
```

```bash
sentinel compare --source-url $STAGING_URL --source-token $T1 \
                 --target-url $PROD_URL    --target-token $T2
```

---

## CI/CD Integration

```yaml
# GitHub Actions
- name: Sentinel smoke test
  env:
    GRAFANA_URL: ${{ secrets.GRAFANA_URL }}
    GRAFANA_TOKEN: ${{ secrets.GRAFANA_TOKEN }}
  run: node cli/sentinel.js run --level smoke
```

Full workflow: `integrations/github-actions.yml` · Jenkins: `integrations/jenkins.groovy`

---

## Project Structure

```
grafana-sentinel/
├── core/                    # Config, Grafana API client, health scorer, notifications
├── tests/suites/            # 14 k6 browser test suites
├── tests/scenarios/         # 8 scenario scripts (smoke, full, upgrade, etc.)
├── tests/helpers/           # Page actions, panel detection, error detection
├── snapshot/                # Capture, diff, visual diff, migration advisor
├── monitor/                 # Scheduler, baseline tracker, trend analyzer, incidents
├── multi-instance/          # Instance registry, cross-compare, sync validator
├── reports/generator/       # HTML, JSON, upgrade, trend, executive reports
├── cli/sentinel.js          # CLI (commander.js)
├── integrations/            # Slack, PagerDuty, Pushgateway, GitHub Actions, Jenkins
├── config/                  # default.yaml, instances.yaml, notifications.yaml
├── backend/                 # Express + Socket.IO + SQLite backend
├── frontend/                # React 19 + TypeScript + Tailwind UI
├── Dockerfile               # Multi-stage: grafana-demo + sentinel-backend
└── docker-compose.yml       # Full stack deployment
```

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `GRAFANA_URL` | `http://localhost:3000` | Grafana base URL |
| `GRAFANA_TOKEN` | — | Service account token (required) |
| `TEST_LEVEL` | `standard` | smoke / standard / full |
| `HEADLESS` | `true` | Browser headless mode |
| `MAX_DASHBOARDS` | `0` (all) | Limit dashboard count |
| `MONITOR_SCHEDULE` | `0 7 * * *` | Cron schedule |
| `SLACK_WEBHOOK_URL` | — | Slack notification webhook |
| `PAGERDUTY_ROUTING_KEY` | — | PagerDuty routing key |
| `PORT` | `4000` | Backend server port |
| `REPORT_DIR` | `./reports` | Report output directory |

Full config reference: `config/default.yaml`

---

## License

MIT — **Gopal Padidala**
