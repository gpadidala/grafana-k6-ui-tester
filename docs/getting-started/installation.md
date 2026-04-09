# Installation

This page walks you through installing GrafanaProbe from source. For a zero-configuration demo using Docker, see [Quick Start](quickstart.md).

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18 or later | [nodejs.org](https://nodejs.org) — LTS recommended |
| **npm** | 9 or later | Bundled with Node.js |
| **Grafana** | 9.x – 12.x | Any edition (OSS, Enterprise, Cloud) |
| **Git** | Any recent | For cloning |
| **Build tools** | Platform-specific | Required for `better-sqlite3` (see below) |

### Build tools by platform

`better-sqlite3` compiles a native Node.js addon and requires C++ build tools:

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install build-essential python3
```

**Windows:**
```powershell
# Run once in an elevated PowerShell session
npm install -g windows-build-tools
```

> **Note:** On Windows, install Node.js using the standard installer from nodejs.org (not Chocolatey) to avoid PATH issues with native modules.

---

## Step 1: Clone the repository

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
```

---

## Step 2: Set up the backend

```bash
cd backend
npm install
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
cd backend
npm install
copy .env.example .env
```

Open `.env` in your editor and set your Grafana URL and token:

```env
GRAFANA_URL=http://localhost:3000
GRAFANA_API_TOKEN=glsa_your_token_here
GRAFANA_ORG_ID=1
PORT=4000
```

### Creating a Grafana Service Account token

GrafanaProbe needs a Service Account with **Admin** role to access all API endpoints:

1. In Grafana, go to **Administration → Service Accounts**
2. Click **Add service account**
   - Name: `grafana-probe`
   - Role: **Admin**
3. Click **Add service account token**
   - Name: `probe-token`
   - No expiry (or set a rotation schedule)
4. Copy the `glsa_...` token — it is shown only once
5. Paste it as `GRAFANA_API_TOKEN` in `backend/.env`

> **Warning:** The Admin role is required because GrafanaProbe reads organization settings, user lists, plugin signatures, and provisioning state. A Viewer or Editor role will cause many test categories to fail with 403 errors.

---

## Step 3: Start the backend

```bash
# from the backend/ directory
npm run dev
```

A successful start looks like this:

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

If you see `Auth: No token`, check that `GRAFANA_API_TOKEN` is set correctly in `.env`.

---

## Step 4: Set up the frontend

Open a **new terminal window** (keep the backend running):

```bash
# from the repo root
cd frontend
npm install
npm start
```

The frontend opens automatically at **http://localhost:3001**.

> **Tip:** The frontend connects to the backend at `http://localhost:4000` by default. To point it at a different backend host, set `REACT_APP_API_URL=http://your-backend:4000` before running `npm start`.

---

## Step 5: Verify the installation

1. Open **http://localhost:3001** in your browser
2. The Dashboard page should load with a green "Connected" indicator
3. Go to **Settings** and click **Test Connection** — it should show your Grafana version and the currently authenticated user
4. Go to **Run Tests**, select one category (e.g., API Health), and click **Run**
5. Watch the live status board — you should see results stream in within a few seconds

---

## Verifying backend health directly

```bash
curl http://localhost:4000/api/health
# Expected: {"status":"ok","version":"1.0.0","author":"Gopal Rao"}

curl http://localhost:4000/api/config
# Expected: {"grafanaUrl":"http://localhost:3000","hasToken":true,"orgId":"1"}
```

---

## Project structure

```
grafana-k6-ui-tester/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express + Socket.IO server
│   │   ├── config/index.js        # Environment config
│   │   ├── db/index.js            # SQLite schema + queries
│   │   ├── services/
│   │   │   ├── grafanaClient.js   # Grafana API client (9.x–12.x)
│   │   │   ├── testEngine.js      # Test orchestrator (17 categories)
│   │   │   └── dependencyGraph.js # DAG builder + traversal
│   │   └── tests/                 # 17 test category modules
│   ├── data/                      # SQLite database (auto-created)
│   ├── reports/                   # JSON + HTML reports (auto-created)
│   └── .env.example               # Config template
├── frontend/
│   └── src/
│       ├── App.tsx                # Main app with sidebar navigation
│       ├── api/                   # Backend client, LLM, deep-links
│       ├── components/            # Shared UI components
│       └── pages/                 # Dashboard, RunTest, Reports, Settings, Cron
├── demo-run.sh                    # One-command Docker/Podman demo
├── Dockerfile
└── docker-compose.yml
```

---

## What's next?

- [Quick Start](quickstart.md) — run your first test suite
- [Configuration](configuration.md) — all environment variables and multi-environment setup
- [Docker deployment](../deployment/docker.md) — containerized setup for teams
