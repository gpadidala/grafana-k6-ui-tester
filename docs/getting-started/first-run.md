# First Run Walkthrough

A guided tour of what happens during your very first Heimdall run, with screenshots of each step.

## Landing page

When you open <http://localhost:3001> for the first time, the [Welcome Tour](../features/welcome-tour.md) auto-opens on the right side. Click through it or Skip — you can always reopen it from the `?` button in the sidebar footer.

## Configure your Grafana

Before any test can run, Heimdall needs to know where your Grafana lives and how to authenticate:

1. Click **Settings** in the sidebar
2. Expand **DEV** (or PERF / PROD)
3. Paste your Grafana URL and service-account token
4. Click **Test Connection** — you should see `Grafana 11.4.0` (or whatever version) echoed back
5. Click **Save**
6. In the sidebar, click the **DEV** pill to activate it

## Run a smoke suite

1. Click **Run Tests**
2. Engine tab: **K6 API**
3. Click **Deselect All**, then re-select **API Health**, **Data Sources**, **Dashboards**
4. Click **Run Tests**

You'll see the live progress panel fill in as each category executes, with per-test PASS/WARN/FAIL badges streaming back via WebSocket.

## Understanding the results

- **PASS** — the check ran and everything was fine
- **WARN** — something looks off but isn't blocking (missing tags, outdated schema)
- **FAIL** — actual broken state (missing datasource, invalid config)

Click any WARN/FAIL row to see the full failure detail. The test name becomes a clickable link that opens the exact Grafana resource in a new tab.

## View the HTML report

**Reports** → click your new run → click **📄 HTML**. You get a branded standalone page with a donut chart, a summary, and every test result grouped by category — complete with 📧 buttons to email any failure to the dashboard's creator.

## Next

- [17 Test Categories reference](../features/test-categories.md)
- [Dependency Graph](../features/dependency-graph.md)
- [CI/CD integration](../deployment/ci-cd.md)
