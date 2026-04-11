# REST API Reference

Base URL: `http://localhost:4000` (default). All POST requests accept JSON bodies and return JSON.

## Core

### `GET /api/health`
Returns API liveness and the configured Grafana URL.

### `GET /api/config`
Returns the current server config with secrets redacted.

### `POST /api/test-connection`
Body: `{ grafanaUrl, token }`. Probes the Grafana instance and returns `{ ok, version, user, ms }`.

## Categories & runs

### `GET /api/tests/categories`
Returns all 17 test categories with their `id`, `name`, and `icon`.

### `POST /api/tests/run`
Body:
```json
{
  "grafanaUrl": "http://grafana.example.com",
  "token": "glsa_xxx",
  "envKey": "DEV",
  "categories": ["dashboards", "alerts"],
  "datasourceFilter": { "uid": "prometheus-uid" }
}
```
Returns the full report object (`{ id, categories, summary, ... }`). Progress events stream via WebSocket — see [WebSocket Events](websocket-events.md).

### `POST /api/tests/run-category/:id`
Same as `/api/tests/run` but hardcoded to a single category id.

## Reports

| Endpoint | Description |
|---|---|
| `GET /api/reports` | List all runs, newest first, with `categories_run` tags |
| `GET /api/reports/:file` | Full JSON for a specific report |
| `GET /api/reports/html/:file` | HTML-rendered report with donut chart and deep links |
| `DELETE /api/reports/:id` | Delete a run and cascade-delete its test results |

## Graph & impact

| Endpoint | Description |
|---|---|
| `GET /api/graph` | Full dependency graph (nodes + edges) |
| `GET /api/graph/stats` | Node / edge counts per type |
| `GET /api/graph/impact/datasource/:uid` | Dashboards + alerts depending on this DS |
| `GET /api/graph/impact/plugin/:id` | Dashboards using this panel plugin |

## Response shape

All successful responses are `200` with a JSON body. Errors are `4xx` / `5xx` with `{ error: "message" }`.

## Authentication

There's no auth on the Heimdall API itself — it's designed to run inside your trusted network. For public exposure, put it behind a reverse proxy with basic auth or OIDC.
