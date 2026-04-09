# API Reference

The GrafanaProbe backend exposes a REST API on port 4000 (configurable via `PORT` in `.env`). All endpoints return JSON unless otherwise noted.

---

## Base URL

```
http://localhost:4000
```

For production deployments, replace with your backend host and port.

---

## Authentication

The GrafanaProbe API does not require authentication by default — it is designed for internal/team use. If you need to secure the API, place it behind a reverse proxy with authentication (e.g., Nginx with basic auth, or Grafana OAuth proxy).

The API acts as a proxy to Grafana. Grafana credentials are passed in the request body (`grafanaUrl`, `token`) or fall back to the values in `backend/.env`.

---

## Endpoints

### Health

#### `GET /api/health`

Returns backend server health status.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "author": "Gopal Rao"
}
```

---

#### `GET /api/config`

Returns the currently active backend configuration.

**Response:**
```json
{
  "grafanaUrl": "http://localhost:3000",
  "hasToken": true,
  "orgId": "1"
}
```

> **Note:** The token value is never returned — only `hasToken: true/false`.

---

### Connection

#### `POST /api/test-connection`

Tests connectivity to a Grafana instance. Acts as a CORS proxy for the frontend.

**Request body:**
```json
{
  "grafanaUrl": "http://grafana.internal:3000",
  "token": "glsa_your_token_here"
}
```

If `grafanaUrl` or `token` are omitted, the backend `.env` values are used.

**Response (success):**
```json
{
  "ok": true,
  "version": "10.4.1",
  "database": "ok",
  "user": "service-account-grafana-probe",
  "ms": 87
}
```

**Response (failure):**
```json
{
  "ok": false,
  "error": "connect ECONNREFUSED 192.168.1.10:3000",
  "ms": 5001
}
```

---

### Test categories

#### `GET /api/tests/categories`

Returns the list of all 17 test categories.

**Response:**
```json
[
  {
    "id": "api-health",
    "name": "API Health",
    "icon": "💚",
    "description": "Connectivity, auth, response time, build info, org access"
  },
  {
    "id": "datasources",
    "name": "Data Sources",
    "icon": "🔌",
    "description": "Health check per DS, config validation, default DS"
  }
]
```

---

#### `POST /api/tests/run`

Runs one or more test categories and returns the complete report when done. Test progress is also streamed via WebSocket (`test-progress` event).

**Request body:**
```json
{
  "grafanaUrl": "http://grafana.internal:3000",
  "token": "glsa_your_token_here",
  "categories": ["api-health", "datasources", "dashboards"]
}
```

- `grafanaUrl` and `token` — optional; falls back to `.env`
- `categories` — optional array of category IDs. Omit to run all 17.

**Response:** Full [report object](../features/reports.md#json-report-format).

> **Note:** This is a long-running request (typically 30–120 seconds for all 17 categories). Consider using the WebSocket interface for live progress in client applications.

---

#### `POST /api/tests/run-category/:id`

Runs a single test category by ID.

**URL parameters:**
- `:id` — category ID (e.g., `api-health`, `datasources`, `alerts`)

**Request body:**
```json
{
  "grafanaUrl": "http://grafana.internal:3000",
  "token": "glsa_your_token_here"
}
```

**Response:** Report object containing only the specified category's results.

**Example:**
```bash
curl -X POST http://localhost:4000/api/tests/run-category/api-health \
  -H "Content-Type: application/json" \
  -d '{"grafanaUrl": "http://localhost:3000", "token": "glsa_abc123"}'
