'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Terminal,
  Radio,
  ListTree,
  Sliders,
  X,
  Layers,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';

export function Sidebar() {
  const pathname = usePathname();
  const { environment, isMobileNavOpen, setIsMobileNavOpen } = useTenant();
  const touchStartX = useRef<number | null>(null);

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

  // Touch swipe to close sidebar
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX.current;
    // Swiped left by more than 50px
    if (deltaX < -50) {
      setIsMobileNavOpen(false);
    }
    touchStartX.current = null;
  };

  const renderContent = (isMobile: boolean = false) => (
    <div className="flex flex-col h-full justify-between">
      <div className="p-4 space-y-6 overflow-y-auto">
        {isMobile && (
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-400" />
              <span className="font-bold text-sm tracking-tight text-zinc-100">
                HookRelay
              </span>
            </div>
            <button
              onClick={() => setIsMobileNavOpen(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 transition-colors"
              aria-label="Cerrar menú"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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
                  onClick={() => {
                    if (isMobile) setIsMobileNavOpen(false);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-900 text-zinc-100 border border-zinc-700/80'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-emerald-400' : 'text-zinc-500'
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

      <div className="p-4 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1 font-mono shrink-0">
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
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex w-64 border-r border-zinc-800 bg-[#09090b] flex-col justify-between shrink-0 select-none">
        {renderContent(false)}
      </aside>

      {/* Mobile Drawer (Swipeable & Animated) */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileNavOpen(false)}
          />

          {/* Drawer Body with Swipe Listener */}
          <aside
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#09090b] border-r border-zinc-800 shadow-2xl flex flex-col z-50 select-none animate-in slide-in-from-left duration-200"
          >
            {renderContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
