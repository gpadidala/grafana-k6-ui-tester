# Quick Start

Get GrafanaProbe running in under 2 minutes using the Docker demo, or follow the manual path if you already have a Grafana instance.

---

## Option A: Docker demo (fastest)

This spins up a bundled Grafana instance with demo data — no Grafana installation required.

### Prerequisites

- Docker (or Podman) installed and running
- Ports 3000, 3001, and 4000 free

### Run the demo

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
./demo-run.sh
```

**With Podman instead of Docker:**
```bash
./demo-run.sh --podman
```

The script:
1. Starts a Grafana container on port 3000 (admin/admin)
2. Waits for Grafana to become healthy
3. Starts the GrafanaProbe backend on port 4000
4. Starts the React frontend on port 3001
5. Opens http://localhost:3001 in your browser

> **Note:** The demo Grafana has anonymous access enabled with Admin role — no token setup needed. It includes some provisioned dashboards and data sources to give test categories meaningful results.

### Stop the demo

```bash
# Stop all containers
docker compose down

# Or if using Podman
podman-compose down
```

---

## Option B: Manual quick start (your own Grafana)

### 1. Clone and install

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester

# Backend
cd backend && npm install && cp .env.example .env

# Edit .env with your Grafana URL and token
# GRAFANA_URL=http://your-grafana:3000
# GRAFANA_API_TOKEN=glsa_your_token_here
```

### 2. Start backend

```bash
# In terminal 1 (from backend/)
npm run dev
```

### 3. Start frontend

```bash
# In terminal 2 (from frontend/)
npm install && npm start
```

Frontend opens at **http://localhost:3001**.

---

## Running your first test

1. **Open** http://localhost:3001
2. Click **Run Tests** in the left sidebar
3. In the category selector, check **API Health** (or leave all unchecked to run all 17)
4. Click the **Run** button
5. Watch the live status board — each test result streams in as it completes
6. When the run finishes, expand any category to see individual test results with Grafana deep-links

### Reading the results

| Badge | Meaning |
|-------|---------|
| `PASS` | Test passed — no issues found |
| `WARN` | Potential issue found, but not blocking |
| `FAIL` | Issue found that requires attention |
| `ERROR` | GrafanaProbe could not execute the test (usually auth or connectivity) |

### Viewing the HTML report

After a run completes:
1. Click **Reports** in the sidebar
2. Find your run (most recent is at top)
3. Click the **HTML** icon to open the self-contained report in a new tab
4. The report includes all results, counts, and timestamps — suitable for sharing with your team

---

## What to try next

- Run all 17 categories and review the full report
- Go to **Settings** and add a second environment (PERF, PROD)
- Go to **Settings → LLM** and connect OpenAI or Claude for AI failure analysis
- Go to **Schedules** to set up a daily automated run

---

## What's next?

- [Configuration](configuration.md) — configure environments, LLM, and advanced options
- [Test Categories](../features/test-categories.md) — understand what each of the 17 categories tests
- [Frontend UI](../features/frontend-ui.md) — full walkthrough of every page
