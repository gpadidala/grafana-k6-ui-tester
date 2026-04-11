# Troubleshooting

The most common issues and how to resolve them. If yours isn't here, open a [bug report](../../.github/ISSUE_TEMPLATE/bug_report.md).

## Install issues

### `html-webpack-plugin: module not found`
Caused by `npm workspaces` hoisting frontend deps. Fix: `rm -rf node_modules package-lock.json frontend/node_modules && cd frontend && npm install`.

### `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` during Docker build
Your corporate proxy does MITM SSL inspection. Set `HTTP_PROXY` / `HTTPS_PROXY` env vars before `docker compose build`. See [Docker deployment](../deployment/docker.md#corporate-networks-ssl-proxy).

### `better-sqlite3` native build fails
Heimdall uses `sql.js` (pure JS) instead. If you're seeing this, you're on an old version — update to latest.

## Runtime issues

### Grafana returns 401 on every API call
Your token is invalid or belongs to a different org. Regenerate from `Administration → Service Accounts → Add token`, update `.env`, restart backend.

### Tests hang / take forever
Check the backend log. Usually one of:
1. Individual Grafana API call timing out — increase `QUERY_TIMEOUT_MS`
2. Too many dashboards — use the **Scope by Datasource** filter to narrow
3. Grafana is itself slow — not our problem, but it'll show up here

### "0 dashboards, 0 panels" shown in UI but DB has data
Browser cache. Hard-refresh the page (`⌘⇧R` / `Ctrl+Shift+R`).

### HTML report returns 404
The backend's reports dir resolved relative to a stale cwd. Restart the backend — we now resolve to an absolute path at module load.

### Screenshots don't appear in Playwright reports
Run the backend with `NODE_ENV=production` and make sure `backend/.test-screenshots/` is writable.

## Debug mode

Set `DEBUG=1` in `.env` and restart the backend — you'll get verbose logging of every Grafana API call, including timing and response codes.

## Still stuck?

- Check `heimdall.log` for stack traces
- Open a [bug report](../../.github/ISSUE_TEMPLATE/bug_report.md) with your Grafana version, the exact error, and the category that failed
