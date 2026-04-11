# Installation

Heimdall runs as a Node.js backend (port 4000) plus a React frontend (port 3001). You can install it three ways: Docker (recommended), manual local install, or from a release archive.

## Prerequisites

- **Node.js 18+** — backend and frontend both require this. Verify with `node -v`.
- **Grafana 9.x – 12.x** — OSS or Enterprise, reachable on the network.
- **A service-account token** — Admin role, generated from `Administration → Service Accounts`.
- **~200 MB disk** — for node_modules and the SQLite history database.

## Option 1 — Docker *(recommended)*

```bash
git clone https://github.com/gpadidala/heimdall.git
cd heimdall
./demo-run.sh
```

The demo script boots a pre-configured Grafana instance alongside Heimdall so you can try it without any setup. See [Docker deployment](../deployment/docker.md) for production configs.

## Option 2 — Manual local install

```bash
git clone https://github.com/gpadidala/heimdall.git
cd heimdall

# Backend
cd backend && npm install && npx playwright install chromium
cp ../.env.example .env  # edit with your Grafana URL + token
npm run dev

# Frontend (new terminal)
cd ../frontend && npm install && npm start
```

Open **<http://localhost:3001>** and you're in. Continue with the [Quick Start](quick-start.md).

## Troubleshooting

Install failures are almost always node-version or proxy related. See [Troubleshooting](../guides/troubleshooting.md#install-issues) for common fixes.
