# CI/CD Integration

GrafanaProbe can be integrated into CI/CD pipelines to automatically validate Grafana before and after deployments. This page provides ready-to-use examples for GitHub Actions, GitLab CI, and Jenkins.

---

## Overview

A typical CI/CD integration runs GrafanaProbe in two stages:

1. **Pre-deploy:** Run tests against the target environment and fail the pipeline if critical issues exist
2. **Post-deploy:** Run tests again after the deployment and compare to the pre-deploy baseline to detect regressions

Both stages use the GrafanaProbe REST API (`POST /api/tests/run`) with `grafanaUrl` and `token` passed in the request body.

---

## GitHub Actions

### Basic health check workflow

This workflow runs GrafanaProbe against a staging Grafana instance on every pull request:

```yaml
# .github/workflows/grafana-probe.yml
name: Grafana Health Check

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  grafana-probe:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install backend dependencies
        run: npm ci
        working-directory: backend

      - name: Start GrafanaProbe backend
        env:
          GRAFANA_URL: ${{ secrets.GRAFANA_STAGING_URL }}
          GRAFANA_API_TOKEN: ${{ secrets.GRAFANA_STAGING_TOKEN }}
          PORT: 4000
        run: |
          npm run dev &
          sleep 5
          curl --retry 5 --retry-delay 2 http://localhost:4000/api/health
        working-directory: backend

      - name: Run GrafanaProbe tests
        run: |
          RESULT=$(curl -s -X POST http://localhost:4000/api/tests/run \
            -H "Content-Type: application/json" \
            -d '{
              "grafanaUrl": "${{ secrets.GRAFANA_STAGING_URL }}",
              "token": "${{ secrets.GRAFANA_STAGING_TOKEN }}",
              "categories": ["api-health", "datasources", "dashboards", "alerts"]
            }')
          echo "$RESULT" | jq .
          FAILURES=$(echo "$RESULT" | jq '.summary.failed')
          echo "Failures: $FAILURES"
          if [ "$FAILURES" -gt "0" ]; then
            echo "::error::GrafanaProbe found $FAILURES failing tests"
            exit 1
          fi
```

### Upgrade validation workflow

Runs before and after a Grafana upgrade and uploads both reports as artifacts:

```yaml
# .github/workflows/grafana-upgrade-validate.yml
name: Grafana Upgrade Validation

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment (staging/production)'
        required: true
        default: 'staging'
      phase:
        description: 'Run phase (pre-upgrade or post-upgrade)'
        required: true
        type: choice
        options:
          - pre-upgrade
          - post-upgrade

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: backend

      - name: Start backend
        env:
          GRAFANA_URL: ${{ secrets[format('GRAFANA_{0}_URL', inputs.environment)] }}
          GRAFANA_API_TOKEN: ${{ secrets[format('GRAFANA_{0}_TOKEN', inputs.environment)] }}
        run: |
          npm run dev &
          sleep 5
        working-directory: backend

      - name: Run all 17 test categories
        id: run-tests
        run: |
          RESULT=$(curl -s -X POST http://localhost:4000/api/tests/run \
            -H "Content-Type: application/json" \
            -d '{}')
          echo "$RESULT" > report-${{ inputs.phase }}.json
          echo "failures=$(echo "$RESULT" | jq '.summary.failed')" >> $GITHUB_OUTPUT
          echo "warnings=$(echo "$RESULT" | jq '.summary.warned')" >> $GITHUB_OUTPUT

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: grafana-probe-${{ inputs.phase }}-${{ inputs.environment }}
          path: report-${{ inputs.phase }}.json
          retention-days: 30

      - name: Summary
        run: |
          echo "### GrafanaProbe ${{ inputs.phase }} Results" >> $GITHUB_STEP_SUMMARY
          echo "| Metric | Count |" >> $GITHUB_STEP_SUMMARY
          echo "|--------|-------|" >> $GITHUB_STEP_SUMMARY
          echo "| Failures | ${{ steps.run-tests.outputs.failures }} |" >> $GITHUB_STEP_SUMMARY
          echo "| Warnings | ${{ steps.run-tests.outputs.warnings }} |" >> $GITHUB_STEP_SUMMARY
```

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `GRAFANA_STAGING_URL` | Staging Grafana URL |
| `GRAFANA_STAGING_TOKEN` | Staging Service Account token |
| `GRAFANA_PRODUCTION_URL` | Production Grafana URL |
| `GRAFANA_PRODUCTION_TOKEN` | Production Service Account token |

---

## GitLab CI

### Basic integration

