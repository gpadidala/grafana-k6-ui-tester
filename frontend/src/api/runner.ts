import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, { transports: ['websocket', 'polling'] });
  }
  return socket;
}

export interface CategoryInfo {
  id: string;
  name: string;
  icon: string;
}

export async function getCategories(): Promise<CategoryInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/tests/categories`);
    if (res.ok) return res.json();
  } catch {}
  // Fallback if backend not available
  return [
    { id: 'api-health',  name: 'API Health',     icon: '💚' },
    { id: 'datasources', name: 'Data Sources',   icon: '🔌' },
    { id: 'folders',     name: 'Folders',        icon: '📁' },
    { id: 'dashboards',  name: 'Dashboards',     icon: '📊' },
    { id: 'panels',      name: 'Panels',         icon: '🔲' },
    { id: 'alerts',      name: 'Alerts',         icon: '🔔' },
    { id: 'plugins',     name: 'Plugins',        icon: '🧩' },
    { id: 'app-plugins', name: 'App Plugins',    icon: '📦' },
    { id: 'users',       name: 'Users & Access', icon: '👥' },
    { id: 'links',       name: 'Links',          icon: '🔗' },
    { id: 'annotations', name: 'Annotations',    icon: '📝' },
  ];
}

export async function runTests(
  grafanaUrl: string,
  token: string,
  categories?: string[],
  onProgress?: (evt: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = getSocket();

    if (onProgress) {
      sock.off('test-progress');
      sock.on('test-progress', onProgress);
    }

    sock.off('test-complete');
    sock.on('test-complete', (report: any) => {
      resolve(report);
    });

    sock.emit('run-tests', { grafanaUrl, token, categories });

    // Timeout after 10 minutes
    setTimeout(() => reject(new Error('Test run timed out after 10 minutes')), 600000);
  });
}

export async function runTestsRest(
  grafanaUrl: string,
  token: string,
  categories?: string[]
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/tests/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grafanaUrl, token, categories }),
  });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

export async function getReports(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE}/api/reports`);
    if (res.ok) return res.json();
  } catch {}
  return [];
}

export async function getReport(file: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/reports/${file}`);
  if (!res.ok) throw new Error(`Report not found: ${res.status}`);
  return res.json();
}

export async function deleteReport(file: string): Promise<void> {
  await fetch(`${API_BASE}/api/reports/${file}`, { method: 'DELETE' });
}

export async function deleteAllReports(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/reports`, { method: 'DELETE' });
  const data = await res.json();
  return data.deleted || 0;
}