```

---

### Reports

#### `GET /api/reports`

Lists all stored reports.

**Response:**
```json
[
  {
    "id": "report-1712345678901",
    "timestamp": "2024-04-05T14:22:58.901Z",
    "grafanaUrl": "http://grafana.internal:3000",
    "duration": 42318,
    "summary": {
      "total": 147,
      "passed": 132,
      "warned": 11,
      "failed": 4,
      "errors": 0,
      "categories": 17
    }
  }
]
```

Reports are returned in reverse chronological order (newest first).

---

#### `GET /api/reports/:file`

Returns the full detail of a specific report.

**URL parameters:**
- `:file` — report filename, e.g., `report-1712345678901.json`

**Response:** Full [report object](../features/reports.md#json-report-format) including all category results and individual test details.

**Error response (404):**
```json
{ "error": "Report not found" }
```

---

#### `GET /api/reports/html/:file`

Serves the HTML version of a report as `text/html`.

**URL parameters:**
- `:file` — HTML report filename, e.g., `report-1712345678901.html`

**Response:** Self-contained HTML document. Opens directly in a browser.

---

#### `DELETE /api/reports/:file`

Deletes a single report (both JSON and HTML files) and removes the record from SQLite.

**URL parameters:**
- `:file` — report filename, e.g., `report-1712345678901.json`

**Response:**
```json
{ "deleted": true }
```

**Error response (404):**
```json
{ "error": "Report not found" }
```

---

#### `DELETE /api/reports`

Deletes all reports.

**Response:**
```json
{ "deleted": 14 }
```

Returns the count of deleted reports.

---

### Dependency Graph

#### `GET /api/graph`

Returns the full dependency graph as nodes and edges.

**Response:**
```json
{
  "nodes": [
    {
      "id": "ds:prometheus-uid",
      "type": "datasource",
      "name": "Prometheus",
      "uid": "prometheus-uid"
    },
    {
      "id": "db:abc123",
      "type": "dashboard",
      "name": "Node Exporter Full",
      "uid": "abc123",
      "folder": "Infrastructure"
    }
  ],
  "edges": [
    { "from": "ds:prometheus-uid", "to": "db:abc123" }
  ]
}
```

**Node types:** `datasource`, `dashboard`, `panel`, `plugin`

---

#### `GET /api/graph/stats`

Returns aggregate statistics about the graph.

**Response:**
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

---

#### `GET /api/graph/impact/datasource/:uid`

Returns all dashboards, panels, and alert rules that depend on a specific data source.

**URL parameters:**
- `:uid` — Grafana data source UID

**Response:**
```json
{
  "datasource": {
    "uid": "prometheus-uid",
    "name": "Prometheus",
    "type": "prometheus"
  },
  "impact": {
    "dashboards": [
      {
        "uid": "abc123",
        "name": "Node Exporter Full",
        "url": "/d/abc123/node-exporter-full",
        "panelCount": 42
      }
    ],
    "panels": 284,
    "alertRules": [
      {
        "uid": "rule-1",
        "name": "High CPU Alert",
        "folder": "Infrastructure Alerts"
      }
    ]
  },
  "totalDashboards": 1,
  "totalPanels": 284,
  "totalAlertRules": 1
}
```

---

#### `GET /api/graph/impact/plugin/:id`

Returns all dashboards and panels that use a specific plugin.

**URL parameters:**
- `:id` — Grafana plugin ID (e.g., `grafana-piechart-panel`)

**Response:**
```json
{
  "plugin": {
    "id": "grafana-piechart-panel",
    "name": "Pie Chart (deprecated)",
    "type": "panel"
  },
  "impact": {
    "dashboards": 18,
    "panels": 34,
    "affectedDashboards": [
      { "uid": "dash1", "name": "Business KPIs" },
      { "uid": "dash2", "name": "Revenue Overview" }
    ]
  }
}
```

---

## WebSocket API

GrafanaProbe uses Socket.IO for real-time test progress streaming.

### Connection

```javascript
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000');
```

### Events

#### Emit: `run-tests`

Triggers a test run via WebSocket (alternative to `POST /api/tests/run`).

```javascript
socket.emit('run-tests', {
  grafanaUrl: 'http://localhost:3000',
  token: 'glsa_your_token',
  categories: ['api-health', 'datasources']  // omit for all 17
});
```

#### Listen: `test-progress`

Fired after each individual test completes.

```javascript
socket.on('test-progress', (event) => {
  console.log(event);
  // {
  //   category: "datasources",
  //   test: "Health check: Prometheus",
  //   status: "pass",
  //   message: "Data source is healthy",
  //   grafanaUrl: "http://grafana.internal:3000/connections/datasources/edit/abc123"
  // }
});
```

#### Listen: `test-complete`

Fired when the full run is complete.

```javascript
socket.on('test-complete', (report) => {
  console.log('Run complete:', report.summary);
  // Full report object
});
```

---

## Rate limits and timeouts

The GrafanaProbe API does not impose rate limits. However:

- Test runs are long-running (30–120+ seconds for all 17 categories)
- Only one test run should be active at a time — concurrent runs may produce inconsistent results
- The `POST /api/tests/run` endpoint uses standard HTTP with no streaming; use WebSocket for live updates in browser clients

---

## What's next?

- [Dependency Graph](../features/dependency-graph.md) — understanding graph structure and use cases
- [CI/CD Integration](../deployment/ci-cd.md) — calling the API from GitHub Actions, GitLab CI
- [Troubleshooting](../guides/troubleshooting.md) — common API errors
