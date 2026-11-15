'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Radio,
  Plus,
  RotateCw,
  RefreshCcw,
  Check,
  AlertCircle,
  Copy,
  Trash2,
  BookmarkCheck,
  Shield,
  Layers,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import {
  WebhookEndpoint,
  EventTopic,
  EnvironmentType,
  EndpointTopicSubscription,
} from '../../lib/types';

// Client-side SSRF heuristic check to provide instant feedback before submitting
function checkClientSsrf(urlStr: string): { isWarning: boolean; message: string } {
  if (!urlStr.trim()) {
    return { isWarning: false, message: '' };
  }

  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return {
        isWarning: true,
        message:
          'Localhost or loopback addresses are blocked by SSRF defense in PRODUCTION (permitted only in DEV test sinks).',
      };
    }

    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return {
        isWarning: true,
        message:
          'Private IP ranges and cloud metadata services are strictly blocked by SSRF defense.',
      };
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return {
        isWarning: true,
        message: 'Only HTTP and HTTPS protocols are accepted.',
      };
    }

    return {
      isWarning: false,
      message: 'Valid public URL format. Passes SSRF heuristics.',
    };
  } catch {
    return {
      isWarning: true,
      message: 'Invalid URL format (must include protocol, e.g. https://...)',
    };
  }
}

