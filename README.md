# GrafanaProbe — Grafana Enterprise Testing Platform

Production-grade testing platform for Grafana with **17 test categories**, **dependency graph**, **live query profiler**, **AI failure analysis**, and a **React dashboard UI**. Supports Grafana 9.x through 12.x.

**by Gopal Rao**

---

## Quick Start (Frontend + Backend)

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **A Grafana instance** with a Service Account token (Admin role)

### Step 1: Clone

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
```

### Step 2: Setup Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` with your Grafana URL and token:

```env
GRAFANA_URL=http://localhost:3000
GRAFANA_API_TOKEN=glsa_your_token_here
PORT=4000
```

**How to get a Grafana token:**
1. Go to **Grafana > Administration > Service Accounts**
2. Click **Add service account** — Name: `grafana-probe`, Role: **Admin**
3. Click **Add service account token** — copy the `glsa_...` token
4. Paste into `backend/.env`

### Step 3: Start Backend

```bash
cd backend
npm run dev
```

You should see:
```
╔══════════════════════════════════════════════╗
║   Grafana k6 UI Tester — Backend             ║
║              by Gopal Rao                     ║
╠══════════════════════════════════════════════╣
║  API:     http://localhost:4000              ║
║  Grafana: http://localhost:3000              ║
║  Auth:    Token configured                   ║
╚══════════════════════════════════════════════╝
```

### Step 4: Setup & Start Frontend

Open a **new terminal**:

```bash
cd frontend
npm install
npm start
```

Frontend opens at **http://localhost:3001**

### Step 5: Run Tests

1. Open **http://localhost:3001** in your browser
2. Click **Run Tests** in the sidebar
3. Select categories (or leave empty to run all 17)
4. Click **Run**
5. Watch live status board + log stream
6. View results in **Reports** page

---

## One-Command Quick Start (with Docker demo)

If you just want to try it with a demo Grafana (no setup needed):

```bash
./demo-run.sh
```

Or with Podman:
```bash
./demo-run.sh --podman
```

---

## What It Tests (17 Categories)

| # | Icon | Category | Tests |
|---|------|----------|-------|
| 1 | 💚 | **API Health** | Connectivity, auth, response time, build info, org access |
| 2 | 🔌 | **Data Sources** | Health check per DS, config validation, default DS |
| 3 | 📁 | **Folders** | Structure, permissions, dashboard distribution |
| 4 | 📊 | **Dashboards** | Panel count, deprecated types, DS refs, template vars, permissions |
| 5 | 🔲 | **Panels** | Query validation, DS config, library panels, empty expressions, nested rows |
| 6 | 🔔 | **Alerts** | Rules, contact points, notification policies, mute timings |
| 7 | 🧩 | **Plugins** | Signatures, types, versions, update checks |
| 8 | 📦 | **App Plugins** | Settings, health, page accessibility |
| 9 | 👥 | **Users & Access** | Users, orgs, teams, service accounts, role security |
| 10 | 🔗 | **Links** | Dashboard links, broken URLs, snapshots |
| 11 | 📝 | **Annotations** | Volume, orphan detection, integrity |
| 12 | ⏱️ | **Query Latency** | Live query execution, per-panel timing, slow query detection |
| 13 | 🔒 | **Config Audit** | Edition, anonymous access, auth providers, feature toggles |
| 14 | 📄 | **Provisioning** | Drift detection, editable provisioned dashboards, reload test |
| 15 | 🕐 | **Data Freshness** | Stale data detection per dashboard |
| 16 | 📈 | **Capacity Planning** | Dashboard density, DS load estimation, alert eval cost |
| 17 | ☸️ | **K8s Dashboards** | K8s dashboard discovery, variable validation, deprecated metrics |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              React Frontend (:3001)                   │
│  Dashboard │ Run Tests │ Reports │ Settings │ Cron   │
│            WebSocket (live progress) + REST           │
├─────────────────────────────────────────────────────┤
│            Node.js Backend (:4000)                    │
│  ┌──────────────┬───────────────┬─────────────────┐  │
│  │ Test Engine   │ Dep Graph     │ Query Profiler  │  │
│  │ (17 cats)     │ (DAG Builder) │ (Live Queries)  │  │
│  ├──────────────┼───────────────┼─────────────────┤  │
│  │ SQLite DB     │ Report Gen    │ AI Analysis     │  │
│  │ (Persistence) │ (HTML+JSON)   │ (OpenAI/Claude) │  │
│  └──────────────┴───────────────┴─────────────────┘  │
│               Grafana API Client                      │
│         (Multi-version: 9.x — 12.x)                  │
├─────────────────────────────────────────────────────┤
│          Grafana Enterprise Instance(s)               │
└─────────────────────────────────────────────────────┘
```

---

## Frontend Pages

| Page | What it does |
|------|-------------|
| **Dashboard** | Overview stats, environment cards, recent runs with pagination, delete |
| **Run Tests** | Pick categories, live status board + log stream, expandable results with Grafana links |
| **Reports** | All past runs, expand for category detail, 📄 HTML report link, 🗑️ delete with confirm |
| **Settings** | Configure environments (DEV/PERF/PROD), test connection, LLM setup (OpenAI/Claude) |
| **Schedules** | Cron job setup with presets (hourly, daily, weekly) |

---

## Features

- **Live Progress** — WebSocket streams each test result as it completes
- **Clickable Grafana Links** — every test result links directly to the dashboard/datasource/alert in Grafana
- **HTML Reports** — generated for every run, viewable in browser
- **AI Failure Analysis** — connect OpenAI or Claude to analyze failures and suggest fixes
- **Dependency Graph** — maps every datasource→dashboard→panel→plugin relationship
- **Pagination + Delete** — page through runs, delete individual or all reports with confirmation
- **Multi-Environment** — configure DEV, PERF, PROD with separate URLs and tokens
- **SQLite Persistence** — all runs and results stored in database
- **Grafana 9.x—12.x** — automatic API fallback for version compatibility
- **Docker + Podman** — supports both container runtimes

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Backend health |
| GET | `/api/config` | Current config |
| GET | `/api/tests/categories` | List 17 test categories |
| POST | `/api/tests/run` | Run all or selected categories |
| POST | `/api/tests/run-category/:id` | Run single category |
| POST | `/api/test-connection` | Test Grafana connectivity (proxy) |
| GET | `/api/reports` | List all reports |
| GET | `/api/reports/:file` | Get report detail |
| GET | `/api/reports/html/:file` | Serve HTML report |
| DELETE | `/api/reports/:file` | Delete report |
| DELETE | `/api/reports` | Delete all reports |
| GET | `/api/graph` | Full dependency graph |
| GET | `/api/graph/stats` | Graph statistics |
| GET | `/api/graph/impact/datasource/:uid` | Datasource impact analysis |
| GET | `/api/graph/impact/plugin/:id` | Plugin impact analysis |

---

## Configuration

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_URL` | `http://localhost:3000` | Grafana instance URL |
| `GRAFANA_API_TOKEN` | _(required)_ | Service Account token (Admin role) |
| `GRAFANA_ORG_ID` | `1` | Organization ID |
| `PORT` | `4000` | Backend API port |

