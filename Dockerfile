# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Grafana demo instance with pre-loaded dashboards
# ─────────────────────────────────────────────────────────────────────────────
FROM grafana/grafana:11.4.0 AS grafana-demo

# Copy provisioning configs
COPY demo/provisioning /etc/grafana/provisioning

# Create dashboard category folders
RUN mkdir -p /var/lib/grafana/dashboards/infrastructure \
             /var/lib/grafana/dashboards/application \
             /var/lib/grafana/dashboards/business \
             /var/lib/grafana/dashboards/observability

COPY demo/dashboards/infrastructure-overview.json /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/network-traffic.json         /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/kubernetes-cluster.json      /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/application-metrics.json     /var/lib/grafana/dashboards/application/
COPY demo/dashboards/database-performance.json    /var/lib/grafana/dashboards/application/
COPY demo/dashboards/business-kpis.json           /var/lib/grafana/dashboards/business/
COPY demo/dashboards/system-health.json           /var/lib/grafana/dashboards/business/
COPY observability-dashboards/                    /var/lib/grafana/dashboards/observability/

ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=admin
ENV GF_AUTH_ANONYMOUS_ENABLED=true
ENV GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
ENV GF_UNIFIED_ALERTING_ENABLED=true
ENV GF_ALERTING_ENABLED=false
ENV GF_USERS_ALLOW_SIGN_UP=false
ENV GF_LOG_LEVEL=warn
ENV GF_FEATURE_TOGGLES_ENABLE=publicDashboards

EXPOSE 3000

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Sentinel backend (Node.js)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS sentinel-backend

WORKDIR /app

# Install system deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/
COPY core/    ./core/
COPY snapshot/ ./snapshot/
COPY monitor/  ./monitor/
COPY multi-instance/ ./multi-instance/
COPY reports/  ./reports/
COPY cli/      ./cli/
COPY integrations/ ./integrations/
COPY config/   ./config/
COPY package.json ./

RUN mkdir -p /app/data /app/reports /app/snapshots /app/screenshots

# Sentinel web dashboard
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "backend/src/server.js"]
