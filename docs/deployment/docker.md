# Docker Deployment

GrafanaProbe can be deployed as a container using either Docker or Podman. This page covers the included Dockerfile, docker-compose setup, the demo environment, and production deployment tips.

---

## Dockerfile

The included `Dockerfile` in the repository root builds a demo Grafana image based on the official Grafana image, pre-configured for anonymous access:

```dockerfile
# Based on official Grafana image
FROM grafana/grafana:latest

ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=admin
ENV GF_UNIFIED_ALERTING_ENABLED=true
ENV GF_AUTH_ANONYMOUS_ENABLED=true
ENV GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
```

> **Note:** This image is intended for **demo and development** only. Anonymous access with Admin role is not appropriate for production environments.

---

## docker-compose.yml

The included `docker-compose.yml` starts a demo Grafana instance:

```yaml
version: '3.8'
services:
  grafana:
    build: .
    container_name: grafana-k6-test
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_UNIFIED_ALERTING_ENABLED=true
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    restart: unless-stopped

volumes:
  grafana-data:
```

### Start the demo Grafana

```bash
docker compose up -d
docker compose logs -f grafana   # watch startup logs
```

Grafana is healthy when `docker compose ps` shows `healthy` status.

---

## Demo environment (one-command)

The `demo-run.sh` script automates the full demo setup:

```bash
./demo-run.sh            # uses Docker
./demo-run.sh --podman   # uses Podman
```

What the script does:

1. Detects Docker or Podman based on the `--podman` flag
2. Builds and starts the Grafana container via `docker compose up -d`
3. Waits for the Grafana health check to pass (up to 60 seconds)
4. Installs backend dependencies (`npm install` in `backend/`)
5. Starts the backend: `cd backend && npm run dev &`
6. Installs frontend dependencies (`npm install` in `frontend/`)
7. Starts the frontend: `cd frontend && npm start`
8. Opens http://localhost:3001 in your default browser

### Stop the demo

```bash
# Stop all services and remove containers
docker compose down

# Stop but keep volumes (preserve Grafana data)
docker compose stop

# With Podman
podman-compose down
```

---

## Podman support

Podman is a drop-in Docker replacement. GrafanaProbe works with Podman via `podman-compose`.

```bash
# Install podman-compose (if not already installed)
pip3 install podman-compose

# Run the demo
./demo-run.sh --podman
```

> **Note:** On macOS, Podman requires the Podman Machine to be running: `podman machine start`

---

## Running GrafanaProbe backend in a container

To run the GrafanaProbe **backend** itself in a container (not just the demo Grafana), create a `Dockerfile.backend`:

```dockerfile
FROM node:18-alpine

# Install native build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production

COPY backend/ ./

EXPOSE 4000

CMD ["node", "src/server.js"]
```

Build and run:

```bash
docker build -f Dockerfile.backend -t grafanaprobe-backend .

docker run -d \
  --name grafanaprobe-backend \
  -p 4000:4000 \
  -e GRAFANA_URL=http://your-grafana:3000 \
  -e GRAFANA_API_TOKEN=glsa_your_token_here \
  -v $(pwd)/backend/data:/app/data \
  -v $(pwd)/backend/reports:/app/reports \
  grafanaprobe-backend
```

### Volume mounts

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `./backend/data` | `/app/data` | SQLite database (persist across container restarts) |
| `./backend/reports` | `/app/reports` | Generated JSON and HTML reports |

> **Warning:** Without the volume mounts, all reports and run history are lost when the container restarts.

---

## Full stack docker-compose (backend + frontend + Grafana)

Create a `docker-compose.full.yml` for a complete containerized deployment:

```yaml
version: '3.8'

services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=your-secure-password
    volumes:
      - grafana-data:/var/lib/grafana
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 5s
      retries: 12
    restart: unless-stopped

  grafanaprobe-backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: grafanaprobe-backend
    ports:
      - "4000:4000"
    environment:
      - GRAFANA_URL=http://grafana:3000
      - GRAFANA_API_TOKEN=${GRAFANA_API_TOKEN}
      - PORT=4000
    volumes:
      - ./backend/data:/app/data
      - ./backend/reports:/app/reports
    depends_on:
      grafana:
        condition: service_healthy
    restart: unless-stopped

  grafanaprobe-frontend:
    build:
      context: frontend
      dockerfile: Dockerfile.frontend
    container_name: grafanaprobe-frontend
    ports:
      - "3001:80"
    environment:
      - REACT_APP_API_URL=http://grafanaprobe-backend:4000
    depends_on:
      - grafanaprobe-backend
    restart: unless-stopped

volumes:
  grafana-data:
```

Deploy:

```bash
export GRAFANA_API_TOKEN=glsa_your_token_here
docker compose -f docker-compose.full.yml up -d
```

---

## Production deployment tips

### Use official Grafana image

Do not use the demo `Dockerfile` in production. Use the official `grafana/grafana:latest` or pin a specific version:

```yaml
image: grafana/grafana:10.4.1
```

### Disable anonymous access

In production, remove these environment variables:

```yaml
# REMOVE these from production:
# GF_AUTH_ANONYMOUS_ENABLED=true
# GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
```

### Secure the service account token

Store the token in a secrets manager rather than a plain `.env` file:

```bash
# Docker secrets
docker secret create grafana_probe_token - < token.txt

# Reference in compose:
# secrets:
#   - grafana_probe_token
```

### Persist data

Always mount volumes for the SQLite database and reports directory. Without persistence, all history is lost on container restart.

### Resource limits

For production use with large Grafana instances (1000+ dashboards), consider setting container resource limits:

```yaml
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '0.5'
```

---

## What's next?

- [CI/CD Integration](ci-cd.md) — GitHub Actions and GitLab CI examples
- [Upgrade Validation](../guides/upgrade-validation.md) — using GrafanaProbe in upgrade pipelines
- [Troubleshooting](../guides/troubleshooting.md) — Docker-specific issues
