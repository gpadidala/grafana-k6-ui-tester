// Build Grafana deep-link for a test result
export function grafanaLink(baseUrl: string, categoryId: string, uid: string): string {
  if (!uid || !baseUrl) return '';
  const base = baseUrl.replace(/\/$/, '');
  switch (categoryId) {
    case 'api-health':   return `${base}/admin`;
    case 'dashboards':   return `${base}/d/${uid}`;
    case 'panels':       return `${base}/d/${uid}`;
    case 'folders':      return `${base}/dashboards/f/${uid}`;
    case 'datasources':  return `${base}/datasources/edit/${uid}`;
    case 'alerts':       return `${base}/alerting/${uid}/edit`;
    case 'plugins':      return `${base}/plugins/${uid}`;
    case 'app-plugins':  return `${base}/plugins/${uid}`;
    case 'users':        return `${base}/admin/users`;
    case 'links':        return `${base}/d/${uid}`;
    case 'annotations':  return `${base}/d/${uid}`;
    default: return '';
  }
}
