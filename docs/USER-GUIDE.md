# User Guide — Grafana k6 UI Tester

Step-by-step guide to running tests, reading reports, and interpreting results.

---

## Step 1: Run the Tests

### Option A: Demo Mode (recommended for first-time users)

```bash
./demo-run.sh
```

This handles everything — Docker build, Grafana startup, token creation, test execution, and report opening.

### Option B: Against Your Grafana

```bash
# Create a service account in Grafana UI:
#   Administration > Service Accounts > Add > Role: Admin > Generate Token

./run.sh --url https://your-grafana.com --token glsa_xxx --level full
```

### Option C: Direct k6 Command

```bash
k6 run scenarios/full-suite.js \
  -e GRAFANA_URL=http://localhost:3000 \
  -e GRAFANA_TOKEN=glsa_xxx \
  -e TEST_LEVEL=full \
  -e REPORT_DIR=./reports
```

---

## Step 2: Read the Terminal Output

The terminal shows progress through 6 test phases:

```
=== Phase 1: Login & Home ===         (2-3 seconds)
=== Phase 2: Dashboards ===           (varies by count)
=== Phase 3: Alerts ===               (5-10 seconds)
=== Phase 4: Explore & Datasources === (3-5 seconds)
=== Phase 5: Plugins ===              (20-30 seconds)
=== Phase 6: Users, Teams, Admin ===  (5-10 seconds)
=== All tests complete: 47 results ===
```

Final summary:

```
╔══════════════════════════════════════════════╗
║       GRAFANA UI TEST RESULTS SUMMARY        ║
╠══════════════════════════════════════════════╣
║  Grafana:    11.4.0                          ║
║  Total Tests:  47                            ║
║  Passed:       33                            ║
║  Failed:       14                            ║
║  Pass Rate:    70.2%                         ║
║  Verdict:      FAILED                        ║
╚══════════════════════════════════════════════╝
```

---

## Step 3: Open the HTML Report

The report opens automatically. If not:

```bash
open reports/report.html          # macOS
xdg-open reports/report.html      # Linux
```

Or open `reports/report.html` in any browser.

---

## Step 4: Interpret the Results

### Status Meanings

| Status | Color | Meaning |
|--------|-------|---------|
| **PASS** | Green | Page loaded, all checks passed |
| **FAIL** | Red | Page failed to load, panels have errors, or timeout |
| **WARN** | Yellow | Page loaded but with minor issues (no data panels, slow load) |

### Error Message Guide

| Error Message | What It Means | What to Do |
|---------------|--------------|------------|
| `OK — loaded in 1205ms` | Everything is fine | Nothing — this is healthy |
| `OK — 8 panels loaded, 8 healthy` | All dashboard panels working | Nothing — this is healthy |
| `N panel(s) with errors: [Panel A, Panel B]` | Specific panels failed to render | Check the named panels in Grafana — likely datasource or query errors |
| `N panel(s) missing plugin: [Plugin X]` | Dashboard uses a plugin that's not installed | Install the missing plugin in Grafana |
| `N panel(s) showing "No data"` | Panels can't get data | Check datasource connection and query configuration |
| `Page /path failed (HTTP timeout)` | Page didn't finish loading in time | Grafana may be slow — increase `DASHBOARD_LOAD_TIMEOUT` or check server resources |
| `Page /path failed (HTTP 500)` | Server error | Check Grafana server logs for errors |
| `OK — access denied (HTTP 403)` | User doesn't have permission | Expected for service accounts without admin role |
| `Authentication failed` | Login didn't work | Verify token is valid or enable anonymous access |
| `No panels found on dashboard` | Dashboard has no visible panels | Dashboard may be empty or using unsupported layout |

### Clickable Links

Every row in the report has two clickable links:
1. **Name column** — click the dashboard/alert/plugin name to open it directly in Grafana
2. **Grafana column** — "Open" link for quick access

---

## Step 5: Fix Issues

### Dashboard Panel Errors

If a dashboard shows panel errors:
1. Click the dashboard name in the report to open it in Grafana
2. Look for panels with red error icons or "No data" messages
3. Common fixes:
   - **Missing datasource**: Configure the datasource in Grafana > Configuration > Data sources
   - **Query error**: Edit the panel and fix the query
   - **Missing plugin**: Install the plugin via Grafana > Administration > Plugins

### Page Timeouts

If pages show "HTTP timeout":
1. Check if Grafana is responsive: `curl http://your-grafana:3000/api/health`
2. Increase timeout: set `DASHBOARD_LOAD_TIMEOUT=60000` (60 seconds)
3. Check Grafana server resources (CPU, memory)

### Authentication Issues

If login fails:
1. Verify the service account token: `curl -H "Authorization: Bearer glsa_xxx" http://grafana:3000/api/user`
2. Ensure the service account has **Admin** role
3. Alternative: enable anonymous access in Grafana config for testing

---

## Step 6: Automate

### Schedule Regular Runs

Run weekly to catch issues early:

```bash
# Crontab entry — every Monday at 6am
0 6 * * 1 cd /path/to/grafana-k6-ui-tester && ./run.sh --url https://grafana.example.com --token glsa_xxx --level full
```

### Version Upgrade Workflow

```bash
# 1. Baseline before upgrade
./run.sh --url https://grafana.com --token xxx --level full
cp reports/report.json reports/baseline-v10.json

# 2. Upgrade Grafana...

# 3. Test after upgrade with comparison
./run.sh --url https://grafana.com --token xxx --level full --baseline reports/baseline-v10.json

# 4. Open report — look for "Regressions" section
```

---

## Report Files

After each run, these files are generated in `reports/`:

| File | Purpose |
|------|---------|
| `report.html` | Interactive HTML report — open in browser |
| `report.json` | Machine-readable JSON — use for CI/CD or scripts |
| `manifest.json` | Discovery results (all dashboards, alerts, plugins found) |
| `screenshots/` | PNG screenshots captured on test failures |
