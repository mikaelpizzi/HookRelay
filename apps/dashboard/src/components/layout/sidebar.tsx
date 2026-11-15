'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Terminal,
  Radio,
  ListTree,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';

export function Sidebar() {
  const pathname = usePathname();
  const { environment } = useTenant();

  const navItems = [
    {
      label: 'Demo Sandbox',
      href: '/',
      activeHrefs: ['/', '/demo'],
      icon: Terminal,
      description: 'Trigger events & live sink receptor',
    },
    {
      label: 'Endpoints Health',
      href: '/endpoints',
      activeHrefs: ['/endpoints'],
      icon: Radio,
      description: 'Circuits, SSRF check & metrics',
    },
    {
      label: 'Delivery Inspector',
      href: '/deliveries',
      activeHrefs: ['/deliveries'],
      icon: ListTree,
      description: 'Audit logs, headers & manual replay',
    },
    {
      label: 'Settings',
      href: '/settings',
      activeHrefs: ['/settings'],
      icon: Sliders,
      description: 'Topics, subscriptions & API keys',
    },
  ];

  return (
    <aside className="w-64 border-r border-zinc-800 bg-[#09090b] flex flex-col justify-between shrink-0 select-none">
      <div className="p-4 space-y-6">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 px-3">
            Console Navigation
          </span>
          <nav className="mt-2 space-y-1">
            {navItems.map((item) => {
              const isActive = item.activeHrefs.includes(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-900 text-zinc-100 border border-zinc-700/80'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-zinc-100' : 'text-zinc-500'
                    }`}
                  />
                  <div>
                    <div className="leading-tight">{item.label}</div>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Quick Architecture Reference */}
        <div className="border border-zinc-800/80 rounded bg-zinc-950 p-3 space-y-2 text-[11px]">
          <span className="text-[10px] font-mono uppercase text-zinc-500">
            Active Profile
          </span>
          <div className="flex justify-between items-center text-zinc-300 font-mono">
            <span>Environment:</span>
            <span
              className={
                environment === 'PRODUCTION'
                  ? 'text-zinc-200 font-semibold'
                  : 'text-amber-400 font-semibold'
              }
            >
              {environment}
            </span>
          </div>
          <div className="flex justify-between items-center text-zinc-300 font-mono">
            <span>Isolation:</span>
            <span className="text-emerald-400">RLS Active</span>
          </div>
          <div className="flex justify-between items-center text-zinc-300 font-mono">
            <span>Outbox:</span>
            <span className="text-zinc-300">Adaptive Poller</span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>PostgreSQL 16</span>
          <span className="text-emerald-400">5432</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Redis 7</span>
          <span className="text-emerald-400">6379</span>
        </div>
        <div className="flex items-center justify-between">
          <span>AWS Emulator</span>
          <span className="text-emerald-400">9297</span>
        </div>
      </div>
    </aside>
  );
}
