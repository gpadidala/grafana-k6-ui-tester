# Test Categories

GrafanaProbe runs 17 test categories that together cover the full Grafana stack: connectivity, data, dashboards, alerting, plugins, access control, and Kubernetes-specific checks.

Each category is an independent module. You can run all 17 in a single pass, or select individual categories from the Run Tests page.

---

## Category overview

| # | Category | Icon | Focus area |
|---|----------|------|------------|
| 1 | [API Health](#1-api-health) | 💚 | Connectivity and authentication |
| 2 | [Data Sources](#2-data-sources) | 🔌 | Data source health and config |
| 3 | [Folders](#3-folders) | 📁 | Folder structure and permissions |
| 4 | [Dashboards](#4-dashboards) | 📊 | Dashboard quality and references |
| 5 | [Panels](#5-panels) | 🔲 | Panel query and config validation |
| 6 | [Alerts](#6-alerts) | 🔔 | Alert rules, contact points, policies |
| 7 | [Plugins](#7-plugins) | 🧩 | Signatures, versions, updates |
| 8 | [App Plugins](#8-app-plugins) | 📦 | App plugin health and settings |
| 9 | [Users & Access](#9-users--access) | 👥 | Users, orgs, teams, service accounts |
| 10 | [Links](#10-links) | 🔗 | Dashboard links and broken URLs |
| 11 | [Annotations](#11-annotations) | 📝 | Annotation volume and integrity |
| 12 | [Query Latency](#12-query-latency) | ⏱️ | Live query timing and slow detection |
| 13 | [Config Audit](#13-config-audit) | 🔒 | Security and configuration settings |
| 14 | [Provisioning](#14-provisioning) | 📄 | Drift and provisioned dashboard state |
| 15 | [Data Freshness](#15-data-freshness) | 🕐 | Stale data detection |
| 16 | [Capacity Planning](#16-capacity-planning) | 📈 | Dashboard density and load estimation |
| 17 | [K8s Dashboards](#17-k8s-dashboards) | ☸️ | Kubernetes dashboard discovery and validation |

---

## 1. API Health

**What it tests:** The foundation check. Validates that GrafanaProbe can reach your Grafana instance and that the configured token has the expected permissions.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Connectivity | HTTP 200 from `/api/health` | Rules out network/firewall issues |
| Authentication | Token resolves to a valid user | Rules out token expiry or misconfiguration |
| Response time | Health endpoint responds < 2s | Baseline for latency expectations |
| Build info | `/api/frontend/settings` returns build metadata | Confirms Grafana version is detectable |
| Org access | Token is valid in the configured org | Catches cross-org token mismatches |

**Example findings:**
- `FAIL: Connection refused on port 3000` — Grafana is not running or wrong URL
- `FAIL: 401 Unauthorized` — Token is invalid or expired
- `WARN: Response time 1.8s` — Grafana is slow to respond; may affect test accuracy

---

## 2. Data Sources

**What it tests:** Enumerates all configured data sources and runs the Grafana health check endpoint for each one.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Health check per DS | `/api/datasources/:id/health` returns OK | Confirms each DS is reachable and queryable |
| Config validation | Required fields (URL, auth) are present | Catches incomplete DS configs |
| Default data source | At least one DS is marked as default | Required for dashboards without explicit DS refs |
| Duplicate detection | No two DS have identical names | Prevents confusion in dashboard dropdowns |

**Example findings:**
- `FAIL: Prometheus (uid: abc123) — health check failed: connection refused` — Prometheus is down
- `WARN: No default data source configured` — panels without explicit DS refs will fail to query
- `WARN: 3 data sources with identical names` — ambiguous DS references in panels

---

## 3. Folders

**What it tests:** Reviews the folder structure for organization and permission hygiene.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Structure | Folders exist (not everything in General) | Organized Grafana instances are easier to govern |
| Permissions | Folder permissions are explicitly set | Inheriting from org-level can be too broad |
| Dashboard distribution | Dashboards distributed across folders | Excessive concentration in one folder is a scaling risk |

**Example findings:**
- `WARN: 847 dashboards in General folder` — all dashboards ungrouped; no permission control
- `WARN: Folder 'Production' has no explicit permissions` — inheriting org-level (may be too open)

---

## 4. Dashboards

**What it tests:** Validates dashboard configuration quality across all dashboards in the instance.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Panel count | No dashboard > 50 panels | Over-dense dashboards cause browser performance issues |
| Deprecated panel types | No `graph` (v1) panels | `graph` is replaced by `timeseries` in Grafana 8+ |
| Data source references | All DS refs resolve to existing data sources | Broken DS refs = blank panels |
| Template variables | Variables use valid data sources and queries | Misconfigured variables = broken dropdowns |
| Permissions | Non-General dashboards have permissions set | Prevents unintended access |

**Example findings:**
- `FAIL: Dashboard 'K8s Overview' references deleted data source uid:xyz` — panels will be blank
- `WARN: 12 dashboards use deprecated 'graph' panel type` — migrate to 'timeseries'
- `WARN: Dashboard 'API Latency' has 74 panels` — consider splitting into sub-dashboards

---

## 5. Panels

**What it tests:** Deep inspection of individual panels across all dashboards.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Query validation | Panels have non-empty query expressions | Empty queries silently show no data |
| Data source config | Panel DS references are valid | Invalid refs cause "Data source not found" errors |
| Library panels | Library panel references resolve | Deleted library panels leave broken placeholders |
| Empty expressions | No panel has an empty `expr` or `query` field | Silent failures are harder to spot than errors |
| Nested rows | Row nesting is not excessive | Deep nesting causes UI performance issues |

**Example findings:**
- `FAIL: Panel 'CPU Usage' (dashboard: Node Overview) — empty query expression` — panel shows no data
- `WARN: 3 library panel references are broken (source panel deleted)` — visible as "Library panel not found"

---

## 6. Alerts

**What it tests:** Validates the alerting configuration for completeness and correctness.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Alert rules | Rules have valid data source refs and query expressions | Broken alert rules evaluate to Error state silently |
| Contact points | At least one contact point is configured | Alerts fire but go nowhere without contact points |
| Notification policies | Root policy routes to at least one receiver | Default catch-all policy must route somewhere |
| Mute timings | Mute timings reference valid time windows | Invalid mute timings cause scheduling errors |
| Error state rules | No rules currently in Error state | Rules in Error state are not evaluating correctly |

**Example findings:**
- `FAIL: Alert rule 'High CPU' is in Error state — data source unavailable` — alert not evaluating
- `WARN: 5 alert rules have no labels` — notification routing may not match policies
- `WARN: Default notification policy routes to 'email' but no email contact point exists`

---

## 7. Plugins

**What it tests:** Audits all installed plugins for signature status, type distribution, and available updates.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Signatures | All plugins are signed or core | Unsigned plugins are a security risk |
| Types | Plugin type inventory (panel, data source, app) | Helps track what's installed |
| Versions | Plugin version metadata is present | Required for update tracking |
| Update checks | Plugins are checked against Grafana catalog | Outdated plugins may have bugs or security issues |

**Example findings:**
- `WARN: Plugin 'custom-map-panel' has no signature` — unsigned plugin; verify source
- `WARN: Plugin 'grafana-piechart-panel' is deprecated — use built-in piechart` — migrate to core panel
- `INFO: 3 plugins have updates available`

---

## 8. App Plugins

**What it tests:** Checks the health and configuration of installed Grafana App plugins (e.g., Grafana OnCall, Grafana k6, Synthetic Monitoring).

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Settings | App plugins have required settings configured | Misconfigured apps fail silently |
| Health | App plugin health endpoints return OK | Broken apps affect navigation and features |
| Page accessibility | App plugin pages load without 500 errors | Broken pages cause user-visible errors |

**Example findings:**
- `WARN: App plugin 'grafana-oncall-app' health check failed — backend unreachable`
- `INFO: 4 app plugins installed and healthy`

---

## 9. Users & Access

**What it tests:** Audits user accounts, organizations, teams, and service accounts for security hygiene.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Users | User list is accessible, no disabled accounts with Admin | Security hygiene |
| Organizations | Org count and names are valid | Multi-org setups can leak data across orgs |
| Teams | Teams have at least one member | Empty teams are administrative noise |
| Service accounts | Service accounts have the minimum required role | Over-privileged SAs are a risk |
| Role security | No Viewer accounts with Admin role | RBAC misconfiguration |

**Example findings:**
- `WARN: Service account 'old-integration' has Admin role but is unused` — revoke or rotate
- `WARN: 3 teams have 0 members` — clean up unused teams
- `WARN: 12 disabled users still have Admin role` — revoke admin from disabled accounts

---

## 10. Links

**What it tests:** Validates dashboard links and detects broken or inaccessible URLs.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Dashboard links | Links use relative or valid absolute URLs | Broken links frustrate users |
| Broken URLs | External URLs in links are reachable | Dead links reduce dashboard usefulness |
| Snapshots | Snapshot links point to accessible snapshots | Deleted snapshots leave 404 links |

**Example findings:**
- `FAIL: Dashboard 'SLA Overview' has 4 broken links (404)` — update or remove dead links
- `WARN: 2 snapshot links reference deleted snapshots`

---

## 11. Annotations

**What it tests:** Checks annotation health, volume, and integrity across dashboards.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Volume | Annotation count is within healthy limits | Excessive annotations slow dashboard load |
| Orphan detection | Annotations reference existing dashboards | Orphaned annotations waste storage |
| Integrity | Annotation data is well-formed | Malformed annotations cause render errors |

**Example findings:**
- `WARN: 50,000+ annotations detected — consider annotation pruning policy`
- `INFO: 3 orphaned annotations found (dashboard deleted)`

---

## 12. Query Latency

**What it tests:** Executes live queries against each data source and measures response time per panel.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Live query execution | Queries execute without error | Confirms DS connectivity from Grafana's perspective |
| Per-panel timing | Panel queries complete < 5s | Slow queries degrade dashboard UX |
| Slow query detection | No query takes > 10s | Queries over 10s typically indicate missing indexes or over-broad time ranges |

**Example findings:**
- `WARN: Panel 'Request Rate' on 'API Dashboard' — query latency 8.2s` — check Prometheus cardinality
- `FAIL: Panel 'Revenue Trend' — query execution error: context deadline exceeded`

> **Note:** Query Latency runs real queries against your data sources. This is read-only but does consume data source resources. Consider this when running against production.

---

## 13. Config Audit

**What it tests:** Audits Grafana security and configuration settings for common misconfigurations.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Edition | Grafana edition is detected (OSS/Enterprise) | Sets context for available features |
| Anonymous access | Anonymous access is disabled (or intentionally enabled) | Unintentional anonymous access = public Grafana |
| Auth providers | Configured auth providers are valid | Misconfigured OAuth causes login failures |
| Feature toggles | Active feature toggles are inventoried | Experimental features may have stability implications |

**Example findings:**
- `WARN: Anonymous access is enabled with Admin role` — anyone can access Grafana without login
- `INFO: Feature toggle 'publicDashboards' is enabled` — public sharing is active
- `WARN: SMTP is not configured — alert email notifications will not be delivered`

---

## 14. Provisioning

**What it tests:** Detects drift between provisioned configuration (YAML files) and the live Grafana state.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Drift detection | Provisioned resources match their source files | Drift means manual changes that will be lost on next provision |
| Editable provisioned dashboards | Provisioned dashboards are not editable (unless intended) | Editable provisioned dashboards invite drift |
| Reload test | Grafana can reload provisioning without error | Broken provisioning causes Grafana restart failures |

**Example findings:**
- `WARN: Dashboard 'Node Exporter Full' is provisioned but has been manually edited` — changes will be lost on reload
- `FAIL: Provisioning reload returned error — check datasource YAML for syntax errors`

---

## 15. Data Freshness

**What it tests:** Detects dashboards showing stale or no data by checking the last data point timestamp.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Stale data detection | Last data point is within the expected window | Stale data means a broken scrape target or pipeline |
| Per-dashboard freshness | Each dashboard has at least one panel with recent data | Dashboards with only stale data should have an alert |

**Example findings:**
- `WARN: Dashboard 'Kubernetes Nodes' — last data point 4h ago (expected: < 5m)` — node exporter may be down
- `WARN: Dashboard 'Business Metrics' — all panels show no data in last 24h`

---

## 16. Capacity Planning

**What it tests:** Estimates resource consumption and identifies scaling risks.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| Dashboard density | Average panels per dashboard < 30 | High density = high browser memory per user session |
| Data source load | Estimated query rate per DS is reasonable | High query rates cause DS performance issues |
| Alert eval cost | Alert rule count × eval frequency is estimated | Large alert rule sets can overload Grafana evaluator |

**Example findings:**
- `WARN: Estimated 3,200 queries/min across all data sources during dashboard load peak`
- `WARN: Alert evaluator processing 800+ rules at 10s interval — consider increasing interval for low-priority rules`

---

## 17. K8s Dashboards

**What it tests:** Discovers and validates Kubernetes-specific dashboards.

| Test | What passes | Why it matters |
|------|-------------|----------------|
| K8s dashboard discovery | Dashboards tagged `kubernetes` are found | Validates K8s monitoring coverage |
| Variable validation | Namespace/cluster/pod variables use valid queries | Misconfigured K8s variables show empty dropdowns |
| Deprecated metrics | Panels don't use removed Kubernetes metrics | K8s 1.18+ removed several metrics; old queries silently return no data |

**Example findings:**
- `WARN: Dashboard 'Kubernetes Pods' uses deprecated metric 'kube_pod_container_status_ready_time'`
- `WARN: Variable 'namespace' has an empty datasource — will not populate`
- `INFO: 8 Kubernetes dashboards discovered and validated`

> **Tip:** If K8s tests show 0 dashboards, add the `kubernetes` tag to your Kubernetes dashboards in Grafana.

---

## What's next?

- [Dependency Graph](dependency-graph.md) — understand how GrafanaProbe maps relationships between resources
- [Reports](reports.md) — HTML reports, JSON format, and AI analysis
- [API Reference](../api/reference.md) — run tests programmatically
