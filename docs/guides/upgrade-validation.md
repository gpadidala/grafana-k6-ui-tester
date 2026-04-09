# Upgrade Validation

One of the most valuable use cases for GrafanaProbe is validating Grafana upgrades. By capturing a baseline before the upgrade and comparing it to a post-upgrade run, you can quickly identify regressions and ensure nothing broke during the version bump.

---

## Why upgrade validation matters

Grafana upgrades — even minor ones — can:

- Remove deprecated panel types (e.g., `graph` → `timeseries`)
- Change plugin API signatures, breaking existing plugins
- Alter data source health check endpoints
- Modify alert evaluation behavior
- Drop support for old Prometheus query formats
- Change provisioning YAML schema

Without automated validation, these regressions are discovered by users when they open a broken dashboard.

---

## Pre/post upgrade workflow

### Step 1: Capture a pre-upgrade baseline

Before upgrading Grafana, run all 17 test categories and save the report:

**Via the UI:**
1. Go to **Run Tests**
2. Make sure all 17 categories are selected
3. Click **Run**
4. When complete, go to **Reports**
5. Click the **HTML** button to download the pre-upgrade report
6. Save it as `baseline-pre-upgrade-<date>.html`

**Via the API (for CI/CD):**
```bash
curl -X POST http://localhost:4000/api/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "grafanaUrl": "http://grafana.internal:3000",
    "token": "glsa_your_token"
  }' > baseline-pre-upgrade.json
```

**Note the key metrics from the baseline:**

```bash
cat baseline-pre-upgrade.json | jq .summary
# {
#   "total": 147,
#   "passed": 141,
#   "warned": 6,
#   "failed": 0,
#   "errors": 0,
#   "categories": 17
# }
```

Record the failure count per category:

```bash
cat baseline-pre-upgrade.json | jq '.categories[] | {id: .id, status: .status, failed: (.tests | map(select(.status=="fail")) | length)}'
```

---

### Step 2: Upgrade Grafana

Follow your standard upgrade procedure. GrafanaProbe does not need to be stopped — it connects to Grafana's API on demand.

**If Grafana restarts:**
- Wait for the Grafana health check to return green before running post-upgrade tests
- Check `http://grafana.internal:3000/api/health` directly

---

### Step 3: Run post-upgrade validation

Run the same full test suite:

```bash
curl -X POST http://localhost:4000/api/tests/run \
  -H "Content-Type: application/json" \
  -d '{
    "grafanaUrl": "http://grafana.internal:3000",
    "token": "glsa_your_token"
  }' > post-upgrade.json
```

---

### Step 4: Compare results

#### Quick comparison script

```bash
#!/bin/bash
# compare-reports.sh — compare pre and post upgrade reports

PRE=$1   # pre-upgrade JSON file
POST=$2  # post-upgrade JSON file

echo "=== Summary Comparison ==="
echo "PRE:  $(cat $PRE  | jq -c .summary)"
echo "POST: $(cat $POST | jq -c .summary)"

echo ""
echo "=== Category Status Changes ==="
echo "Category                  | Before  | After"
echo "--------------------------|---------|-------"

for cat in api-health datasources folders dashboards panels alerts plugins app-plugins users links annotations query-latency config-audit provisioning data-freshness capacity-planning k8s-dashboards; do
  PRE_STATUS=$(cat $PRE  | jq -r ".categories[] | select(.id==\"$cat\") | .status // \"N/A\"")
  POST_STATUS=$(cat $POST | jq -r ".categories[] | select(.id==\"$cat\") | .status // \"N/A\"")
  CHANGED=""
  if [ "$PRE_STATUS" != "$POST_STATUS" ]; then CHANGED=" *** CHANGED ***"; fi
  printf "%-26s| %-7s | %s%s\n" "$cat" "$PRE_STATUS" "$POST_STATUS" "$CHANGED"
done
```

Run it:

