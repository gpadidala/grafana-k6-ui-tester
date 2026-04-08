# Grafana k6 UI Automation Testing Framework

Production-grade UI testing framework for Grafana using k6 Browser (Chromium-based). Auto-discovers and validates all dashboards, alerts, datasources, and UI pages. Designed for Grafana version upgrade validation.

## Quick Demo

```bash
git clone https://github.com/gpadidala/grafana-k6-ui-tester.git
cd grafana-k6-ui-tester
./demo-run.sh
```

This spins up a local Grafana with 7 sample dashboards, runs the full test suite, and opens an interactive HTML report.

## Features

- Auto-discovers all dashboards, alert rules, datasources, folders, and plugins via Grafana API
- Tests every discovered dashboard for: page load, panel rendering, console errors, error banners, load time
- Validates all core UI pages (home, explore, alerts, admin, plugins, etc.)
- Interactive HTML report with donut chart, filterable table, and inline screenshots
- Version upgrade comparison mode (baseline diff to catch regressions)
- Docker-based demo environment with 7 realistic dashboards
- Configurable test levels: smoke (5 items), standard (20), full (all)
- CI/CD ready with exit code 1 on < 90% pass rate

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) v0.50+ (with browser module)
- [Docker](https://docs.docker.com/get-docker/) (for demo only)
- Python 3 (for report parsing in shell scripts)

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Usage

### Against any Grafana instance

```bash
# Smoke test (5 dashboards)
./run.sh --url https://grafana.example.com --token glsa_xxx --level smoke

# Standard test (20 dashboards)
./run.sh --url https://grafana.example.com --token glsa_xxx --level standard

# Full test (all dashboards)
./run.sh --url https://grafana.example.com --token glsa_xxx --level full

# With baseline comparison
./run.sh --url https://grafana.example.com --token glsa_xxx --level full --baseline ./reports/v10-baseline.json
```

### With environment variables

```bash
cp .env.example .env
# Edit .env with your values
./run.sh
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_URL` | `http://localhost:3000` | Grafana instance URL |
| `GRAFANA_TOKEN` | _(required)_ | Service Account token |
| `GRAFANA_ORG_ID` | `1` | Organization ID |
| `TEST_LEVEL` | `standard` | `smoke` / `standard` / `full` |
| `SCREENSHOT_ON_FAIL` | `true` | Capture screenshots on failure |
| `HEADLESS` | `true` | Run browser headless |
| `PARALLEL_VUS` | `3` | Parallel virtual users |
| `REPORT_DIR` | `./reports` | Output directory |
| `BASELINE_REPORT` | _(empty)_ | Path to baseline JSON for comparison |
| `DASHBOARD_LOAD_TIMEOUT` | `10000` | Max dashboard load time (ms) |

## Project Structure

```
grafana-k6-ui-tester/
├── config/grafana.config.js       # Configuration loader
├── lib/
│   ├── grafana-api.js             # Grafana HTTP API client
│   ├── browser-utils.js           # Browser automation helpers
│   └── reporter.js                # HTML/JSON report generator
├── tests/
│   ├── 01-login.test.js           # Authentication tests
│   ├── 02-home.test.js            # Home page & navigation
│   ├── 03-dashboards.test.js      # Dashboard iteration (critical)
│   ├── 04-alerts.test.js          # Alert rules & silences
│   ├── 05-explore.test.js         # Explore page
│   ├── 06-datasources.test.js     # Datasource configs
│   ├── 07-users-teams.test.js     # User management
│   ├── 08-plugins.test.js         # Plugin pages
│   └── 09-admin.test.js           # Admin pages
├── scenarios/full-suite.js        # Test orchestrator
├── scripts/discover.js            # API discovery
├── demo/                          # Docker demo environment
│   ├── dashboards/                # 7 sample dashboards
│   ├── provisioning/              # Grafana provisioning configs
│   └── setup-service-account.sh   # Token generator
├── Dockerfile                     # Grafana demo image
├── docker-compose.yml
├── demo-run.sh                    # One-command demo
├── run.sh                         # Test runner
└── reports/                       # Generated outputs
```

## Test Coverage

| Test File | What It Tests |
|-----------|--------------|
| 01-login | Login page render, authentication, session validation |
| 02-home | Home page, navigation sidebar, top bar |
| 03-dashboards | **Every dashboard**: load, panels, errors, timing, screenshots |
| 04-alerts | Alert rules list, detail pages, silences, contact points |
| 05-explore | Explore page, datasource selector, query editor |
| 06-datasources | Datasource list, each config page |
| 07-users-teams | Admin users, org users, teams, profile |
| 08-plugins | Plugin list, each plugin detail page |
| 09-admin | Server orgs, stats, settings (graceful 403 skip) |

## CI/CD Integration

### GitHub Actions

```yaml
name: Grafana UI Tests
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - name: Run tests
        run: ./run.sh --url ${{ secrets.GRAFANA_URL }} --token ${{ secrets.GRAFANA_TOKEN }} --level full
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-reports
          path: reports/
```

### GitLab CI

```yaml
grafana-ui-test:
  image: grafana/k6:latest
  script:
    - ./run.sh --url $GRAFANA_URL --token $GRAFANA_TOKEN --level full
  artifacts:
    when: always
    paths:
      - reports/
```

## Version Upgrade Workflow

1. Run tests against current version, save as baseline:
   ```bash
   ./run.sh --url https://grafana.example.com --token xxx --level full
   cp reports/report.json reports/v10-baseline.json
   ```

2. Upgrade Grafana

3. Run tests with baseline comparison:
   ```bash
   ./run.sh --url https://grafana.example.com --token xxx --level full --baseline reports/v10-baseline.json
   ```

4. Check HTML report for regressions (dashboards that passed before but fail now)

## License

MIT
