'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { EnvironmentType } from '../lib/types';

export const DEMO_PROD_API_KEY =
  'hr_live_demo_corp_00000000000000000000000000000000';
export const DEMO_TEST_API_KEY =
  'hr_test_demo_corp_00000000000000000000000000000000';

export type HealthState = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'CHECKING';

interface TenantContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
  environment: EnvironmentType;
  setEnvironment: (env: EnvironmentType) => void;
  tenantName: string;
  setTenantName: (name: string) => void;
  apiBaseUrl: string;
  healthStatus: HealthState;
  healthLatencyMs: number | null;
  isColdStart: boolean;
  enterDemoTenant: (targetEnv?: EnvironmentType) => void;
  apiFetch: <T = any>(path: string, options?: RequestInit) => Promise<T>;
  refreshHealth: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string>(DEMO_PROD_API_KEY);
  const [environment, setEnvironmentState] =
    useState<EnvironmentType>('PRODUCTION');
  const [tenantName, setTenantName] = useState<string>('Demo Corp');
  const [healthStatus, setHealthStatus] = useState<HealthState>('CHECKING');
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | null>(null);
  const [isColdStart, setIsColdStart] = useState<boolean>(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  // Hydrate credentials from localStorage on client mount
  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('hookrelay_api_key');
      const storedEnv = localStorage.getItem('hookrelay_env') as EnvironmentType;
      const storedTenant = localStorage.getItem('hookrelay_tenant_name');

      if (storedKey) setApiKeyState(storedKey);
      if (storedEnv && (storedEnv === 'PRODUCTION' || storedEnv === 'SANDBOX')) {
        setEnvironmentState(storedEnv);
      }
      if (storedTenant) setTenantName(storedTenant);
    } catch {
      // Storage access blocked or server-side render
    }
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    try {
      localStorage.setItem('hookrelay_api_key', key);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const setEnvironment = useCallback(
    (env: EnvironmentType) => {
      setEnvironmentState(env);
      // Auto-switch key to matching demo key if user is using demo keys
      if (apiKey === DEMO_PROD_API_KEY && env === 'SANDBOX') {
        setApiKey(DEMO_TEST_API_KEY);
      } else if (apiKey === DEMO_TEST_API_KEY && env === 'PRODUCTION') {
        setApiKey(DEMO_PROD_API_KEY);
      }
      try {
        localStorage.setItem('hookrelay_env', env);
      } catch {
        // Ignore storage errors
      }
    },
    [apiKey, setApiKey],
  );

  const enterDemoTenant = useCallback(
    (targetEnv: EnvironmentType = 'PRODUCTION') => {
      const keyToUse =
        targetEnv === 'PRODUCTION' ? DEMO_PROD_API_KEY : DEMO_TEST_API_KEY;
      setApiKeyState(keyToUse);
      setEnvironmentState(targetEnv);
      setTenantName('Demo Corp');
      try {
        localStorage.setItem('hookrelay_api_key', keyToUse);
        localStorage.setItem('hookrelay_env', targetEnv);
        localStorage.setItem('hookrelay_tenant_name', 'Demo Corp');
      } catch {
        // Ignore storage errors
      }
    },
    [],
  );

  const refreshHealth = useCallback(async () => {
    const start = performance.now();

    const tryProbe = async (url: string): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${url}/health`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(timeoutId);
        return res;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    };

    try {
      let res: Response;
      try {
        res = await tryProbe(apiBaseUrl);
      } catch (primaryErr) {
        if (apiBaseUrl.includes('localhost')) {
          const fallbackUrl = apiBaseUrl.replace('localhost', '127.0.0.1');
          res = await tryProbe(fallbackUrl);
        } else {
          throw primaryErr;
        }
      }

      const elapsed = Math.round(performance.now() - start);
      setHealthLatencyMs(elapsed);

      if (res.ok) {
        if (elapsed > 4000) {
          setIsColdStart(true);
          setHealthStatus('DEGRADED');
        } else {
          setIsColdStart(false);
          setHealthStatus('ONLINE');
        }
      } else {
        setHealthStatus('OFFLINE');
      }
    } catch {
      const elapsed = Math.round(performance.now() - start);
      setHealthLatencyMs(elapsed);
      setHealthStatus('OFFLINE');
      if (elapsed > 2800) {
        setIsColdStart(true);
      }
    }
  }, [apiBaseUrl]);

  // Adaptive polling: probe every 2.5s while OFFLINE/CHECKING, relax to 10s once ONLINE
  useEffect(() => {
    refreshHealth();
    const intervalMs = healthStatus === 'ONLINE' ? 10000 : 2500;
    const timer = setTimeout(() => {
      refreshHealth();
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [healthStatus, refreshHealth]);

  const apiFetch = useCallback(
    async <T = any>(path: string, options?: RequestInit): Promise<T> => {
      const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
      const headers = new Headers(options?.headers || {});

      if (!headers.has('Content-Type') && !(options?.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      if (apiKey) {
        headers.set('x-api-key', apiKey);
      }

      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (!res.ok) {
        let errorDetail = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const body = await res.json();
          errorDetail =
            body.message || body.error || JSON.stringify(body);
        } catch {
          // Non-JSON response
        }
        throw new Error(errorDetail);
      }

      // Check if response has content
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    },
    [apiBaseUrl, apiKey],
  );

  return (
    <TenantContext.Provider
      value={{
        apiKey,
        setApiKey,
        environment,
        setEnvironment,
        tenantName,
        setTenantName,
        apiBaseUrl,
        healthStatus,
        healthLatencyMs,
        isColdStart,
        enterDemoTenant,
        apiFetch,
        refreshHealth,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
