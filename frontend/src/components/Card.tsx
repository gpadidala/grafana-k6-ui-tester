import React from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = '' }: Props) {
  return (
    <div className={`bg-surface-100 border border-surface-300 rounded-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Card>
      <p className="text-xs text-muted uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
