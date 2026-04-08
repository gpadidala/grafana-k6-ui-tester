# Grafana k6 UI Automation Testing Framework

Production-grade UI testing framework for Grafana using **k6 Browser** (Chromium-based). Auto-discovers and validates all dashboards, alerts, datasources, plugins, and admin pages. Designed for **Grafana version upgrade validation** and **continuous UI health monitoring**.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Web Frontend](#web-frontend)
- [What It Tests](#what-it-tests)
- [How It Works](#how-it-works)
- [User Guide](#user-guide)
  - [Running the Demo](#running-the-demo)
  - [Testing Your Own Grafana](#testing-your-own-grafana)
  - [Windows Setup (Git Bash)](#windows-setup-git-bash--no-admin-required)
  - [Understanding the Report](#understanding-the-report)
  - [Reading Error Messages](#reading-error-messages)
  - [Version Upgrade Workflow](#version-upgrade-workflow)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [Project Structure](#project-structure)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Quick Start

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
./demo-run.sh
```

This single command:
1. Auto-installs k6 if missing (macOS/Linux/Windows)
2. Builds a Grafana Docker image with **14 sample dashboards**
3. Starts Grafana, waits until healthy
4. Creates a service account token
5. Runs the full browser test suite (**47 tests**)
6. Opens an interactive HTML report in your browser

---

---

## Web Frontend

A zero-dependency dark-theme SPA served by an Express server on **port 8080**. No build step required — pure HTML, CSS, and vanilla JS.

### Start the dashboard

```bash
# Install Express (once)
npm run frontend:install

# Start on http://localhost:8080
npm run frontend
```

Or run directly:

```bash
cd frontend
npm install
node server.js
# → http://localhost:8080
```

### Environment variables

| Variable      | Default                   | Description                              |
|---------------|---------------------------|------------------------------------------|
| `PORT`        | `8080`                    | Port for the Express server              |
| `API_BACKEND` | `http://localhost:4000`   | URL of the k6 backend API server         |

### Pages

| Page            | Description                                                         |
|-----------------|---------------------------------------------------------------------|
| **Dashboard**   | Overview stats, environment status cards, recent run history        |
| **Run Tests**   | Select environment + test level, trigger a k6 run with live progress|
| **Reports**     | Searchable / filterable run history with per-test drill-down        |
| **Environments**| Configure DEV / PERF / PROD Grafana URLs, tokens, and LLM settings |
| **Schedules**   | Create and manage cron-based scheduled test runs                    |

### Architecture

```
Browser → http://localhost:8080
           │
           ├── GET /          → frontend/public/index.html  (SPA shell)
           ├── GET /styles.css→ frontend/public/styles.css
           ├── GET /app.js    → frontend/public/app.js
           └── POST /api/run  → proxied to http://localhost:4000/api/run
                                 (k6 runner backend)
```

State (environments, test history, schedules) is persisted in browser `localStorage`.
When the backend is unreachable, test runs are simulated client-side so the UI remains fully functional.

### Frontend file layout

```
frontend/
├── public/
│   ├── index.html   # SPA shell — sidebar + all 5 pages
│   ├── styles.css   # Dark theme CSS (CSS custom properties)
│   └── app.js       # All SPA logic, routing, API calls
├── server.js        # Express — serves public/ + proxies /api/*
└── src/             # React source (alternative TypeScript frontend)
```

---

## What It Tests

The framework auto-discovers everything in your Grafana instance and tests it:

| Category | What Gets Tested | Pass Criteria |
|----------|-----------------|---------------|
| **Dashboards** | Every dashboard: page load, panel rendering, panel errors, missing plugins, "no data" panels, error banners, time picker | Page loads, all panels healthy, no error banners |
| **Alerts** | Alert rules list, each rule's edit page, silences, contact points, notification policies | All pages load within timeout |
| **Datasources** | Datasource list, each datasource config page | Pages load, config accessible |
| **Plugins** | Plugin list, top 10 plugin detail pages | All plugin pages render |
| **Explore** | Explore page with datasource selector | Page loads, query editor visible |
| **Users/Teams** | Admin users, org users, teams, profile page | Pages load or graceful 403 |
| **Admin** | Organizations, server stats, server settings | Pages load or graceful 403 |
| **Login** | Authentication flow, session validation | Successful login, session active |

### Dashboard Panel-Level Testing

For each dashboard, the framework inspects **every panel** individually:

- **Healthy panels** — rendered correctly with data
- **Error panels** — panels showing errors (query failures, timeout, etc.)
- **Missing plugin panels** — "Panel plugin not found" errors
- **No data panels** — panels displaying "No data" (datasource misconfigured)
- **Error banners** — dashboard-level error messages

```
Example report output:
  PASS  Infrastructure Overview    OK — 8 panels loaded, 8 healthy, load time 1205ms
  FAIL  Application Metrics        2 panel(s) with errors: [Error Rate, API Latency] | 1 panel(s) showing "No data": [CPU Usage]
  WARN  SLO Dashboard              3 panel(s) showing "No data": [Error Budget, SLI Trend, Compliance]
```

---

## How It Works

```
                         Architecture
┌──────────────────────────────────────────────────┐
│                  demo-run.sh / run.sh            │
│              (orchestrates everything)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  Step 1: API Discovery (k6 HTTP)                 │
│    ├── GET /api/health          → version        │
│    ├── GET /api/search          → dashboards     │
│    ├── GET /api/v1/provisioning → alert rules    │
│    ├── GET /api/datasources     → datasources    │
│    └── GET /api/plugins         → plugins        │
│                                                  │
│  Step 2: Browser Tests (k6 Chromium)             │
│    ├── Phase 1: Login & Home                     │
│    ├── Phase 2: All Dashboards (panel-level)     │
│    ├── Phase 3: Alerts                           │
│    ├── Phase 4: Explore & Datasources            │
│    ├── Phase 5: Plugins                          │
│    └── Phase 6: Users, Teams, Admin              │
│                                                  │
│  Step 3: Report Generation                       │
│    ├── report.json   (machine-readable)          │
│    ├── report.html   (interactive dashboard)     │
│    └── screenshots/  (failure captures)          │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## User Guide

### Running the Demo

The demo includes a pre-configured Grafana with **14 dashboards** across 4 categories:

| Category | Dashboards |
|----------|-----------|
| **Infrastructure** | Infrastructure Overview, Network Traffic, Kubernetes Cluster |
| **Application** | Application Metrics, Database Performance |
| **Business** | Business KPIs, System Health |
| **Observability-KPI** | App Overview (4 Signals), Loki Logs Deep Dive, Mimir Infrastructure, Pyroscope Profiling, SLO/SLI Dashboard, Tempo Tracing, User Journey |

```bash
# Run the full demo (builds Docker, tests, opens report)
./demo-run.sh
```

**What you'll see in the terminal:**

```
╔══════════════════════════════════════════════╗
║   Grafana k6 UI Tester — Demo Environment    ║
╚══════════════════════════════════════════════╝

Checking prerequisites...
All prerequisites met

[1/5] Building and starting Grafana...
[2/5] Waiting for Grafana to be healthy...
Grafana is ready! (6s)
[3/5] Creating service account token...
Token obtained
[4/5] Running k6 test suite...

╔══════════════════════════════════════════════╗
║       GRAFANA UI TEST RESULTS SUMMARY        ║
╠══════════════════════════════════════════════╣
║  Grafana:    11.4.0                          ║
║  Test Level: full                            ║
║  Total Tests:  47                            ║
║  Passed:       33                            ║
║  Failed:       14                            ║
║  Warnings:     0                             ║
║  Pass Rate:    70.2%                         ║
╚══════════════════════════════════════════════╝

[5/5] Opening HTML report...
```

At the end, press **Enter** to tear down the demo or **Ctrl+C** to keep Grafana running at `http://localhost:3000` (login: `admin` / `admin`).

---

### Testing Your Own Grafana

#### Option 1: .env File (Recommended — keeps secrets out of git)

```bash
cp .env.example .env
```

Edit `.env` with your values:
```bash
GRAFANA_URL=https://your-grafana.example.com
GRAFANA_TOKEN=glsa_your_token_here
TEST_LEVEL=full
```

Then just run:
```bash
./run.sh
```

> `.env` is gitignored — your URL and token will **never** be committed.

#### Option 2: CLI Flags

```bash
./run.sh --url https://your-grafana.example.com \
         --token glsa_your_token_here \
         --level full
```

#### Option 3: Environment Variables

```bash
export GRAFANA_URL=https://your-grafana.example.com
export GRAFANA_TOKEN=glsa_your_token_here
export TEST_LEVEL=full
./run.sh
```

#### Test Levels

| Level | Dashboards Tested | Use Case |
|-------|------------------|----------|
| `smoke` | First 5 | Quick health check (< 1 min) |
| `standard` | First 20 | Regular validation (2-3 min) |
| `full` | All discovered | Complete audit (5-10 min) |

---

### Windows Setup (Git Bash — No Admin Required)

For corporate Windows environments without admin access:

**Step 1: Install k6 (portable — no admin needed)**

Open Git Bash and run:
```bash
mkdir -p ~/k6
curl -sL https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-windows-amd64.zip -o ~/k6/k6.zip
cd ~/k6 && unzip k6.zip && mv k6-v0.56.0-windows-amd64/k6.exe .
export PATH="$HOME/k6:$PATH"

# Verify
k6 version
```

To make `k6` permanent (no admin):
1. Open Start Menu, search **"Edit environment variables for your account"**
2. Select `Path` → Edit → New → add `%USERPROFILE%\k6`
3. Click OK and restart Git Bash

> `run.sh` also auto-detects `~/k6/k6.exe` if it's not in PATH.

**Step 2: Clone and configure**
```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
cp .env.example .env
```

Edit `.env` (use `notepad .env` or `vi .env`):
```
GRAFANA_URL=https://your-grafana.example.com
GRAFANA_TOKEN=glsa_your_token_here
TEST_LEVEL=full
```

**Step 3: Run**
```bash
./run.sh
```

The HTML report auto-opens in your default browser. Results are saved in `reports/`.

**What `run.sh` handles on Windows:**
- Auto-finds k6 at `~/k6/k6.exe` (portable install)
- Uses `python` instead of `python3` (Git Bash convention)
- Falls back to `grep` if no Python is available
- Opens report with `start` / `explorer.exe`
- No `bc` dependency (uses integer math)

---

### Understanding the Report

The HTML report opens automatically after tests complete. It has several sections:

#### 1. Summary Cards
Shows total tests, passed, failed, warnings, and pass rate at a glance with a donut chart.

#### 2. Verdict Banner
- **Green "PASSED"** — 90%+ pass rate, your Grafana is healthy
- **Red "FAILED"** — Below 90% pass rate, investigate the failures

#### 3. Category Badges
Quick breakdown by category (e.g., `dashboards: 12/14`, `plugins: 11/11`)

#### 4. Results Table
Every test result with:

| Column | Description |
|--------|-------------|
| **#** | Test number |
| **Category** | dashboards, alerts, plugins, etc. |
| **Name** | Clickable link — opens the item directly in Grafana |
| **UID** | Grafana unique identifier |
| **Status** | PASS (green), FAIL (red), WARN (yellow) |
| **Load Time** | How long the page took to load |
| **Error** | Detailed error message explaining what went wrong |
| **Grafana** | "Open" link — click to jump to that page in Grafana |
| **Screenshot** | Failure screenshot (if available) |

Use the **search box** and **filter dropdowns** to find specific results.

---

### Reading Error Messages

Every test result includes a human-readable error message:

#### Success Messages
```
OK — loaded in 1205ms
OK — 8 panels loaded, 8 healthy, load time 1205ms
OK — authenticated successfully, session active
OK — access denied (HTTP 403), requires elevated permissions
```

#### Dashboard Panel Failures
```
2 panel(s) with errors: [Error Rate Panel, API Latency Panel]
1 panel(s) missing plugin: [Custom Viz Plugin]
3 panel(s) showing "No data": [CPU Usage, Memory, Disk]
Page error banner: Dashboard not found
No panels found on dashboard — it may be empty or failed to render
```

#### Page Load Failures
```
Page /alerting/silences failed (HTTP timeout). Verify page exists and Grafana is responsive.
Page /admin/settings failed (HTTP 500). Verify page exists and Grafana is responsive.
Dashboard failed to load (HTTP timeout). The page at /d/my-dashboard returned an error or timed out.
```

#### Authentication Failures
```
Authentication failed — browser was redirected to /login. Check credentials or anonymous access config.
```

---

### Version Upgrade Workflow

The primary use case — validate Grafana before and after an upgrade:

**Step 1: Baseline (before upgrade)**
```bash
./run.sh --url https://grafana.example.com --token xxx --level full
cp reports/report.json reports/v10-baseline.json
```

**Step 2: Upgrade Grafana**

**Step 3: Post-upgrade test with comparison**
```bash
./run.sh --url https://grafana.example.com --token xxx --level full \
         --baseline reports/v10-baseline.json
```

**Step 4: Review the comparison report**

The HTML report will include a **Version Upgrade Comparison** section showing:
- **Regressions** — dashboards that passed before but fail now
- **Resolved** — dashboards that failed before but pass now
- **New tests** — dashboards added since the baseline
- Dashboard count change

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_URL` | `http://localhost:3000` | Grafana instance URL |
| `GRAFANA_TOKEN` | _(empty)_ | Service Account token (or use anonymous access) |
| `GRAFANA_ORG_ID` | `1` | Organization ID |
| `TEST_LEVEL` | `standard` | `smoke` / `standard` / `full` |
| `SCREENSHOT_ON_FAIL` | `true` | Capture screenshots on failure |
| `HEADLESS` | `true` | Run browser headless |
| `REPORT_DIR` | `./reports` | Output directory |
| `BASELINE_REPORT` | _(empty)_ | Path to baseline JSON for comparison |
| `DASHBOARD_LOAD_TIMEOUT` | `30000` | Max dashboard load time (ms) |
| `RATE_LIMIT_MS` | `500` | Delay between page navigations (ms) |
| `MAX_RETRIES` | `3` | Retry count for failed navigations |

---

## Docker vs Podman

The framework auto-detects your container runtime. No config changes needed.

| Feature | Docker | Podman |
|---------|--------|--------|
| **Auto-detected** | Yes | Yes |
| **Build command** | `docker compose build` | `podman build` |
| **Compose tool** | `docker compose` / `docker-compose` | `podman-compose` / `podman compose` |
| **Dockerfile** | `Dockerfile` | `Containerfile` (symlinked) |
| **Rootless** | Requires config | Default |
| **Corporate/air-gapped** | Needs Docker Hub | Works with any registry |

### Force a specific runtime

```bash
# Force Podman even if Docker is installed
CONTAINER_RUNTIME=podman ./demo-run.sh

# Force Docker
CONTAINER_RUNTIME=docker ./demo-run.sh
```

### Podman with private registry (corporate/air-gapped)

If your environment can't pull from Docker Hub, push the Grafana image to your internal registry first:

```bash
# Pull and push to internal registry
podman pull docker.io/grafana/grafana:11.4.0
podman tag grafana/grafana:11.4.0 your-registry.corp.com/grafana/grafana:11.4.0
podman push your-registry.corp.com/grafana/grafana:11.4.0

# Update Dockerfile FROM line
sed -i 's|grafana/grafana:11.4.0|your-registry.corp.com/grafana/grafana:11.4.0|' Dockerfile
```

---

## Use Cases

### 1. Grafana Version Upgrade Validation
Run the test suite before and after upgrading Grafana. Compare reports to catch regressions — dashboards that break, plugins that go missing, or pages that stop loading.

### 2. Dashboard Health Monitoring
Schedule regular runs to detect dashboard issues early — broken panels, missing datasources, plugin errors. Each dashboard is tested at the panel level.

### 3. New Dashboard Deployment Verification
After deploying new dashboards (via provisioning or API), run the test suite to verify they load correctly, all panels render, and no errors appear.

### 4. Alerting Configuration Validation
Tests every alert rule's edit page, silences, contact points, and notification policies. Catches configuration issues before they affect incident response.

### 5. Plugin Compatibility Check
After installing or updating plugins, verify all plugin pages load and existing dashboards using those plugins still render.

### 6. Access Control Testing
Detects permission issues — pages returning 403 are reported as graceful denials. Token-based or anonymous access configurations are validated.

### 7. CI/CD Pipeline Integration
Run as a gate in deployment pipelines to prevent broken Grafana configs from reaching production.

---

## Project Structure

```
grafana-k6-ui-tester/
├── config/
│   └── grafana.config.js             # Configuration from env vars
├── lib/
│   ├── grafana-api.js                # HTTP API discovery client
│   ├── browser-utils.js              # Browser automation + panel inspection
│   └── reporter.js                   # HTML/JSON report generator with deep links
├── tests/                            # Individual test modules
│   ├── 01-login.test.js              # Authentication tests
│   ├── 02-home.test.js               # Home page & navigation
│   ├── 03-dashboards.test.js         # Dashboard iteration (per-panel)
│   ├── 04-alerts.test.js             # Alert rules & silences
│   ├── 05-explore.test.js            # Explore page
│   ├── 06-datasources.test.js        # Datasource configs
│   ├── 07-users-teams.test.js        # User management
│   ├── 08-plugins.test.js            # Plugin pages
│   └── 09-admin.test.js              # Admin pages
├── scenarios/
│   └── full-suite.js                 # Test orchestrator (all phases)
├── scripts/
│   └── discover.js                   # Standalone API discovery
├── demo/
│   ├── dashboards/                   # 7 sample demo dashboards
│   ├── provisioning/                 # Grafana provisioning configs
│   │   ├── dashboards/               # Dashboard providers
│   │   ├── datasources/              # TestData datasource
│   │   └── alerting/                 # 5 sample alert rules
│   └── setup-service-account.sh      # Token generator script
├── observability-dashboards/          # 7 Observability-KPI dashboards
├── Dockerfile                        # Container image (Docker + Podman)
├── Containerfile -> Dockerfile       # Podman alias (symlink)
├── docker-compose.yml                # Compose config (Docker + Podman)
├── demo-run.sh                       # One-command demo runner
├── run.sh                            # Test runner CLI
├── .env.example                      # Environment variable template
└── reports/                          # Generated outputs
    ├── report.html                   # Interactive HTML report
    ├── report.json                   # Machine-readable results
    ├── manifest.json                 # Discovery results
    └── screenshots/                  # Failure screenshots
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Grafana UI Tests
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - name: Run UI tests
        run: |
          ./run.sh --url ${{ secrets.GRAFANA_URL }} \
                   --token ${{ secrets.GRAFANA_TOKEN }} \
                   --level full
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: grafana-ui-test-report
          path: reports/
```

### GitLab CI

```yaml
grafana-ui-test:
  image: grafana/k6:latest
  script:
    - ./run.sh --url $GRAFANA_URL --token $GRAFANA_TOKEN --level full
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 30 days
```

### Jenkins

```groovy
pipeline {
    agent any
    stages {
        stage('Grafana UI Tests') {
            steps {
                sh './run.sh --url ${GRAFANA_URL} --token ${GRAFANA_TOKEN} --level full'
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/**'
                    publishHTML(target: [
                        reportDir: 'reports',
                        reportFiles: 'report.html',
                        reportName: 'Grafana UI Test Report'
                    ])
                }
            }
        }
    }
}
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `./run.sh: No such file or directory` | Run `cd /path/to/grafana-k6-ui-tester` first, or use `bash run.sh` |
| `k6: command not found` (Windows) | Install k6 portable: `mkdir ~/k6 && curl -sL .../k6.zip -o ~/k6/k6.zip` — see [Windows Setup](#windows-setup-git-bash--no-admin-required) |
| `python3: not found` (Windows) | `run.sh` auto-falls back to `python` or `grep`. No action needed |
| Podman: `podman-compose not found` | Install: `pip3 install podman-compose` |
| Podman: image pull fails | Your registry may block Docker Hub. See [Podman with private registry](#podman-with-private-registry-corporateair-gapped) |
| Podman: permission denied | Run `podman machine init && podman machine start` on macOS |
| `k6 is required` | Install: `brew install k6` (macOS) or see [k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/) |
| `connection refused` | Ensure Grafana is running and accessible at the specified URL |
| All dashboards show "No data" panels | Expected in demo mode — TestData datasource generates random data, not real metrics |
| Pages timing out | Increase `DASHBOARD_LOAD_TIMEOUT` (default 30s). Some pages need longer for `networkidle` |
| Authentication failures | Verify your service account token has **Admin** role, or enable anonymous access for testing |
| `getcwd: cannot access parent directories` | Your terminal directory is stale. Run `cd /path/to/grafana-k6-ui-tester` to reset |

---

## Prerequisites

- **[k6](https://k6.io/docs/get-started/installation/)** v0.50+ (with browser module)
- **Container runtime** (for demo only) — either:
  - **[Docker](https://docs.docker.com/get-docker/)** + Docker Compose, or
  - **[Podman](https://podman.io/docs/installation)** + podman-compose
- **Python 3** (for report parsing in shell scripts)

```bash
# k6 — macOS
brew install k6

# k6 — Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# k6 — Windows
choco install k6

# Podman (if not using Docker)
# macOS
brew install podman podman-compose
# Linux (RHEL/CentOS/Fedora)
sudo dnf install podman podman-compose
# Linux (Debian/Ubuntu)
sudo apt-get install podman && pip3 install podman-compose
```

---

## Author

**Gopal Rao** — [github.com/gpadidala](https://github.com/gpadidala)

## License

MIT
