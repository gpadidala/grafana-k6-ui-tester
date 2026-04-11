# Multi-Environment Support

Heimdall is built around the idea that one team typically runs 3 Grafanas: **DEV** (where developers iterate), **PERF** (staging / pre-prod), and **PROD**. Each has different URLs, different tokens, and different blast-radius risks.

## Configuring environments

**Settings → 🌐 Environments** → expand each of DEV / PERF / PROD:

| Field | Description |
|---|---|
| URL | Full Grafana base URL (no trailing slash) |
| API Token | Service-account token with Admin role |
| Color | Optional; drives the pill color in the sidebar |

Click **Test Connection** on each one to verify before saving.

## Switching the active env

The sidebar has three pills right under the logo: `DEV · PERF · PROD`. Click any one to activate it — the selected env drives **every** subsequent action:

- Test runs (K6 / Playwright / JMeter)
- Snapshots
- AI Tests
- Datasource listings
- Impact analysis

An active-env indicator is shown on every page, so you always know which environment you're pointing at.

## Retention per environment

`MAX_RUNS_PER_ENV` (default: 5) auto-prunes older runs *scoped to the active env*. You can keep 10 runs of DEV and 5 of PROD without them polluting each other's history.

## CI/CD use cases

In your pipeline, pass `envKey: 'PROD'` in the run-tests request body and Heimdall tags the run for retention + reporting:

```bash
curl -X POST http://heimdall:4000/api/tests/run \
  -H 'Content-Type: application/json' \
  -d '{"envKey":"PROD","categories":["api-health","alerts"],"grafanaUrl":"...","token":"..."}'
```

## Related

- [CI/CD Integration](../deployment/ci-cd.md)
- [Configuration Reference](../getting-started/configuration.md)
