# WebSocket Events

Heimdall streams real-time progress from the backend to the browser via Socket.IO on the same port as the REST API (`:4000`). The frontend listens for these events to paint live progress; your custom client can too.

## Connecting

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000');
```

## Events emitted by the server

### `test-progress`

Fired during a K6 run as each category starts and each test result comes in.

```json
{
  "type": "category_start",
  "categoryId": "dashboards",
  "categoryName": "Dashboards",
  "icon": "📊"
}
```

```json
{
  "type": "test_result",
  "categoryId": "dashboards",
  "test": { "name": "[My Dash] Panel count", "status": "PASS", "detail": "12 panel(s)", "ms": 42 }
}
```

```json
{
  "type": "category_done",
  "categoryId": "dashboards",
  "result": { "id": "...", "status": "PASS", "summary": {...} }
}
```

### `pw-progress` / `pw-complete`

Playwright-specific equivalents — `pw_suite_start`, `pw_test_result`, `pw_suite_done`.

### `jm-progress` / `jm-complete`

JMeter performance run progress — `jm_plan_start`, `jm_sample`, `jm_plan_done`.

## Events the client can send

| Event | Payload | Purpose |
|---|---|---|
| `run-tests` | `{ grafanaUrl, token, categories, envKey, datasourceFilter }` | Start a K6 run |
| `run-playwright` | `{ grafanaUrl, token, suites, datasourceFilter }` | Start a Playwright run |
| `run-jmeter` | `{ grafanaUrl, token, plans, threads, duration }` | Start a JMeter run |

## Use case: custom CI dashboard

Connect a WebSocket client in your CI system to surface live progress during long runs instead of polling the REST endpoint.
