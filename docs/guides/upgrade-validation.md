# Grafana Upgrade Validation

The canonical playbook for validating a Grafana version bump without surprises. Used by the author to validate upgrades across dozens of dashboards monthly.

## The problem

Every Grafana upgrade silently breaks *something*. Schema migrations, plugin incompatibilities, removed panel types, renamed config keys. You usually find out when a user pings you Monday morning.

## The playbook

### 1. Baseline *before* the upgrade

Against your current (pre-upgrade) Grafana, run the full suite:

```bash
curl -X POST http://heimdall:4000/api/tests/run \
  -H 'Content-Type: application/json' \
  -d '{"envKey":"PROD","categories":["all"]}'
```

Take a **Snapshot** at the same time: **Snapshots → + Create Snapshot → "pre-upgrade-v10.4.0"**. This captures every dashboard JSON, every alert rule, every plugin version — gzipped and stored locally.

### 2. Perform the upgrade

Normal Grafana upgrade procedure. Heimdall doesn't touch this.

### 3. Re-run tests *after* the upgrade

Against the upgraded instance, same categories:

```bash
curl -X POST http://heimdall:4000/api/tests/run \
  -H 'Content-Type: application/json' \
  -d '{"envKey":"PROD","categories":["all"]}'
```

Take a second snapshot: `"post-upgrade-v11.6.0"`.

### 4. Diff the two snapshots

**Snapshots → Compare → pick pre and post → Run Diff**. You get a risk-rated list of every change: panel queries rewritten, alert rules modified, dashboards added/removed — with unified diff views and Grafana deep links.

### 5. Triage failures

- **CRITICAL / HIGH** — block the rollout, fix before proceeding
- **MEDIUM** — investigate, usually a config migration you need to replicate
- **LOW / INFO** — log for awareness, usually harmless

### 6. Email the owners

For any panel that broke, click the 📧 button in the HTML report. The dashboard's `createdBy` and `updatedBy` get a notification with the screenshot and the Grafana deep link.

## Blast-radius pre-check

Before doing the upgrade, use the **Dependency Graph** to see which dashboards use the plugins you're about to update:

```bash
curl http://heimdall:4000/api/graph/impact/plugin/grafana-piechart-panel
```

## Related

- [Dependency Graph](../features/dependency-graph.md)
- [Troubleshooting](troubleshooting.md)
