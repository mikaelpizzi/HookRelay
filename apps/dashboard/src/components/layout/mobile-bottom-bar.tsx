'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Terminal, Radio, ListTree, Sliders } from 'lucide-react';

export function MobileBottomBar() {
  const pathname = usePathname();

  const navItems = [
    {
      label: 'Sandbox',
      href: '/',
      activeHrefs: ['/', '/demo'],
      icon: Terminal,
    },
    {
      label: 'Endpoints',
      href: '/endpoints',
      activeHrefs: ['/endpoints'],
      icon: Radio,
    },
    {
      label: 'Deliveries',
      href: '/deliveries',
      activeHrefs: ['/deliveries'],
      icon: ListTree,
    },
    {
      label: 'Settings',
      href: '/settings',
      activeHrefs: ['/settings'],
      icon: Sliders,
    },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-[#09090b]/95 backdrop-blur-md border-t border-zinc-800 z-30 flex md:hidden items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] h-[calc(3.5rem+env(safe-area-inset-bottom))] select-none"
      aria-label="Mobile Navigation"
    >
      {navItems.map((item) => {
        const isActive = item.activeHrefs.includes(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded transition-colors ${
              isActive
                ? 'text-emerald-400 font-semibold'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon
              className={`w-4 h-4 transition-transform ${
                isActive ? 'scale-110 text-emerald-400' : 'text-zinc-500'
              }`}
            />
            <span className="text-[10px] font-mono tracking-tight mt-1 leading-none">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
