import React from 'react';
import { Page } from '../types';

const NAV_ITEMS: { page: Page; label: string; icon: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '📊' },
  { page: 'run-test', label: 'Run Tests', icon: '▶️' },
  { page: 'history', label: 'Reports', icon: '📋' },
  { page: 'environments', label: 'Environments', icon: '⚙️' },
  { page: 'cron', label: 'Schedules', icon: '🕐' },
];

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside className="w-64 bg-surface-100 border-r border-surface-300 h-screen flex flex-col">
      <div className="p-6 border-b border-surface-300">
        <h1 className="text-lg font-bold text-white">Grafana k6 UI Tester</h1>
        <p className="text-xs text-muted mt-1">by Gopal Rao</p>
      </div>
      <nav className="flex-1 py-4">
        {NAV_ITEMS.map(({ page, label, icon }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`w-full flex items-center gap-3 px-6 py-3 text-sm transition-all ${
              currentPage === page
                ? 'bg-accent/10 text-accent border-r-2 border-accent font-medium'
                : 'text-muted hover:text-white hover:bg-surface-200'
            }`}
          >
            <span className="text-base">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-surface-300 text-xs text-muted">
        v1.0.0
      </div>
    </aside>
  );
}
