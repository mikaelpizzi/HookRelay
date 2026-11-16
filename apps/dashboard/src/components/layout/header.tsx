'use client';

import React from 'react';
import { ShieldCheck, RefreshCw, Layers, Menu, X } from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../ui/badge';
import { EnvironmentType } from '../../lib/types';

export function Header() {
  const {
    apiKey,
    environment,
    setEnvironment,
    tenantName,
    healthStatus,
    healthLatencyMs,
    enterDemoTenant,
    refreshHealth,
    isMobileNavOpen,
    toggleMobileNav,
  } = useTenant();

  const isDemoKey =
    apiKey === 'hr_live_demo_corp_00000000000000000000000000000000' ||
    apiKey === 'hr_test_demo_corp_00000000000000000000000000000000';

  const handleEnvChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setEnvironment(e.target.value as EnvironmentType);
  };

  return (
    <header className="h-14 border-b border-zinc-800 bg-[#09090b] px-3 sm:px-6 flex items-center justify-between z-30 shrink-0">
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Mobile Hamburger Toggle */}
        <button
          onClick={toggleMobileNav}
          className="p-1.5 rounded border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 md:hidden transition-colors"
          aria-label={isMobileNavOpen ? 'Close navigation' : 'Open navigation'}
        >
          {isMobileNavOpen ? (
            <X className="w-4 h-4" />
          ) : (
            <Menu className="w-4 h-4" />
          )}
        </button>

        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="font-bold text-sm tracking-tight text-zinc-100">
            HookRelay
          </span>
          <span className="hidden xs:inline font-mono text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
            v1.0.0
          </span>
        </div>

        {/* Backend Health Badge */}
        <div
          className="flex items-center gap-1.5 cursor-pointer select-none"
          onClick={() => refreshHealth()}
          title="Click to refresh engine health check"
        >
          <Badge
            statusText={healthStatus}
            size="sm"
            className="hover:border-zinc-700 transition-colors"
          >
            {healthStatus}
            {healthLatencyMs !== null && (
              <span className="hidden sm:inline"> ({healthLatencyMs}ms)</span>
            )}
          </Badge>
          <RefreshCw className="w-3 h-3 text-zinc-500 hover:text-zinc-300 transition-colors hidden xs:block" />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Environment Switcher */}
        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs">
          <span className="text-zinc-500 text-[10px] uppercase font-mono mr-1.5 hidden xs:inline">
            ENV
          </span>
          <select
            value={environment}
            onChange={handleEnvChange}
            className="bg-transparent text-zinc-200 font-mono text-xs focus:outline-hidden cursor-pointer"
          >
            <option value="PRODUCTION" className="bg-zinc-900 text-zinc-100">
              PROD
            </option>
            <option value="SANDBOX" className="bg-zinc-900 text-zinc-100">
              SANDBOX
            </option>
          </select>
        </div>

        {/* Tenant Name Badge */}
        <div className="hidden sm:flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs">
          <span className="text-zinc-500 text-[10px] uppercase font-mono">
            TENANT
          </span>
          <span className="font-semibold text-zinc-200">{tenantName}</span>
          <span className="text-zinc-500 font-mono text-[10px] ml-1 hidden lg:inline">
            {apiKey.slice(0, 8)}...
          </span>
        </div>

        {/* Enter as Demo Tenant / Active Badge */}
        {!isDemoKey ? (
          <button
            onClick={() => enterDemoTenant(environment)}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1 rounded border border-emerald-800/80 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 transition-colors"
            title="Switch to Demo Corp tenant"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Demo Corp</span>
          </button>
        ) : (
          <button
            onClick={() => enterDemoTenant(environment)}
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-2 sm:px-2.5 py-1 rounded transition-colors"
            title="Demo Corp Tenant Active"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden xs:inline">Demo</span>
          </button>
        )}
      </div>
    </header>
  );
}
