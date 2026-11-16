'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Radio,
  Plus,
  RefreshCw,
  RotateCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Check,
  Copy,
  ExternalLink,
  RefreshCcw,
  Trash2,
  Power,
  Send,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import {
  WebhookEndpoint,
  EventTopic,
  EndpointTopicSubscription,
  EnvironmentType,
} from '../../lib/types';

function checkClientSsrf(urlStr: string): {
  isBlocked: boolean;
  isWarning: boolean;
  message: string;
} {
  if (!urlStr.trim()) {
    return { isBlocked: false, isWarning: false, message: '' };
  }

  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        isBlocked: true,
        isWarning: false,
        message: 'Protocol must be http: or https:',
      };
    }

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    ) {
      return {
        isBlocked: false,
        isWarning: true,
        message:
          'Loopback / localhost allowed in Sandbox demo mode only. Blocked in Production.',
      };
    }

    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return {
        isBlocked: true,
        isWarning: false,
        message: 'RFC 1918 Private IP range blocked by Anti-SSRF policy.',
      };
    }

    if (hostname.startsWith('169.254.')) {
      return {
        isBlocked: true,
        isWarning: false,
        message: 'Cloud Metadata IP (169.254.x.x) blocked by Anti-SSRF policy.',
      };
    }

    return {
      isBlocked: false,
      isWarning: false,
      message: 'Valid public endpoint URL (DNS Pinning protected).',
    };
  } catch {
    return {
      isBlocked: true,
      isWarning: false,
      message: 'Malformed URL syntax.',
    };
  }
}