```yaml
# .gitlab-ci.yml
stages:
  - test
  - deploy
  - validate

variables:
  NODE_VERSION: "18"

grafana-probe-pre-deploy:
  stage: test
  image: node:18-alpine
  before_script:
    - apk add --no-cache curl jq
    - cd backend && npm ci
  script:
    - |
      # Start backend in background
      GRAFANA_URL=$GRAFANA_STAGING_URL \
      GRAFANA_API_TOKEN=$GRAFANA_STAGING_TOKEN \
      PORT=4000 \
      node src/server.js &
      sleep 5

      # Run critical categories
      RESULT=$(curl -sf -X POST http://localhost:4000/api/tests/run \
        -H "Content-Type: application/json" \
        -d "{
          \"grafanaUrl\": \"$GRAFANA_STAGING_URL\",
          \"token\": \"$GRAFANA_STAGING_TOKEN\",
          \"categories\": [\"api-health\", \"datasources\", \"alerts\", \"config-audit\"]
        }")

      echo "$RESULT" | jq .summary
      FAILURES=$(echo "$RESULT" | jq '.summary.failed')

      if [ "$FAILURES" -gt "0" ]; then
        echo "ERROR: $FAILURES test failures found — blocking deployment"
        exit 1
      fi
  artifacts:
    paths:
      - backend/reports/
    expire_in: 7 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

grafana-probe-post-deploy:
  stage: validate
  image: node:18-alpine
  before_script:
    - apk add --no-cache curl jq
    - cd backend && npm ci
  script:
    - |
      GRAFANA_URL=$GRAFANA_STAGING_URL \
      GRAFANA_API_TOKEN=$GRAFANA_STAGING_TOKEN \
      PORT=4000 \
      node src/server.js &
      sleep 5

      RESULT=$(curl -sf -X POST http://localhost:4000/api/tests/run \
        -H "Content-Type: application/json" \
        -d "{}")

      echo "$RESULT" | jq .summary
  needs: [deploy]  # Runs after your deploy job
  artifacts:
    reports:
      junit: backend/reports/*.json
    expire_in: 30 days
```

### GitLab CI environment variables

Set these in **Settings → CI/CD → Variables**:

| Variable | Value | Protected | Masked |
|----------|-------|-----------|--------|
| `GRAFANA_STAGING_URL` | `http://grafana.staging.internal:3000` | No | No |
| `GRAFANA_STAGING_TOKEN` | `glsa_...` | Yes | Yes |
| `GRAFANA_PRODUCTION_URL` | `http://grafana.prod.internal:3000` | Yes | No |
| `GRAFANA_PRODUCTION_TOKEN` | `glsa_...` | Yes | Yes |

---

## Jenkins

### Declarative Pipeline

```groovy
// Jenkinsfile
pipeline {
    agent {
        docker {
            image 'node:18-alpine'
            args '-u root'
        }
    }

    environment {
        GRAFANA_URL = credentials('grafana-staging-url')
        GRAFANA_TOKEN = credentials('grafana-staging-token')
    }

    stages {
        stage('Install dependencies') {
            steps {
                sh 'apk add --no-cache curl jq'
                dir('backend') {
                    sh 'npm ci'
                }
            }
        }

        stage('Start GrafanaProbe backend') {
            steps {
                dir('backend') {
                    sh '''
                        GRAFANA_URL=$GRAFANA_URL \
                        GRAFANA_API_TOKEN=$GRAFANA_TOKEN \
                        PORT=4000 \
                        node src/server.js &
                        sleep 8
                        curl --retry 3 http://localhost:4000/api/health
                    '''
                }
            }
        }

        stage('Run Grafana Health Checks') {
            steps {
                script {
                    def result = sh(
                        script: '''
                            curl -sf -X POST http://localhost:4000/api/tests/run \
                              -H "Content-Type: application/json" \
                              -d '{"categories": ["api-health", "datasources", "dashboards", "alerts"]}'
                        ''',
                        returnStdout: true
                    ).trim()

                    def report = readJSON text: result
                    def failures = report.summary.failed

                    echo "Test summary: ${report.summary}"

                    if (failures > 0) {
                        error "GrafanaProbe found ${failures} failing tests — blocking pipeline"
                    }
                }
            }
        }

        stage('Archive reports') {
            steps {
                archiveArtifacts artifacts: 'backend/reports/**/*', fingerprint: true
            }
        }
    }

    post {
        always {
            sh 'pkill -f "node src/server.js" || true'
        }
        failure {
            mail to: 'grafana-team@your-org.com',
                 subject: "GrafanaProbe FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                 body: "Check the build: ${env.BUILD_URL}"
        }
    }
}
```

### Jenkins credentials

Add these in **Manage Jenkins → Credentials**:

| ID | Type | Description |
|----|------|-------------|
| `grafana-staging-url` | Secret text | Staging Grafana URL |
| `grafana-staging-token` | Secret text | Staging Service Account token |

---

## Failing the pipeline on thresholds

You can apply custom thresholds rather than failing on any error:

```bash
# Fail only if more than 5 tests fail
RESULT=$(curl -sf -X POST http://localhost:4000/api/tests/run -H "Content-Type: application/json" -d '{}')
FAILURES=$(echo "$RESULT" | jq '.summary.failed')
THRESHOLD=5

if [ "$FAILURES" -gt "$THRESHOLD" ]; then
  echo "FAIL: $FAILURES failures exceed threshold of $THRESHOLD"
  exit 1
else
  echo "PASS: $FAILURES failures within threshold of $THRESHOLD"
fi
```

Or fail only if a specific category fails:

```bash
# Fail if API Health fails (connectivity issue)
API_STATUS=$(echo "$RESULT" | jq -r '.categories[] | select(.id == "api-health") | .status')
if [ "$API_STATUS" == "fail" ]; then
  echo "CRITICAL: API Health check failed"
  exit 1
fi
```

---

## What's next?

- [Upgrade Validation](../guides/upgrade-validation.md) — pre/post upgrade workflow
- [API Reference](../api/reference.md) — full API endpoint documentation
- [Troubleshooting](../guides/troubleshooting.md) — debug CI/CD issues
