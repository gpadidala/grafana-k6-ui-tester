# GrafanaProbe v2 — Enterprise Grafana Testing Platform

Production-grade testing platform for Grafana with **22 API test categories** + **12 Playwright E2E browser suites**, **dependency graph engine**, **AI failure analysis**, and a **React dashboard UI**.

**by Gopal Rao**

---

## Quick Start (macOS / Linux)

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-probe

# 1. Backend
cd backend
npm install
npx playwright install chromium
cp ../.env.example .env            # Edit with your Grafana URL + token
npm run dev                        # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm start                          # http://localhost:3001
```

---

## Windows Deployment (PowerShell)

### Prerequisites
- **Node.js 18+** — [nodejs.org](https://nodejs.org) (LTS, user install)
- **Git** — [git-scm.com](https://git-scm.com)

### Step-by-Step

```powershell
# 1. Clone
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester\grafana-probe

# 2. Backend setup
cd backend
npm install
npx playwright install chromium

# 3. Configure
copy ..\.env.example .env
notepad .env
# Set: GRAFANA_URL=http://your-grafana:3000
# Set: GRAFANA_API_TOKEN=glsa_your_token_here
# Save and close

# 4. Start backend
npm run dev

# 5. Frontend (NEW terminal window)
cd grafana-k6-ui-tester\grafana-probe\frontend
npm install
npm start

# 6. Open http://localhost:3001
```

### Windows (Git Bash)

```bash
cd grafana-probe
cd backend && npm install && npx playwright install chromium
cp ../.env.example .env && notepad .env   # Edit URL + token
npm run dev

# New terminal:
cd frontend && npm install && npm start
```

---

## Grafana Service Account Token

1. Open Grafana > **Administration > Service Accounts**
2. **Add service account** — Name: `grafana-probe`, Role: **Admin**
3. **Add service account token** — copy the `glsa_...` token
4. Paste into `backend/.env`

---

## Running Tests

Open **http://localhost:3001** > **Run Tests**

| Engine | Tests | What it does |
|--------|-------|-------------|
| **⚡ K6 API** | 22 categories, ~7,000+ tests | Tests Grafana via HTTP API |
| **🎭 Playwright E2E** | 12 suites, 24 specs | Tests Grafana via real Chromium browser |

### CLI

```bash
cd backend
node src/cli.js run --url http://grafana:3000 --token glsa_xxx
node src/cli.js smoke --url http://grafana:3000 --token glsa_xxx
```

---

## Test Coverage

### K6 API (22 Categories)

| # | Category | Tests |
|---|----------|-------|
| 1 | 💚 API Health | Connectivity, auth, latency |
| 2 | 🔌 Data Sources | Health, queries, config |
| 3 | 📁 Folders | Hierarchy, permissions |
| 4 | 📊 Dashboards | Panels, vars, permissions |
| 5 | 🔲 Panels | Query execution, DS refs |
| 6 | 🔔 Alerts | Rules, contacts, policies |
| 7 | 🧩 Plugins | Signatures, versions |
| 8 | 📦 App Plugins | Settings, health |
| 9 | 👥 Users | Orgs, teams, SAs |
| 10 | 🔗 Links | URLs, snapshots |
| 11 | 📝 Annotations | Orphans, integrity |
| 12 | ⏱️ Query Latency | Live profiling |
| 13 | 🔒 Config Audit | Auth, toggles |
| 14 | 📄 Provisioning | Drift detection |
| 15 | 🕐 Data Freshness | Stale detection |
| 16 | 📈 Capacity | Density, load |
| 17 | ☸️ K8s | K8s dashboards |
| 18 | 🔄 Plugin Upgrade | Impact analysis |
| 19 | 🏢 Multi-Org | Per-org tests |
| 20 | 🔍 Regression | Baseline diff |
| 21 | 🚀 Post-Deploy | Deploy validation |
| 22 | 🔔 Alert E2E | Chain trace |

### Playwright E2E (12 Suites)

| Suite | Specs | Tests |
|-------|-------|-------|
| 🔥 Smoke | 3 | Login, nav, health |
| 📊 Dashboards | 3 | Load, vars, time picker |
| 📱 Panels | 2 | Rendering, errors |
| 🔔 Alerting | 3 | Rules, contacts, policies |
| 🧩 Plugins | 2 | Catalog, config |
| 🔌 Datasources | 2 | Config, test button |
| 👥 Admin | 3 | Users, teams, settings |
| 🔍 Explore | 1 | Query page |
| 📸 Visual | 1 | Screenshots |
| ⚡ Performance | 1 | Web Vitals |
| 🔒 Security | 2 | Unauth, sessions |
| ☸️ K8s | 1 | K8s dashboards |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Webpack/module error | `cd frontend && rm -rf node_modules && npm install` |
| PORT not recognized (Windows) | `npm install` fixes it (cross-env) |
| Grafana connection failed | Check `backend/.env` URL and token |
| Port already in use | **macOS:** `kill $(lsof -ti :4000)` **Windows:** `taskkill /f /im node.exe` |
| Playwright won't launch | `cd backend && npx playwright install chromium` |
| Git pull fails (SQLite lock) | Stop backend first, then `git stash && git pull` |

---

## Author

**Gopal Rao** — [github.com/gpadidala](https://github.com/gpadidala)

## License

MIT
