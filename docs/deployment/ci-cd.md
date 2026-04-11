# CI/CD Integration

Heimdall drops into any CI system that can make an HTTP call. The usual workflow: run a subset of categories as a post-deploy gate, fail the pipeline if the pass rate drops below a threshold.

## GitHub Actions

```yaml
name: Grafana Validation
on: [deployment_status]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Run Heimdall
        run: |
          RESULT=$(curl -sf -X POST http://heimdall.internal:4000/api/tests/run \
            -H 'Content-Type: application/json' \
            -d '{
              "envKey": "PROD",
              "grafanaUrl": "${{ secrets.GRAFANA_URL }}",
              "token": "${{ secrets.GRAFANA_TOKEN }}",
              "categories": ["api-health", "dashboards", "alerts"]
            }')
          PASS_RATE=$(echo "$RESULT" | jq -r '.summary.pass_rate' | sed 's/%//')
          if (( $(echo "$PASS_RATE < 95" | bc -l) )); then
            echo "::error::Pass rate $PASS_RATE% below 95% threshold"
            exit 1
          fi
```

## GitLab CI

```yaml
grafana_validation:
  stage: verify
  image: alpine:latest
  before_script: [apk add curl jq bc]
  script:
    - |
      curl -X POST $GRAFANA_PROBE_URL/api/tests/run \
        -H 'Content-Type: application/json' \
        -d "{\"envKey\":\"$CI_ENVIRONMENT_NAME\",\"categories\":[\"api-health\",\"dashboards\"]}" \
        -o result.json
      PASS=$(jq -r '.summary.pass_rate' result.json | sed 's/%//')
      [ $(echo "$PASS < 95" | bc -l) -eq 1 ] && exit 1 || exit 0
```

## Jenkins

Same pattern inside a `sh` step. See the [full Jenkins example](https://github.com/gpadidala/heimdall/tree/main/examples/jenkinsfile).

## Tips

- **Use the datasource scope filter** to only test what your deploy actually touched
- **Persist the report URL** in the pipeline output so reviewers can click through
- **Set retention** high enough to compare runs across consecutive deploys

## Related

- [Upgrade Validation playbook](../guides/upgrade-validation.md)
- [Multi-environment](../features/environments.md)
