import React from 'react';
import { Page } from '../types';

const NAV_ITEMS: { page: Page; label: string; icon: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '📊' },
  { page: 'run-test', label: 'Run Tests', icon: '▶️' },
  { page: 'history', label: 'Reports', icon: '📋' },
  { page: 'environments', label: 'Settings', icon: '⚙️' },
  { page: 'cron', label: 'Schedules', icon: '🕐' },
];

const CATEGORY_ICONS: Record<string, string> = {
  'api-health': '💚',
  'datasources': '🔌',
  'folders': '📁',
  'dashboards': '📊',
  'panels': '🔲',
  'alerts': '🔔',
  'plugins': '🧩',
  'app-plugins': '📦',
  'users': '👥',
  'links': '🔗',
  'annotations': '📝',
};

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside className="w-64 bg-surface-100 border-r border-surface-300 h-screen flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-surface-300">
        <div className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#3b82f6"/>
            <path d="M8 22V12l4-4 4 6 4-8 4 10v6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Grafana k6</h1>
            <h1 className="text-sm font-bold text-accent leading-tight">UI Tester</h1>
          </div>
        </div>
        <p className="text-[10px] text-muted mt-1.5 tracking-wide uppercase">by Gopal Rao</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3">
        <p className="px-5 py-1.5 text-[10px] text-muted uppercase tracking-widest">Navigation</p>
        {NAV_ITEMS.map(({ page, label, icon }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-all ${
              currentPage === page
                ? 'bg-accent/10 text-accent border-r-2 border-accent font-medium'
                : 'text-muted hover:text-white hover:bg-surface-200'
            }`}
          >
            <span className="text-base w-5 text-center">{icon}</span>
            {label}
          </button>
        ))}

        {/* Category Quick Reference */}
        <p className="px-5 pt-4 pb-1.5 text-[10px] text-muted uppercase tracking-widest">Test Categories (11)</p>
        <div className="px-5 grid grid-cols-4 gap-1">
          {Object.entries(CATEGORY_ICONS).map(([id, icon]) => (
            <div key={id} className="text-center" title={id.replace(/-/g, ' ')}>
              <span className="text-sm cursor-default" title={id}>{icon}</span>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-surface-300 text-[10px] text-muted">
        <p>v1.0.0 — 11 test categories</p>
        <p className="mt-0.5">Backend: localhost:4000</p>
      </div>
    </aside>
  );
}

export { CATEGORY_ICONS };
