'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ListTree,
  RotateCw,
  Search,
  RefreshCw,
  Play,
  Clock,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../../components/ui/badge';
import { Drawer } from '../../components/ui/drawer';
import { CodeBlock } from '../../components/ui/code-block';
import { Delivery, DeliveryAttempt, DeliveryStatus } from '../../lib/types';

export default function DeliveriesPage() {
  const { apiFetch } = useTenant();

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [selectedDeliveryDetail, setSelectedDeliveryDetail] =
    useState<Delivery | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySuccessMsg, setReplaySuccessMsg] = useState<string | null>(null);

  // Inspection Drawer Tabs
  const [activeTab, setActiveTab] = useState<
    'headers' | 'signed_body' | 'response' | 'error'
  >('headers');
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState<number>(0);

  const loadDeliveries = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      if (searchQuery.trim()) {
        params.set('correlationId', searchQuery.trim());
      }

      const res = await apiFetch<{
        items: Delivery[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/v1/deliveries?${params.toString()}`);

      setDeliveries(res.items || []);
      setTotalCount(res.total || 0);
    } catch {
      // Error handling
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, statusFilter, searchQuery]);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  // Load detailed delivery when opened
  const handleSelectDelivery = async (delivery: Delivery) => {
    setSelectedDelivery(delivery);
    setIsLoadingDetail(true);
    setReplaySuccessMsg(null);
    try {
      const detail = await apiFetch<Delivery>(
        `/api/v1/deliveries/${delivery.id}`,
      );
      setSelectedDeliveryDetail(detail);
      if (detail.delivery_attempts && detail.delivery_attempts.length > 0) {
        setSelectedAttemptIndex(detail.delivery_attempts.length - 1);
      }
    } catch {
      setSelectedDeliveryDetail(delivery);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Handle Manual Replay
  const handleReplay = async () => {
    if (!selectedDelivery) return;
    setIsReplaying(true);
    setReplaySuccessMsg(null);
    try {
      await apiFetch(`/api/v1/deliveries/${selectedDelivery.id}/replay`, {
        method: 'POST',
      });
      setReplaySuccessMsg('Replay scheduled in high-priority delivery queue');
      // Refresh current details
      const updated = await apiFetch<Delivery>(
        `/api/v1/deliveries/${selectedDelivery.id}`,
      );
      setSelectedDeliveryDetail(updated);
      await loadDeliveries();
    } catch (err: any) {
      alert(`Failed to replay delivery: ${err.message}`);
    } finally {
      setIsReplaying(false);
    }
  };

  const attempts: DeliveryAttempt[] =
    selectedDeliveryDetail?.delivery_attempts || [];
  const currentAttempt = attempts[selectedAttemptIndex] || attempts[0];

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <ListTree className="w-4 h-4 text-emerald-400" />
            <span>Delivery Inspector & Audit Trail</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Trace end-to-end webhook dispatches, inspect HTTP request/response
            signatures, and trigger manual re-enqueues.
          </p>
        </div>
        <button
          onClick={() => loadDeliveries()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-zinc-100 text-xs font-mono transition-colors self-start sm:self-auto"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between bg-[#0e0e11] p-3 rounded-lg border border-zinc-800">
        {/* Status Filter Chips */}
        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          {['ALL', 'DELIVERED', 'RETRYING', 'DEAD_LETTER', 'PENDING'].map(
            (status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${
                  statusFilter === status
                    ? 'border-zinc-600 bg-zinc-800 text-zinc-100 font-semibold'
                    : 'border-zinc-800/80 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {status}
              </button>
            ),
          )}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDeliveries()}
            placeholder="Search by correlation ID or event ID..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded pl-8 pr-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
          />
        </div>
      </div>

      {/* Deliveries Table */}
      <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-500 tracking-wider">
              <tr>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Correlation ID / Event</th>
                <th className="py-3 px-4">Endpoint Receptor</th>
                <th className="py-3 px-4">Attempts</th>
                <th className="py-3 px-4">Latency</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {deliveries.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-zinc-500 font-mono text-xs"
                  >
                    {isLoading
                      ? 'Loading deliveries from database...'
                      : 'No deliveries found matching active filter. Trigger events in Demo Sandbox.'}
                  </td>
                </tr>
              ) : (
                deliveries.map((delivery) => {
                  const latestAttempt = delivery.delivery_attempts?.[0];

                  return (
                    <tr
                      key={delivery.id}
                      onClick={() => handleSelectDelivery(delivery)}
                      className="hover:bg-zinc-900/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <Badge statusText={delivery.status}>
                          {delivery.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="text-zinc-200 font-medium truncate max-w-xs">
                          {delivery.events?.correlation_id || delivery.event_id}
                        </div>
                        <div className="text-[10px] text-zinc-500 truncate max-w-xs">
                          Event: {delivery.events?.id || delivery.event_id}
                        </div>
                        {delivery.events?.event_topics?.name && (
                          <span className="text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.2 rounded mt-0.5 inline-block">
                            {delivery.events.event_topics.name}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="text-zinc-300 truncate max-w-sm">
                          {delivery.webhook_endpoints?.url || delivery.endpoint_id}
                        </div>
                        {delivery.webhook_endpoints?.circuit_status && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            Circuit:{' '}
                            <span
                              className={
                                delivery.webhook_endpoints.circuit_status ===
                                'CLOSED'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }
                            >
                              {delivery.webhook_endpoints.circuit_status}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        <span
                          className={
                            delivery.attempt_count > 0 &&
                            delivery.status !== 'DELIVERED'
                              ? 'text-amber-400'
                              : 'text-zinc-200'
                          }
                        >
                          {delivery.attempt_count}
                        </span>
                        <span className="text-zinc-600"> / </span>
                        <span className="text-zinc-500">
                          {delivery.max_attempts}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        {latestAttempt ? (
                          <span
                            className={
                              latestAttempt.latency_ms > 2000
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }
                          >
                            {latestAttempt.latency_ms}ms
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">
                        {new Date(delivery.created_at).toLocaleTimeString()}{' '}
                        <span className="text-zinc-600">
                          ({new Date(delivery.created_at).toLocaleDateString()})
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <ChevronRight className="w-4 h-4 text-zinc-600 ml-auto" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspection Drawer */}
      <Drawer
        isOpen={!!selectedDelivery}
        onClose={() => {
          setSelectedDelivery(null);
          setSelectedDeliveryDetail(null);
        }}
        title="Delivery Inspector"
        subtitle={
          selectedDeliveryDetail?.id ? `ID: ${selectedDeliveryDetail.id}` : ''
        }
      >
        {selectedDeliveryDetail && (
          <div className="space-y-6">
            {/* Top Action & Status Bar */}
            <div className="flex items-center justify-between p-4 rounded border border-zinc-800 bg-[#09090b]">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-mono text-zinc-500">
                  Current Status
                </span>
                <div>
                  <Badge
                    statusText={selectedDeliveryDetail.status}
                    size="md"
                  >
                    {selectedDeliveryDetail.status}
                  </Badge>
                </div>
              </div>

              {/* Replay Delivery Button */}
              <button
                onClick={handleReplay}
                disabled={isReplaying}
                className="flex items-center gap-1.5 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-mono font-semibold transition-colors disabled:opacity-50 border border-zinc-700"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isReplaying ? 'animate-spin' : ''}`}
                />
                <span>{isReplaying ? 'Replaying...' : 'Replay Delivery'}</span>
              </button>
            </div>

            {replaySuccessMsg && (
              <div className="p-3 border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 text-xs font-mono rounded">
                {replaySuccessMsg}
              </div>
            )}

            {/* Overview Metadata Cards */}
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="border border-zinc-800 rounded bg-[#0c0c0e] p-3 space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase">
                  Event ID
                </span>
                <p className="text-zinc-200 break-all select-all">
                  {selectedDeliveryDetail.events?.id ||
                    selectedDeliveryDetail.event_id}
                </p>
              </div>
              <div className="border border-zinc-800 rounded bg-[#0c0c0e] p-3 space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase">
                  Correlation ID
                </span>
                <p className="text-zinc-200 break-all select-all">
                  {selectedDeliveryDetail.events?.correlation_id || 'N/A'}
                </p>
              </div>
              <div className="border border-zinc-800 rounded bg-[#0c0c0e] p-3 space-y-1 col-span-2">
                <span className="text-[10px] text-zinc-500 uppercase">
                  Endpoint URL
                </span>
                <p className="text-zinc-200 break-all">
                  {selectedDeliveryDetail.webhook_endpoints?.url ||
                    selectedDeliveryDetail.endpoint_id}
                </p>
              </div>
            </div>

            {/* Attempts Timeline */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase text-zinc-400">
                Attempt History ({attempts.length} recorded)
              </span>

              {attempts.length === 0 ? (
                <div className="p-4 border border-zinc-800/80 rounded bg-[#0c0c0e] text-center text-xs font-mono text-zinc-500">
                  No dispatch attempts recorded yet.
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {attempts.map((att, idx) => (
                    <button
                      key={att.id}
                      onClick={() => setSelectedAttemptIndex(idx)}
                      className={`flex flex-col items-start p-2.5 rounded border text-xs font-mono transition-all shrink-0 min-w-[120px] ${
                        selectedAttemptIndex === idx
                          ? 'border-zinc-500 bg-zinc-800 text-zinc-100 ring-1 ring-zinc-400'
                          : 'border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold">Attempt {att.attempt_number}</span>
                        {att.is_success ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between w-full text-[11px]">
                        <span
                          className={
                            att.http_status && att.http_status < 400
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          HTTP {att.http_status ?? 'ERR'}
                        </span>
                        <span className="text-zinc-500">{att.latency_ms}ms</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Inspection Tabs */}
            {currentAttempt && (
              <div className="space-y-3">
                <div className="flex border-b border-zinc-800 text-xs font-mono">
                  {[
                    { key: 'headers', label: 'Request Headers' },
                    { key: 'signed_body', label: 'Signed Body' },
                    { key: 'response', label: 'Response Body' },
                    { key: 'error', label: 'Error Details' },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key as any)}
                      className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                        activeTab === tab.key
                          ? 'border-zinc-100 text-zinc-100'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'headers' && (
                  <CodeBlock
                    code={currentAttempt.request_headers || {}}
                    language="json"
                  />
                )}

                {activeTab === 'signed_body' && (
                  <CodeBlock
                    code={
                      selectedDeliveryDetail.events?.payload || {
                        note: 'Payload archived or unavailable',
                      }
                    }
                    language="json"
                  />
                )}

                {activeTab === 'response' && (
                  <CodeBlock
                    code={
                      currentAttempt.response_body || '(Empty Response Body)'
                    }
                    language="text"
                  />
                )}

                {activeTab === 'error' && (
                  <div className="p-3 border border-zinc-800 rounded bg-[#0c0c0e] font-mono text-xs text-zinc-300 space-y-2">
                    <div>
                      Error Code:{' '}
                      <span className="text-rose-400 font-bold">
                        {currentAttempt.error_code || 'NONE'}
                      </span>
                    </div>
                    <div>
                      HTTP Status:{' '}
                      <span className="text-zinc-100">
                        {currentAttempt.http_status || 'Connection Refused / Timeout'}
                      </span>
                    </div>
                    <div>
                      Latency:{' '}
                      <span className="text-zinc-100">
                        {currentAttempt.latency_ms}ms
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
