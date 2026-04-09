# Dependency Graph

The Dependency Graph is one of GrafanaProbe's most powerful features. It constructs a directed acyclic graph (DAG) that maps the relationships between every resource in your Grafana instance: data sources, dashboards, panels, and plugins.

---

## What the graph maps

```
Data Source ──► Dashboard ──► Panel ──► Plugin
     │               │
     └───────────────┴──► Alert Rule
```

Every edge in the graph represents a dependency relationship:

| Relationship | What it means |
|-------------|---------------|
| Data source → Dashboard | The dashboard contains at least one panel querying this DS |
| Data source → Alert rule | The alert rule queries this DS |
| Dashboard → Panel | The panel is part of this dashboard |
| Panel → Plugin | The panel uses this visualization plugin |
| Panel → Data source | The panel queries this specific DS |
| Plugin → Dashboard | Dashboards using this plugin type |

---

## How the graph is built

After each test run, the Test Engine passes results to the **DAG Builder** (`dependencyGraph.js`), which:

1. Fetches all data sources, dashboards, and panels from the Grafana API
2. Resolves panel `datasource` references by UID
3. Resolves alert rule data source references
4. Builds an adjacency list in memory
5. Persists the graph to SQLite for fast retrieval

The graph is refreshed on every full test run and cached between runs.

---

## API endpoints

The dependency graph is exposed via the backend REST API:

### Get the full graph

```
GET /api/graph
```

Returns all nodes and edges:

```json
{
  "nodes": [
    { "id": "ds:prometheus-uid", "type": "datasource", "name": "Prometheus", "uid": "prometheus-uid" },
    { "id": "db:abc123", "type": "dashboard", "name": "Node Exporter Full", "uid": "abc123" },
    { "id": "panel:abc123:1", "type": "panel", "title": "CPU Usage", "dashboardUid": "abc123" }
  ],
  "edges": [
    { "from": "ds:prometheus-uid", "to": "db:abc123" },
    { "from": "db:abc123", "to": "panel:abc123:1" },
    { "from": "panel:abc123:1", "to": "ds:prometheus-uid" }
  ]
}
```

### Get graph statistics

```
GET /api/graph/stats
```

Returns aggregate counts:

```json
{
  "datasources": 5,
  "dashboards": 142,
  "panels": 1840,
  "plugins": 12,
  "alertRules": 67,
  "edges": 3421
}
```

### Datasource impact analysis

```
GET /api/graph/impact/datasource/:uid
```

Returns all resources that depend on this data source — i.e., everything that breaks if this DS goes down:

```json
{
  "datasource": { "uid": "prometheus-uid", "name": "Prometheus" },
  "impact": {
    "dashboards": [
      { "uid": "abc123", "name": "Node Exporter Full", "url": "/d/abc123" },
      { "uid": "def456", "name": "Kubernetes Overview", "url": "/d/def456" }
    ],
    "panels": 284,
    "alertRules": [
      { "uid": "rule1", "name": "High CPU Alert" }
    ]
  },
  "totalDashboards": 2,
  "totalPanels": 284,
  "totalAlertRules": 1
}
```

### Plugin impact analysis

```
GET /api/graph/impact/plugin/:id
```

Returns all dashboards and panels using a specific plugin type:

```json
{
  "plugin": { "id": "grafana-piechart-panel", "name": "Pie Chart" },
  "impact": {
    "dashboards": 18,
    "panels": 34
  }
}
```

---

## Impact analysis use cases

### Before taking a data source offline

Before maintenance, run:

```bash
curl http://localhost:4000/api/graph/impact/datasource/prometheus-uid
```

This tells you exactly which dashboards and alert rules will be affected — so you can notify dashboard owners and set appropriate alert mute timings.

### Before upgrading a plugin

Before upgrading or removing a plugin:

```bash
curl http://localhost:4000/api/graph/impact/plugin/grafana-piechart-panel
```

See which dashboards use that plugin, so you can test those dashboards after the upgrade.

### Grafana upgrade validation

When upgrading Grafana, the dependency graph helps identify panels using deprecated features:

1. Run all tests before the upgrade — save the report as a baseline
2. Run all tests after the upgrade
3. Compare: any new FAILs in the Panels category map to panels in the dependency graph
4. Use the graph to quickly find all affected dashboards

---

## Graph visualization

> **Note:** The current release exposes the graph via the REST API. A visual graph UI (force-directed layout with D3.js) is planned for a future release. In the meantime, the API response can be fed into any graph visualization tool (e.g., Gephi, Cytoscape.js, or Grafana's Node Graph panel).

### Visualize in Grafana's Node Graph panel

1. Make a GET request to `/api/graph` from a Grafana panel using the Infinity data source
2. Map `nodes` and `edges` to the Node Graph panel's expected format
3. Set node color by `type` field to distinguish DS, dashboards, and panels

---

## What's next?

- [Reports](reports.md) — HTML and JSON report formats, AI analysis
- [API Reference](../api/reference.md) — complete endpoint documentation
- [Upgrade Validation](../guides/upgrade-validation.md) — using the dependency graph during Grafana upgrades
