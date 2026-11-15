'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTenant } from '../../context/tenant-context';

export function ColdStartBanner() {
  const { isColdStart, healthLatencyMs } = useTenant();

  if (!isColdStart) return null;

  return (
    <div className="bg-amber-950/80 border-b border-amber-800/80 text-amber-200 px-4 py-2 text-xs flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          <strong className="font-semibold text-amber-300">
            Engine Cold Start in Progress:
          </strong>{' '}
          Initializing PostgreSQL and Redis connections. Response latency is
          currently{' '}
          <span className="font-mono">{healthLatencyMs ?? '>5000'}ms</span>.
        </span>
      </div>
      <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-amber-900/60 border border-amber-700/60">
        Cold Start
      </span>
    </div>
  );
}
