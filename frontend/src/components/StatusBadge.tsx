import React from 'react';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

const COLORS: Record<string, string> = {
  PASS: 'bg-green-900/50 text-green-400 border-green-700',
  FAIL: 'bg-red-900/50 text-red-400 border-red-700',
  WARN: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  passed: 'bg-green-900/50 text-green-400 border-green-700',
  failed: 'bg-red-900/50 text-red-400 border-red-700',
  running: 'bg-blue-900/50 text-blue-400 border-blue-700 animate-pulse',
  pending: 'bg-gray-800/50 text-gray-400 border-gray-700',
};

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const cls = COLORS[status] || COLORS.pending;
  const sz = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded-full border font-semibold uppercase tracking-wide ${cls} ${sz}`}>
      {status}
    </span>
  );
}
