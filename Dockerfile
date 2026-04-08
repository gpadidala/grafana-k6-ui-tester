FROM grafana/grafana:11.4.0

# Copy provisioning configs
COPY demo/provisioning /etc/grafana/provisioning

# Copy dashboards into categorized folders
RUN mkdir -p /var/lib/grafana/dashboards/infrastructure \
             /var/lib/grafana/dashboards/application \
             /var/lib/grafana/dashboards/business

COPY demo/dashboards/infrastructure-overview.json /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/network-traffic.json /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/kubernetes-cluster.json /var/lib/grafana/dashboards/infrastructure/
COPY demo/dashboards/application-metrics.json /var/lib/grafana/dashboards/application/
COPY demo/dashboards/database-performance.json /var/lib/grafana/dashboards/application/
COPY demo/dashboards/business-kpis.json /var/lib/grafana/dashboards/business/
COPY demo/dashboards/system-health.json /var/lib/grafana/dashboards/business/

# Environment configuration
ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=admin
ENV GF_AUTH_ANONYMOUS_ENABLED=false
ENV GF_UNIFIED_ALERTING_ENABLED=true
ENV GF_ALERTING_ENABLED=false
ENV GF_USERS_ALLOW_SIGN_UP=false
ENV GF_LOG_LEVEL=warn

EXPOSE 3000