```bash
chmod +x compare-reports.sh
./compare-reports.sh baseline-pre-upgrade.json post-upgrade.json
```

Example output:

```
=== Summary Comparison ===
PRE:  {"total":147,"passed":141,"warned":6,"failed":0,"errors":0,"categories":17}
POST: {"total":147,"passed":138,"warned":6,"failed":3,"errors":0,"categories":17}

=== Category Status Changes ===
Category                  | Before  | After
--------------------------|---------|-------
api-health                | pass    | pass
datasources               | pass    | pass
dashboards                | warn    | warn
panels                    | pass    | fail    *** CHANGED ***
alerts                    | pass    | pass
plugins                   | warn    | fail    *** CHANGED ***
```

---

### Step 5: Investigate regressions

For any category that changed to `fail` or introduced new failures:

#### Panels regression

If the Panels category newly fails after an upgrade, check for deprecated panel types:

```bash
cat post-upgrade.json | jq '.categories[] | select(.id=="panels") | .tests[] | select(.status=="fail") | .message'
```

Common panel regression causes:
- Panel type removed in new Grafana version (e.g., `bargauge` API changes)
- Library panel format changed
- Repeat panel logic changed

#### Plugin regression

If Plugins newly fails:

```bash
cat post-upgrade.json | jq '.categories[] | select(.id=="plugins") | .tests[] | select(.status=="fail")'
```

Common plugin regression causes:
- Plugin requires newer Grafana version than installed
- Plugin signature invalidated by Grafana update
- Deprecated plugin removed from the catalog

#### Alerts regression

```bash
cat post-upgrade.json | jq '.categories[] | select(.id=="alerts") | .tests[] | select(.status=="fail")'
```

Common alert regression causes:
- Alert evaluation engine changes in Grafana 10+ (Unified Alerting migration)
- Contact point schema changes
- Notification policy format changes

---

## Rollback decision criteria

Use these criteria to decide whether to roll back the Grafana upgrade:

| Condition | Recommendation |
|-----------|---------------|
| No new failures (same or fewer than baseline) | Proceed — upgrade is clean |
| New WARN in 1-2 categories | Proceed with monitoring — investigate within 24h |
| New FAIL in Panels (< 5 panels) | Proceed — fix deprecated panels |
| New FAIL in Alerts | Hold — alert regressions mean missed notifications |
| New FAIL in API Health | Roll back — fundamental connectivity issue |
| New FAIL in Data Sources | Hold — investigate before proceeding |
| New FAIL in 3+ categories | Roll back — investigate root cause before retrying upgrade |

> **Warning:** A failure in the Alerts category means some alert rules are not evaluating. This is a high-risk state for production environments. Prioritize fixing alert regressions before proceeding.

---

## Automated upgrade validation in CI/CD

For fully automated validation, see the [Upgrade Validation Workflow](../deployment/ci-cd.md#upgrade-validation-workflow) in the CI/CD integration page.

The workflow:
1. Runs on `workflow_dispatch` with a `phase` input (pre-upgrade / post-upgrade)
2. Archives the report as a GitHub Actions artifact
3. Optionally blocks the pipeline if failures exceed a threshold

---

## Using the dependency graph during upgrades

Before the upgrade, query the dependency graph to understand the blast radius of potential regressions:

```bash
# Which dashboards use the piechart plugin (being deprecated in this upgrade)?
curl http://localhost:4000/api/graph/impact/plugin/grafana-piechart-panel | jq .

# Which dashboards use a specific data source?
curl http://localhost:4000/api/graph/impact/datasource/prometheus-uid | jq .
```

Use this to pre-notify dashboard owners of dashboards that may be affected.

---

## What's next?

- [Reports](../features/reports.md) — baseline comparison and report format
- [CI/CD Integration](../deployment/ci-cd.md) — automating upgrade validation
- [Troubleshooting](troubleshooting.md) — debug upgrade-related failures