export default function EndpointsPage() {
  const { apiFetch, environment } = useTenant();

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [topics, setTopics] = useState<EventTopic[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Status Filter: 'ALL' | 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  const [circuitFilter, setCircuitFilter] = useState<string>('ALL');

  // New Endpoint Modal
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newUrl, setNewUrl] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newThreshold, setNewThreshold] = useState<number>(5);
  const [newEnvironments, setNewEnvironments] = useState<EnvironmentType[]>([
    'PRODUCTION',
    'SANDBOX',
  ]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createdEndpointSecret, setCreatedEndpointSecret] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);

  // Subscription Modal
  const [subModalEndpoint, setSubModalEndpoint] = useState<WebhookEndpoint | null>(null);
  const [subscriptions, setSubscriptions] = useState<EndpointTopicSubscription[]>([]);
  const [selectedTopicToSub, setSelectedTopicToSub] = useState<string>('');
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);

  // Reset Circuit State
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Toast Notification
  const [toast, setToast] = useState<{
    id: string;
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const ssrfCheck = checkClientSsrf(newUrl);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [endpointsData, topicsData] = await Promise.all([
        apiFetch<WebhookEndpoint[]>('/api/v1/endpoints'),
        apiFetch<EventTopic[]>('/api/v1/topics').catch(() => []),
      ]);
      setEndpoints(endpointsData || []);
      setTopics(topicsData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Circuit Reset
  const handleResetCircuit = async (endpointId: string) => {
    setResettingId(endpointId);
    try {
      await apiFetch(`/api/v1/endpoints/${endpointId}/reset-circuit`, {
        method: 'POST',
      });
      await loadData();
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Circuit Breaker Reset',
        message: 'Endpoint status reset to CLOSED and failure counter zeroed.',
      });
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Circuit Reset Failed',
        message: err.message,
      });
    } finally {
      setResettingId(null);
    }
  };

  // Toggle Endpoint Active Status
  const handleToggleActive = async (ep: WebhookEndpoint) => {
    try {
      await apiFetch(`/api/v1/endpoints/${ep.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !ep.is_active }),
      });
      await loadData();
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: ep.is_active ? 'Endpoint Deactivated' : 'Endpoint Activated',
        message: `Endpoint ${ep.url} is now ${ep.is_active ? 'disabled' : 'active'}.`,
      });
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Update Failed',
        message: err.message,
      });
    }
  };

  // Quick Ping Test (Schema-compliant test payload)
  const handleSendPing = async (_ep: WebhookEndpoint) => {
    try {
      await apiFetch('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify({
          topic: 'order.created',
          data: {
            order_id: `ord_ping_${Date.now().toString(36)}`,
            customer: {
              id: 'cust_ping',
              email: 'ping@hookrelay.dev',
            },
            amount: {
              total: 1000,
              currency: 'USD',
            },
          },
        }),
      });
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Ping Event Dispatched',
        message: 'Schema-compliant test order queued in Outbox. Check Delivery Inspector for dispatch logs.',
      });
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Ping Failed',
        message: err.message,
      });
    }
  };

  // Handle Create Endpoint
  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsSubmitting(true);

    try {
      const result = await apiFetch<WebhookEndpoint>('/api/v1/endpoints', {
        method: 'POST',
        body: JSON.stringify({
          url: newUrl.trim(),
          description: newDescription.trim() || undefined,
          failure_threshold: newThreshold,
          environments: newEnvironments,
        }),
      });

      if (result?.signing_secret) {
        setCreatedEndpointSecret(result.signing_secret);
      } else {
        setIsCreateOpen(false);
      }
      await loadData();
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Endpoint Created',
        message: 'Destination registered with DNS Pinning protection and HMAC signing secret.',
      });
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Subscriptions Modal
  const handleOpenSubscriptions = async (endpoint: WebhookEndpoint) => {
    setSubModalEndpoint(endpoint);
    try {
      const subs = await apiFetch<EndpointTopicSubscription[]>(
        `/api/v1/endpoints/${endpoint.id}/subscriptions`,
      );
      setSubscriptions(subs || []);
    } catch {
      setSubscriptions([]);
    }
  };

  // Add Subscription
  const handleAddSubscription = async () => {
    if (!subModalEndpoint || !selectedTopicToSub) return;
    setIsSubscribing(true);
    try {
      await apiFetch(
        `/api/v1/endpoints/${subModalEndpoint.id}/subscriptions`,
        {
          method: 'POST',
          body: JSON.stringify({
            topic_id: selectedTopicToSub,
            environment,
          }),
        },
      );
      const subs = await apiFetch<EndpointTopicSubscription[]>(
        `/api/v1/endpoints/${subModalEndpoint.id}/subscriptions`,
      );
      setSubscriptions(subs || []);
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Subscription Added',
        message: 'Endpoint subscribed to topic dispatches.',
      });
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Failed to subscribe',
        message: err.message,
      });
    } finally {
      setIsSubscribing(false);
    }
  };

  // Remove Subscription
  const handleRemoveSubscription = async (topicId: string) => {
    if (!subModalEndpoint) return;
    try {
      await apiFetch(
        `/api/v1/endpoints/${subModalEndpoint.id}/subscriptions/${topicId}`,
        {
          method: 'DELETE',
        },
      );
      setSubscriptions(subscriptions.filter((s) => s.topic_id !== topicId));
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Subscription Removed',
        message: 'Endpoint unsubscribed from topic.',
      });
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Failed to unsubscribe',
        message: err.message,
      });
    }
  };

  // Filter endpoints by selected global environment
  const visibleEndpoints = endpoints.filter((ep) => {
    const matchesEnv =
      !ep.endpoint_environments || ep.endpoint_environments.length === 0
        ? true
        : ep.endpoint_environments.some((e) => e.environment === environment);

    if (!matchesEnv) return false;

    if (circuitFilter === 'ALL') return true;
    return ep.circuit_status === circuitFilter;
  });

  // Summary Metrics based on current environment
  const envEndpoints = endpoints.filter((ep) =>
    !ep.endpoint_environments || ep.endpoint_environments.length === 0
      ? true
      : ep.endpoint_environments.some((e) => e.environment === environment),
  );
  const totalCount = envEndpoints.length;
  const closedCount = envEndpoints.filter((e) => e.circuit_status === 'CLOSED').length;
  const openCount = envEndpoints.filter((e) => e.circuit_status === 'OPEN').length;
  const halfOpenCount = envEndpoints.filter((e) => e.circuit_status === 'HALF_OPEN').length;

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-5 sm:top-5 z-50 sm:max-w-md w-auto animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`p-3.5 rounded-lg border shadow-2xl backdrop-blur-md flex items-start gap-3 ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700/80 text-emerald-200'
                : toast.type === 'warning'
                  ? 'bg-amber-950/90 border-amber-700/80 text-amber-200'
                  : 'bg-rose-950/90 border-rose-700/80 text-rose-200'
            }`}
          >
            {toast.type === 'success' && (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'warning' && (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}

            <div className="flex-1 text-xs space-y-1">
              <strong className="font-semibold block">{toast.title}</strong>
              <p className="text-zinc-300 font-sans leading-relaxed text-[11px]">
                {toast.message}
              </p>
            </div>

            <button
              onClick={() => setToast(null)}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
              Topology & Health
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              Filtered by: <strong className="text-zinc-300">{environment}</strong>
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 mt-1 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>Webhook Endpoints & Circuit Health</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 max-w-3xl">
            Manage destination webhook receptors, circuit breaker thresholds, and real-time SSRF defenses.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-zinc-100 text-xs font-mono transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              setNewUrl('');
              setNewDescription('');
              setCreatedEndpointSecret(null);
              setCreateError(null);
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Endpoint</span>
          </button>
        </div>
      </div>

      {/* Compact Interactive Pill Bar (Replaces bulky cards) */}
      <div className="flex flex-wrap items-center gap-2 bg-[#0e1015] p-2.5 rounded-lg border border-zinc-800 text-xs font-mono">
        <span className="text-[10px] uppercase text-zinc-500 mr-2">Filter Circuits:</span>
        <button
          onClick={() => setCircuitFilter('ALL')}
          className={`px-2.5 py-1 rounded border transition-colors ${
            circuitFilter === 'ALL'
              ? 'border-zinc-500 bg-zinc-800 text-zinc-100 font-semibold'
              : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          All ({totalCount})
        </button>
        <button
          onClick={() => setCircuitFilter('CLOSED')}
          className={`px-2.5 py-1 rounded border transition-colors ${
            circuitFilter === 'CLOSED'
              ? 'border-emerald-700 bg-emerald-950/70 text-emerald-300 font-semibold'
              : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Healthy / Closed ({closedCount})
        </button>
        <button
          onClick={() => setCircuitFilter('OPEN')}
          className={`px-2.5 py-1 rounded border transition-colors ${
            circuitFilter === 'OPEN'
              ? 'border-rose-700 bg-rose-950/70 text-rose-300 font-semibold'
              : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Tripped / Open ({openCount})
        </button>
        {halfOpenCount > 0 && (
          <button
            onClick={() => setCircuitFilter('HALF_OPEN')}
            className={`px-2.5 py-1 rounded border transition-colors ${
              circuitFilter === 'HALF_OPEN'
                ? 'border-amber-700 bg-amber-950/70 text-amber-300 font-semibold'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Probing ({halfOpenCount})
          </button>
        )}
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-3 border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs font-mono rounded">
          {error}
        </div>
      )}

      {/* Endpoints Table */}
      <div className="rounded-lg border border-zinc-800 bg-[#0e1015] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-400 tracking-wider">
              <tr>
                <th className="py-2.5 px-4">Endpoint Destination</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Circuit Health</th>
                <th className="py-2.5 px-4">Failures / Threshold</th>
                <th className="py-2.5 px-4">Environments</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-sans">
              {visibleEndpoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-12 text-center text-zinc-500 font-mono text-xs"
                  >
                    {isLoading
                      ? 'Loading endpoints from database...'
                      : `No webhook endpoints found for environment: ${environment}.`}
                  </td>
                </tr>
              ) : (
                visibleEndpoints.map((ep) => {
                  const isTripped = ep.circuit_status === 'OPEN';
                  const isResetting = resettingId === ep.id;

                  return (
                    <tr
                      key={ep.id}
                      className="hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono">
                        <div className="text-zinc-200 font-medium break-all flex items-center gap-2">
                          <span>{ep.url}</span>
                          {!ep.is_active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                              PAUSED
                            </span>
                          )}
                        </div>
                        {ep.description && (
                          <div className="text-[11px] text-zinc-500 font-sans mt-0.5">
                            {ep.description}
                          </div>
                        )}
                        <div className="text-[10px] text-zinc-600 font-mono mt-0.5">
                          ep_{ep.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <button
                          onClick={() => handleToggleActive(ep)}
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                            ep.is_active
                              ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300 hover:bg-emerald-900/60'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                          }`}
                          title={ep.is_active ? 'Click to Pause' : 'Click to Activate'}
                        >
                          <Power className="w-3 h-3" />
                          <span>{ep.is_active ? 'ACTIVE' : 'PAUSED'}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <Badge statusText={ep.circuit_status}>
                          {ep.circuit_status === 'CLOSED'
                            ? 'CLOSED (HEALTHY)'
                            : ep.circuit_status === 'OPEN'
                              ? 'OPEN (TRIPPED)'
                              : 'HALF_OPEN'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        <span
                          className={
                            ep.consecutive_failures > 0
                              ? ep.consecutive_failures >= ep.failure_threshold
                                ? 'text-rose-400 font-bold'
                                : 'text-amber-400 font-semibold'
                              : 'text-zinc-400'
                          }
                        >
                          {ep.consecutive_failures}
                        </span>
                        <span className="text-zinc-600"> / </span>
                        <span className="text-zinc-400">
                          {ep.failure_threshold}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="flex flex-wrap gap-1">
                          {ep.endpoint_environments &&
                          ep.endpoint_environments.length > 0 ? (
                            ep.endpoint_environments.map((env) => (
                              <span
                                key={env.environment}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300"
                              >
                                {env.environment}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-zinc-600">
                              ALL
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleSendPing(ep)}
                            className="px-2 py-1 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono transition-colors flex items-center gap-1"
                            title="Dispatch test event ping"
                          >
                            <Send className="w-3 h-3" />
                            <span>Ping</span>
                          </button>
                          <button
                            onClick={() => handleOpenSubscriptions(ep)}
                            className="px-2 py-1 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono transition-colors"
                            title="Manage Topic Subscriptions"
                          >
                            Subscriptions
                          </button>
                          {isTripped && (
                            <button
                              onClick={() => handleResetCircuit(ep.id)}
                              disabled={isResetting}
                              className="flex items-center gap-1 px-2 py-1 rounded border border-amber-800/80 bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 text-xs font-mono transition-colors"
                              title="Reset Circuit to CLOSED"
                            >
                              <RefreshCcw
                                className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`}
                              />
                              <span>Reset</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800 text-[11px] font-mono text-zinc-500 flex justify-between items-center">
          <span>Showing {visibleEndpoints.length} registered endpoints</span>
          <span>Environment: {environment}</span>
        </div>
      </div>

      {/* New Endpoint Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Register Webhook Endpoint"
        description="Configure a new receptor URL with HMAC signing secret and failure tolerance."
      >
        {createdEndpointSecret ? (
          <div className="space-y-4">
            <div className="p-4 rounded border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Endpoint Created Successfully</span>
              </div>
              <p className="text-xs text-zinc-300">
                Save the HMAC signing secret below. HookRelay signs every webhook with HMAC-SHA256 using this secret in the{' '}
                <code className="text-zinc-100 font-mono">
                  X-HookRelay-Signature
                </code>{' '}
                header.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                HMAC SIGNING SECRET
              </label>
              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                <input
                  type="text"
                  readOnly
                  value={createdEndpointSecret}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-emerald-400 select-all"
                />
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(createdEndpointSecret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="px-3 py-2 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-mono text-zinc-200 transition-colors flex items-center gap-1.5"
                >
                  {copiedSecret ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded bg-zinc-100 hover:bg-white text-xs font-semibold text-zinc-950 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateEndpoint} className="space-y-4">
            {createError && (
              <div className="p-3 border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs font-mono rounded">
                {createError}
              </div>
            )}

            {/* URL Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                RECEPTOR URL *
              </label>
              <input
                type="url"
                required
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://api.yourcompany.com/webhooks"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              />

              {/* Live SSRF Validation Feedback */}
              {newUrl.trim() && (
                <div
                  className={`text-[11px] font-mono p-2 rounded border flex items-start gap-1.5 ${
                    ssrfCheck.isWarning
                      ? 'border-amber-800/80 bg-amber-950/30 text-amber-300'
                      : ssrfCheck.isBlocked
                        ? 'border-rose-800/80 bg-rose-950/30 text-rose-300'
                        : 'border-emerald-800/80 bg-emerald-950/30 text-emerald-300'
                  }`}
                >
                  {ssrfCheck.isBlocked ? (
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                  ) : ssrfCheck.isWarning ? (
                    <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                  )}
                  <span>{ssrfCheck.message}</span>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                DESCRIPTION (OPTIONAL)
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g. Primary Payment Webhook Sink"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              />
            </div>

            {/* Threshold */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                CIRCUIT BREAKER FAILURE THRESHOLD: {newThreshold}
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={newThreshold}
                onChange={(e) => setNewThreshold(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <p className="text-[11px] text-zinc-500 font-sans">
                Number of consecutive failed dispatches before circuit transitions to OPEN.
              </p>
            </div>

            {/* Environments Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                ENVIRONMENTS
              </label>
              <div className="flex gap-4">
                {(['PRODUCTION', 'SANDBOX'] as EnvironmentType[]).map((env) => (
                  <label
                    key={env}
                    className="flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={newEnvironments.includes(env)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewEnvironments([...newEnvironments, env]);
                        } else {
                          setNewEnvironments(newEnvironments.filter((x) => x !== env));
                        }
                      }}
                      className="rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-0"
                    />
                    <span>{env}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-3 py-1.5 rounded border border-zinc-800 hover:bg-zinc-900 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || ssrfCheck.isBlocked}
                className="px-3 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Registering...' : 'Create Endpoint'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Subscriptions Management Modal */}
      <Modal
        isOpen={!!subModalEndpoint}
        onClose={() => setSubModalEndpoint(null)}
        title="Manage Topic Subscriptions"
        description={
          subModalEndpoint ? `Endpoint: ${subModalEndpoint.url}` : ''
        }
      >
        <div className="space-y-4">
          {/* Add Subscription Form */}
          <div className="flex gap-2">
            <select
              value={selectedTopicToSub}
              onChange={(e) => setSelectedTopicToSub(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden"
            >
              <option value="">Select a topic to subscribe...</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleAddSubscription}
              disabled={isSubscribing || !selectedTopicToSub}
              className="px-3 py-2 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {isSubscribing ? 'Subscribing...' : 'Subscribe'}
            </button>
          </div>

          {/* Subscribed Topics List */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-mono text-zinc-500">
              Active Subscriptions ({subscriptions.length})
            </span>
            {subscriptions.length === 0 ? (
              <div className="p-4 rounded border border-dashed border-zinc-800 text-center text-xs font-mono text-zinc-500">
                No active topic subscriptions. This endpoint will not receive events.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {subscriptions.map((sub) => (
                  <div
                    key={sub.topic_id}
                    className="flex items-center justify-between p-2.5 rounded border border-zinc-800 bg-zinc-950 text-xs font-mono"
                  >
                    <span className="text-zinc-200">
                      {sub.event_topics?.name || sub.topic_id}
                    </span>
                    <button
                      onClick={() => handleRemoveSubscription(sub.topic_id)}
                      className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-900 transition-colors"
                      title="Unsubscribe topic"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
