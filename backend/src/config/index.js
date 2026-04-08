require('dotenv').config();

module.exports = {
  grafanaUrl: (process.env.GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, ''),
  grafanaToken: process.env.GRAFANA_API_TOKEN || '',
  grafanaOrgId: process.env.GRAFANA_ORG_ID || '1',
  port: parseInt(process.env.PORT || '4000', 10),
};