export default function EndpointsPage() {
  const { apiFetch, environment } = useTenant();

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [topics, setTopics] = useState<EventTopic[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      alert(`Failed to reset circuit: ${err.message}`);
    } finally {
      setResettingId(null);
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
          failureThreshold: newThreshold,
          environments: newEnvironments,
        }),
      });

      if (result.signing_secret) {
        setCreatedEndpointSecret(result.signing_secret);
      }
      await loadData();
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
      if (topics.length > 0) {
        setSelectedTopicToSub(topics[0].id);
      }
    } catch (err: any) {
      alert(`Failed to load subscriptions: ${err.message}`);
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
            topicId: selectedTopicToSub,
            environment,
          }),
        },
      );
      const subs = await apiFetch<EndpointTopicSubscription[]>(
        `/api/v1/endpoints/${subModalEndpoint.id}/subscriptions`,
      );
      setSubscriptions(subs || []);
    } catch (err: any) {
      alert(`Failed to subscribe: ${err.message}`);
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
    } catch (err: any) {
      alert(`Failed to unsubscribe: ${err.message}`);
    }
  };

  // Summary Metrics
  const totalCount = endpoints.length;
  const closedCount = endpoints.filter((e) => e.circuit_status === 'CLOSED').length;
  const openCount = endpoints.filter((e) => e.circuit_status === 'OPEN').length;
  const halfOpenCount = endpoints.filter((e) => e.circuit_status === 'HALF_OPEN').length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>Webhook Endpoints & Circuit Health</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Manage webhook receptors, circuit breaker thresholds, and real-time
            SSRF defense status.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Endpoint</span>
          </button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="border border-zinc-800 rounded bg-[#0e0e11] p-4 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">
            TOTAL ENDPOINTS
          </span>
          <p className="text-xl font-mono font-bold text-zinc-100">{totalCount}</p>
        </div>
        <div className="border border-zinc-800 rounded bg-[#0e0e11] p-4 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">
            HEALTHY (CLOSED)
          </span>
          <p className="text-xl font-mono font-bold text-emerald-400">
            {closedCount}
          </p>
        </div>
        <div className="border border-zinc-800 rounded bg-[#0e0e11] p-4 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">
            TRIPPED (OPEN)
          </span>
          <p className="text-xl font-mono font-bold text-rose-400">
            {openCount}
          </p>
        </div>
        <div className="border border-zinc-800 rounded bg-[#0e0e11] p-4 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">
            PROBING (HALF-OPEN)
          </span>
          <p className="text-xl font-mono font-bold text-amber-400">
            {halfOpenCount}
          </p>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-3 border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs font-mono rounded">
          {error}
        </div>
      )}

      {/* Endpoints Table */}
      <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-500 tracking-wider">
              <tr>
                <th className="py-3 px-4">Endpoint URL</th>
                <th className="py-3 px-4">Circuit Status</th>
                <th className="py-3 px-4">Failures / Threshold</th>
                <th className="py-3 px-4">Environments</th>
                <th className="py-3 px-4">Created At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {endpoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-12 text-center text-zinc-500 font-mono text-xs"
                  >
                    {isLoading
                      ? 'Loading endpoints from database...'
                      : 'No webhook endpoints registered. Click "New Endpoint" to configure a receptor.'}
                  </td>
                </tr>
              ) : (
                endpoints.map((ep) => {
                  const isTripped = ep.circuit_status === 'OPEN';
                  const isResetting = resettingId === ep.id;

                  return (
                    <tr
                      key={ep.id}
                      className="hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono">
                        <div className="text-zinc-200 font-medium break-all">
                          {ep.url}
                        </div>
                        {ep.description && (
                          <div className="text-[11px] text-zinc-500 font-sans mt-0.5">
                            {ep.description}
                          </div>
                        )}
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          ID: {ep.id}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge statusText={ep.circuit_status}>
                          {ep.circuit_status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-mono">
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
                      <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">
                        {new Date(ep.created_at).toLocaleDateString()}{' '}
                        {new Date(ep.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
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
                Save the HMAC signing secret below. HookRelay signs every
                webhook with HMAC-SHA256 using this secret in the{' '}
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
              <div className="flex items-center gap-2">
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
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 transition-colors"
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
                      : 'border-emerald-800/80 bg-emerald-950/30 text-emerald-300'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
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
                placeholder="e.g. Production Billing Receptor"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              />
            </div>

            {/* Failure Threshold */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-mono text-zinc-400">
                  CIRCUIT BREAKER FAILURE THRESHOLD: {newThreshold}
                </label>
                <span className="text-[10px] text-zinc-500 font-mono">
                  1 - 50 attempts
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                value={newThreshold}
                onChange={(e) => setNewThreshold(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Environments */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                ACTIVE ENVIRONMENTS
              </label>
              <div className="flex gap-4 text-xs font-mono">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEnvironments.includes('PRODUCTION')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewEnvironments([...newEnvironments, 'PRODUCTION']);
                      } else {
                        setNewEnvironments(
                          newEnvironments.filter((env) => env !== 'PRODUCTION'),
                        );
                      }
                    }}
                    className="accent-emerald-500"
                  />
                  <span>PRODUCTION</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEnvironments.includes('SANDBOX')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewEnvironments([...newEnvironments, 'SANDBOX']);
                      } else {
                        setNewEnvironments(
                          newEnvironments.filter((env) => env !== 'SANDBOX'),
                        );
                      }
                    }}
                    className="accent-emerald-500"
                  />
                  <span>SANDBOX</span>
                </label>
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newUrl.trim()}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Registering...' : 'Register Endpoint'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Topic Subscriptions Modal */}
      <Modal
        isOpen={!!subModalEndpoint}
        onClose={() => setSubModalEndpoint(null)}
        title="Topic Subscriptions"
        description={subModalEndpoint ? `Receptor: ${subModalEndpoint.url}` : ''}
      >
        <div className="space-y-4">
          {/* Subscribe New Topic */}
          <div className="p-3 border border-zinc-800 rounded bg-zinc-950 space-y-2">
            <span className="text-[10px] uppercase font-mono text-zinc-400">
              Subscribe to Topic
            </span>
            <div className="flex gap-2">
              <select
                value={selectedTopicToSub}
                onChange={(e) => setSelectedTopicToSub(e.target.value)}
                className="flex-1 bg-[#0c0c0e] border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200"
              >
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddSubscription}
                disabled={isSubscribing || !selectedTopicToSub}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-100 transition-colors"
              >
                {isSubscribing ? 'Subscribing...' : 'Subscribe'}
              </button>
            </div>
          </div>

          {/* Subscriptions List */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-mono text-zinc-500">
              Active Subscriptions ({subscriptions.length})
            </span>
            <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded bg-[#0c0c0e]">
              {subscriptions.length === 0 ? (
                <div className="p-4 text-center text-zinc-600 text-xs font-mono">
                  No topics subscribed yet.
                </div>
              ) : (
                subscriptions.map((sub) => (
                  <div
                    key={sub.topic_id}
                    className="p-3 flex items-center justify-between text-xs font-mono"
                  >
                    <div>
                      <div className="text-zinc-200 font-semibold">
                        {sub.event_topics?.name || sub.topic_id}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Subscribed:{' '}
                        {new Date(sub.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveSubscription(sub.topic_id)}
                      className="text-zinc-500 hover:text-rose-400 p-1 rounded transition-colors"
                      title="Unsubscribe topic"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
