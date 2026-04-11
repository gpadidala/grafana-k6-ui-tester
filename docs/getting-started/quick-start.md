# Quick Start

Zero to first test run in 90 seconds.

## 1. Start Heimdall

If you already installed, skip to step 2. Otherwise:

```bash
git clone https://github.com/gpadidala/heimdall.git
cd heimdall && ./demo-run.sh
```

Open **<http://localhost:3001>**.

## 2. Configure your environment

Click **Settings → 🌐 Environments** and fill in at least one of DEV / PERF / PROD:

- **URL:** `http://your-grafana.example.com` *(no trailing slash)*
- **Token:** `glsa_xxxxxxxxxxxxxxxx` — paste your service-account token

Click **Save**, then click **Test Connection**. You should see the Grafana version echoed back.

## 3. Pick a target environment

In the sidebar, click **DEV** (or whichever env you just configured). The pill turns cyan — this is the active env for every subsequent test run, snapshot, and AI call.

## 4. Run your first test

- Click **Run Tests** in the sidebar
- Engine tab: **K6 API** (default)
- Deselect all categories, then re-select **API Health**, **Data Sources**, **Dashboards** for a ~30-second smoke run
- Click **Run Tests**

Watch the live progress panel as each category executes. Click any FAIL / WARN row to see the detail message and the ↗ Grafana deep-link.

## 5. Explore the results

- **Reports** → your run is persisted with a full HTML report
- **Compare** → once you have two runs, diff them side-by-side
- **Dashboard** → pass-rate trends and quick-actions

## Next steps

- [AI Failure Analysis](../features/ai-analysis.md) — configure OpenAI or Claude
- [Dependency Graph](../features/dependency-graph.md) — impact analysis before upgrades
- [Multi-Environment](../features/environments.md) — DEV/PERF/PROD workflows
