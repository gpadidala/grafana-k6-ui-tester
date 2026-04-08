// Shared k6 configuration
export const options = {
  thresholds: {
    browser_web_vital_lcp: ['p(75)<4000'],
    browser_web_vital_fid: ['p(75)<300'],
    browser_web_vital_cls: ['p(75)<0.1'],
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.90'],
  },
};
