# Docker Deployment

Heimdall ships with a multi-stage Dockerfile that builds both the React frontend and the Node backend into a single image serving everything on port 4000.

## Quick Start

```bash
git clone https://github.com/gpadidala/heimdall.git
cd heimdall

docker compose build
docker compose up -d
```

Open **<http://localhost:4000>**. The frontend is served by Express as static files, so there's only one port to expose.

## With a demo Grafana

```bash
docker compose --profile with-grafana up -d
```

This boots a pre-configured Grafana container alongside Heimdall with anonymous admin access — useful for trying the app without wiring up your own Grafana.

## Corporate networks (SSL proxy)

If your network does MITM SSL inspection and `npm ci` fails inside the build:

```bash
export HTTP_PROXY=http://proxy.corp.example.com:8080
export HTTPS_PROXY=http://proxy.corp.example.com:8080
export NO_PROXY=localhost,127.0.0.1
docker compose build
```

Compose forwards these as `--build-arg` to both stages and the Dockerfile sets `npm config set strict-ssl false` during the build to tolerate the injected CA. Runtime TLS is unchanged.

## Production checklist

- ✅ Persist the data volume — contains the SQLite DB with run history
- ✅ Set `NODE_ENV=production` in the compose file
- ✅ Point at a real Grafana via `GRAFANA_URL` / `GRAFANA_API_TOKEN`
- ✅ Put a reverse proxy in front if exposing publicly (nginx / Traefik / Caddy)
- ✅ Back up `backend/data/heimdall.db` regularly

## Related

- [CI/CD integration](ci-cd.md)
- [Configuration](../getting-started/configuration.md)
