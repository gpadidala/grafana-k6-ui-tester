# Navigation

Full documentation structure for GrafanaProbe.

---

## Documentation map

```
GrafanaProbe Docs
│
├── Introduction
│   └── index.md                          — Architecture, features, supported versions
│
├── Getting Started
│   ├── getting-started/installation.md   — Prerequisites, clone, backend + frontend setup
│   ├── getting-started/quickstart.md     — Docker demo + manual quickstart, first test run
│   └── getting-started/configuration.md — Env vars, multi-environment, LLM config
│
├── Features
│   ├── features/test-categories.md       — All 17 categories with deep-dive descriptions
│   ├── features/dependency-graph.md      — DAG builder, API endpoints, impact analysis
│   ├── features/reports.md               — JSON/HTML format, AI analysis, baseline comparison
│   └── features/frontend-ui.md           — Page-by-page UI walkthrough
│
├── API Reference
│   └── api/reference.md                  — All REST + WebSocket endpoints with examples
│
├── Deployment
│   ├── deployment/docker.md              — Dockerfile, docker-compose, Podman, production tips
│   └── deployment/ci-cd.md              — GitHub Actions, GitLab CI, Jenkins YAML examples
│
├── Guides
│   ├── guides/upgrade-validation.md      — Pre/post upgrade workflow with baseline comparison
│   └── guides/troubleshooting.md         — Common errors, FAQ
│
└── CHANGELOG.md                          — V2.0 and V1.0 release notes
```

---

## Page index

| Page | Path | Description |
|------|------|-------------|
| Introduction | `index.md` | Overview, architecture, key features, supported versions |
| Installation | `getting-started/installation.md` | Step-by-step setup from source |
| Quick Start | `getting-started/quickstart.md` | Get running in < 2 minutes |
| Configuration | `getting-started/configuration.md` | All env vars, multi-env, LLM setup |
| Test Categories | `features/test-categories.md` | Deep dive into all 17 categories |
| Dependency Graph | `features/dependency-graph.md` | Graph API and impact analysis |
| Reports | `features/reports.md` | JSON/HTML format and AI analysis |
| Frontend UI | `features/frontend-ui.md` | UI page-by-page walkthrough |
| API Reference | `api/reference.md` | REST and WebSocket API |
| Docker | `deployment/docker.md` | Container deployment |
| CI/CD | `deployment/ci-cd.md` | Pipeline integration |
| Upgrade Validation | `guides/upgrade-validation.md` | Pre/post upgrade workflow |
| Troubleshooting | `guides/troubleshooting.md` | Common issues and FAQ |
| Changelog | `CHANGELOG.md` | Version history |

---

## Quick links by role

### I'm a developer setting up GrafanaProbe for the first time

1. [Installation](getting-started/installation.md)
2. [Quick Start](getting-started/quickstart.md)
3. [Configuration](getting-started/configuration.md)

### I'm a platform/SRE engineer planning a Grafana upgrade

1. [Upgrade Validation](guides/upgrade-validation.md)
2. [Test Categories](features/test-categories.md)
3. [Dependency Graph](features/dependency-graph.md)
4. [CI/CD Integration](deployment/ci-cd.md)

### I'm integrating GrafanaProbe into a CI/CD pipeline

1. [API Reference](api/reference.md)
2. [CI/CD Integration](deployment/ci-cd.md)
3. [Docker Deployment](deployment/docker.md)

### I'm troubleshooting an issue

1. [Troubleshooting](guides/troubleshooting.md)
2. [Configuration](getting-started/configuration.md)
3. [API Reference](api/reference.md)