### Frontend

Frontend runs on port **3001** (configurable in `frontend/package.json`).

Connects to backend at `http://localhost:4000` (configurable via `REACT_APP_API_URL` env var).

---

## Project Structure

```
grafana-k6-ui-tester/
├── backend/
│   ├── src/
│   │   ├── server.js                  # Express + Socket.IO server
│   │   ├── config/index.js            # Environment config
│   │   ├── db/index.js                # SQLite schema + queries
│   │   ├── services/
│   │   │   ├── grafanaClient.js       # Grafana API client (9.x—12.x)
│   │   │   ├── testEngine.js          # Test orchestrator (17 categories)
│   │   │   └── dependencyGraph.js     # DAG builder + traversal
│   │   └── tests/                     # 17 test category modules
│   │       ├── api-health/            💚
│   │       ├── datasources/           🔌
│   │       ├── folders/               📁
│   │       ├── dashboards/            📊
│   │       ├── panels/                🔲
│   │       ├── alerts/                🔔
│   │       ├── plugins/               🧩
│   │       ├── app-plugins/           📦
│   │       ├── users/                 👥
│   │       ├── links/                 🔗
│   │       ├── annotations/           📝
│   │       ├── query-latency/         ⏱️
│   │       ├── config-audit/          🔒
│   │       ├── provisioning/          📄
│   │       ├── data-freshness/        🕐
│   │       ├── capacity-planning/     📈
│   │       └── k8s-dashboards/        ☸️
│   ├── data/                          # SQLite database
│   ├── reports/                       # JSON + HTML reports
│   └── .env.example                   # Config template
├── frontend/
│   └── src/
│       ├── App.tsx                    # Main app with sidebar navigation
│       ├── api/
│       │   ├── runner.ts              # Backend API + WebSocket client
│       │   ├── llm.ts                 # OpenAI / Claude integration
│       │   ├── links.ts               # Grafana deep-link builder
│       │   └── store.ts               # localStorage for env config
│       ├── components/
│       │   ├── Sidebar.tsx            # Navigation with category icons
│       │   ├── Card.tsx               # UI card components
│       │   ├── StatusBadge.tsx        # PASS/FAIL/WARN badges
│       │   └── AIAnalysis.tsx         # LLM failure analysis
│       └── pages/
│           ├── DashboardPage.tsx      # Overview + recent runs
│           ├── RunTestPage.tsx        # Test runner + live progress
│           ├── HistoryPage.tsx        # Reports + HTML export
│           ├── EnvironmentsPage.tsx   # Settings + LLM config
│           └── CronPage.tsx           # Scheduled runs
├── demo-run.sh                        # One-command demo (Docker/Podman)
├── run.sh                             # CLI test runner
├── Dockerfile                         # Container image
├── docker-compose.yml
└── docs/USER-GUIDE.md                 # Step-by-step guide
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Frontend shows blank page | Make sure backend is running first: `cd backend && npm run dev` |
| `npm install` fails | Check Node.js version: `node -v` (need 18+) |
| Backend can't connect to Grafana | Check `backend/.env` — verify URL and token |
| `EADDRINUSE: port 4000` | Kill old process: `kill $(lsof -ti :4000)` then restart |
| `EADDRINUSE: port 3001` | Kill old process: `kill $(lsof -ti :3001)` then restart |
| Reports page empty | Run some tests first from the Run Tests page |
| Test Connection fails in UI | Backend must be running — it proxies through port 4000 |
| All datasource tests fail | Verify token has Admin role in Grafana |
| `better-sqlite3` install fails | Need build tools: `xcode-select --install` (macOS) or `apt install build-essential` (Linux) |
| K8s tests show 0 dashboards | No K8s-tagged dashboards found — add `kubernetes` tag to dashboards |

---

## Windows Setup (Git Bash — No Admin Required)

```bash
# 1. Install Node.js from nodejs.org (LTS, no admin needed with user install)

# 2. Clone
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester

# 3. Backend
cd backend
npm install
cp .env.example .env
# Edit .env with notepad: notepad .env
npm run dev

# 4. Frontend (new terminal)
cd frontend
npm install
npm start

# 5. Open http://localhost:3001
```

---

## Author

**Gopal Rao** — [github.com/gpadidala](https://github.com/gpadidala)

## License

MIT
