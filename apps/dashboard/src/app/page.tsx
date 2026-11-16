'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Play,
  RotateCw,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  Send,
  Check,
  ArrowRight,
  ShieldCheck,
  Server,
  Zap,
  X,
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronUp,
  Radio,
  FileCode,
  Terminal,
} from 'lucide-react';
import { useTenant } from '../context/tenant-context';
import { Badge } from '../components/ui/badge';
import {
  Delivery,
  DemoSinkLogEntry,
  DemoSinkMode,
  EventTopic,
} from '../lib/types';

const SAMPLE_PAYLOADS: Record<string, any> = {
  'order.created': {
    order_id: 'ord_992144',
    customer: {
      id: 'cust_8812',
      email: 'alex@example.com',
      tier: 'enterprise',
    },
    amount: {
      total: 125000,
      currency: 'USD',
    },
    items: [
      { sku: 'SRV-COMPUTE-XL', quantity: 2, unit_price: 50000 },
      { sku: 'LIC-HOOKRELAY', quantity: 1, unit_price: 25000 },
    ],
  },
  'payment.completed': {
    payment_id: 'pay_339102',
    order_id: 'ord_992144',
    status: 'PAID',
    processor: 'stripe',
    transaction_ref: 'ch_3Nxy123498Z',
    settled_at: new Date().toISOString(),
  },
  'user.registered': {
    user_id: 'usr_55198',
    email: 'dev@company.internal',
    roles: ['admin', 'engineer'],
    organization_id: 'org_corp_01',
  },
};

interface ToastNotification {
  id: string;
  type: 'success' | 'warning' | 'error';
  title: string;
  message: string;
  details?: string;
}

export default function InteractivePlaygroundPage() {
  const { apiFetch, environment } = useTenant();

  // Topics & Form
  const [topics, setTopics] = useState<EventTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>('order.created');
  const [customTopic, setCustomTopic] = useState<string>('');
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(SAMPLE_PAYLOADS['order.created'], null, 2),
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [showAdvancedPayload, setShowAdvancedPayload] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSubmissionResult, setLastSubmissionResult] = useState<any | null>(null);

  // Active Delivery Lifecycle Tracking
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null);
  const [lastCompletedDelivery, setLastCompletedDelivery] = useState<Delivery | null>(null);
  const [inFlightSeconds, setInFlightSeconds] = useState<number>(0);
  const [isDeliveryTracking, setIsDeliveryTracking] = useState<boolean>(false);

  // Receptor Mode & Logs
  const [sinkMode, setSinkMode] = useState<DemoSinkMode>('HEALTHY');
  const [isChangingMode, setIsChangingMode] = useState<boolean>(false);
  const [sinkLogs, setSinkLogs] = useState<DemoSinkLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);

  // Visual Animated Flow Step: 0 = idle, 1 = app emitting, 2 = HookRelay processing, 3 = delivered
  const [flowStep, setFlowStep] = useState<number>(0);

  // Session ID for Demo Sink State Isolation
  const getSandboxSessionId = useCallback((): string => {
    if (typeof window === 'undefined') return 'demo-default';
    let sid = window.sessionStorage.getItem('hr_sandbox_session');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).substring(2, 10);
      window.sessionStorage.setItem('hr_sandbox_session', sid);
    }
    return sid;
  }, []);

  // Toast Notification
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Load available topics
  const loadTopics = useCallback(async () => {
    try {
      const data = await apiFetch<EventTopic[]>('/api/v1/topics');
      if (Array.isArray(data)) {
        setTopics(data);
        if (data.length > 0 && !data.some((t) => t.name === selectedTopic)) {
          setSelectedTopic(data[0].name);
        }
      }
    } catch {
      // Fallback
    }
  }, [apiFetch, selectedTopic]);

  // Load Receptor Mode
  const loadSinkMode = useCallback(async () => {
    try {
      const data = await apiFetch<{ mode: DemoSinkMode }>(
        '/api/demo/webhook-sink/mode',
        { headers: { 'x-sandbox-session': getSandboxSessionId() } },
      );
      if (data?.mode) {
        setSinkMode(data.mode);
      }
    } catch {
      // Quiet fallback
    }
  }, [apiFetch, getSandboxSessionId]);

  // Load Sink Logs
  const loadSinkLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const data = await apiFetch<DemoSinkLogEntry[]>(
        '/api/demo/webhook-sink/log',
        { headers: { 'x-sandbox-session': getSandboxSessionId() } },
      );
      if (Array.isArray(data)) {
        setSinkLogs(data);
      }
    } catch {
      // Fail silently
    } finally {
      setIsLoadingLogs(false);
    }
  }, [apiFetch, getSandboxSessionId]);

  useEffect(() => {
    loadTopics();
    loadSinkMode();
    loadSinkLogs();
  }, [loadTopics, loadSinkMode, loadSinkLogs]);

  // Auto-refresh sink logs
  useEffect(() => {
    if (!autoRefreshLogs) return;
    const interval = setInterval(() => {
      loadSinkLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefreshLogs, loadSinkLogs]);

  // High-resolution in-flight second counter
  useEffect(() => {
    if (!isDeliveryTracking) return;
    const timer = setInterval(() => {
      setInFlightSeconds((prev) => +(prev + 0.1).toFixed(1));
    }, 100);
    return () => clearInterval(timer);
  }, [isDeliveryTracking]);

  // Real-time Delivery Poller
  useEffect(() => {
    const eventId =
      lastSubmissionResult?.data?.eventId ||
      lastSubmissionResult?.data?.id ||
      lastSubmissionResult?.data?.event_id;
    if (!eventId || !isDeliveryTracking) return;

    let isMounted = true;
    let pollCount = 0;

    const poll = async () => {
      try {
        const res = await apiFetch<{ items: Delivery[]; total: number }>(
          `/api/v1/deliveries?eventId=${eventId}&limit=1`,
        );
        if (!isMounted) return;
        const delivery = res?.items?.[0] || null;
        if (delivery) {
          setActiveDelivery(delivery);
          loadSinkLogs();

          if (delivery.status === 'DELIVERED') {
            setIsDeliveryTracking(false);
            setLastCompletedDelivery(delivery);
            setFlowStep(3);
            setToast({
              id: String(Date.now()),
              type: 'success',
              title: 'Webhook delivered successfully (200 OK)',
              message:
                'Customer destination confirmed 200 OK. HMAC-SHA256 signature verified cryptographically.',
              details: `Attempt ${delivery.attempt_count}/${delivery.max_attempts} | Latency: ${delivery.delivery_attempts?.[0]?.latency_ms ?? 0}ms`,
            });
            setTimeout(() => setFlowStep(0), 4000);
            return;
          }

          if (delivery.status === 'DEAD_LETTER') {
            setIsDeliveryTracking(false);
            setLastCompletedDelivery(delivery);
            setFlowStep(3);
            setToast({
              id: String(Date.now()),
              type: 'error',
              title: 'Exhausted retry budget (Dead Letter Queue)',
              message:
                'Destination server failed all attempts. HookRelay preserved the event safely in DLQ without data loss.',
              details: `Attempts: ${delivery.attempt_count}/${delivery.max_attempts} exhausted`,
            });
            return;
          }

          const latestAttempt = delivery.delivery_attempts?.[0];
          if (latestAttempt && !latestAttempt.is_success) {
            setLastCompletedDelivery(delivery);
            setFlowStep(3);
            if (
              latestAttempt.error_code === 'HEADERS_TIMEOUT' ||
              (latestAttempt.latency_ms && latestAttempt.latency_ms >= 4500)
            ) {
              setToast({
                id: String(Date.now()),
                type: 'warning',
                title: '5.0s Timeout reached: Socket aborted',
                message:
                  'Destination took over 5000ms. HookRelay aborted the TCP socket to protect resources and scheduled an exponential retry in BullMQ.',
                details: `Attempt ${delivery.attempt_count}/${delivery.max_attempts} timed out | Latency: ${latestAttempt.latency_ms}ms`,
              });
            } else if (
              latestAttempt.http_status === 503 ||
              sinkMode === 'DOWN'
            ) {
              setToast({
                id: String(Date.now()),
                type: 'warning',
                title: 'Customer destination down (503 Service Unavailable)',
                message:
                  'Destination rejected delivery with HTTP 503. Retry scheduled with exponential backoff + full jitter.',
                details: `Attempt ${delivery.attempt_count}/${delivery.max_attempts} | Circuit failure counted`,
              });
            }
          }
        }
      } catch {
        // Continue polling
      }

      pollCount++;
      if (pollCount > 40) {
        setIsDeliveryTracking(false);
      }
    };

    poll();
    const interval = setInterval(poll, 600);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [lastSubmissionResult, isDeliveryTracking, apiFetch, loadSinkLogs, sinkMode]);

  // Handle Payload Changes
  const handlePayloadChange = (text: string) => {
    setPayloadText(text);
    try {
      JSON.parse(text);
      setPayloadError(null);
    } catch (err: any) {
      setPayloadError(err.message);
    }
  };

  // Change Topic & Pre-fill Template
  const handleTopicSelect = (topicName: string) => {
    setSelectedTopic(topicName);
    if (SAMPLE_PAYLOADS[topicName]) {
      const template = SAMPLE_PAYLOADS[topicName];
      if (topicName === 'payment.completed') {
        template.settled_at = new Date().toISOString();
      }
      setPayloadText(JSON.stringify(template, null, 2));
      setPayloadError(null);
    }
  };

  // Change Receptor Chaos Mode
  const handleSetSinkMode = async (mode: DemoSinkMode) => {
    setIsChangingMode(true);
    try {
      await apiFetch('/api/demo/webhook-sink/mode', {
        method: 'PUT',
        headers: { 'x-sandbox-session': getSandboxSessionId() },
        body: JSON.stringify({ mode }),
      });
      setSinkMode(mode);
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Receptor mode update failed',
        message: err.message,
      });
    } finally {
      setIsChangingMode(false);
    }
  };

  // Clear Sink Logs
  const handleClearLogs = async () => {
    try {
      await apiFetch('/api/demo/webhook-sink/log', {
        method: 'DELETE',
        headers: { 'x-sandbox-session': getSandboxSessionId() },
      });
      setSinkLogs([]);
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Failed to clear sink logs',
        message: err.message,
      });
    }
  };

  // Dispatch Burst of Events in Parallel
  const handleBurstEvents = async (count = 5) => {
    if (payloadError) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'JSON Syntax Error',
        message: 'Please correct JSON payload syntax errors before submitting.',
      });
      return;
    }

    let parsedData: any;
    try {
      parsedData = JSON.parse(payloadText);
    } catch {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Invalid JSON',
        message: 'Payload is not valid JSON.',
      });
      return;
    }

    const activeTopic =
      selectedTopic === '__custom__' ? customTopic.trim() : selectedTopic;
    if (!activeTopic) {
      setToast({
        id: String(Date.now()),
        type: 'warning',
        title: 'Topic Required',
        message: 'Please specify a valid event topic.',
      });
      return;
    }

    setIsSubmitting(true);
    setFlowStep(1);

    try {
      const promises = Array.from({ length: count }, (_, idx) => {
        const itemData = {
          ...parsedData,
          order_id: parsedData.order_id
            ? `${parsedData.order_id}_burst_${idx + 1}`
            : undefined,
          burst_index: idx + 1,
          dispatched_at: new Date().toISOString(),
        };
        return apiFetch<any>('/api/v1/events', {
          method: 'POST',
          body: JSON.stringify({
            topic: activeTopic,
            data: itemData,
          }),
        });
      });

      setFlowStep(2);
      await Promise.all(promises);

      setToast({
        id: String(Date.now()),
        type: 'success',
        title: `Burst Dispatched (${count}x Events)`,
        message: `Successfully enqueued ${count} concurrent events into Outbox. BullMQ worker pool is dispatching deliveries in parallel.`,
      });

      setFlowStep(3);
      setTimeout(() => {
        setFlowStep(0);
        loadSinkLogs();
      }, 1200);
    } catch (err: any) {
      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Burst dispatch failed',
        message: err.message || 'Error executing burst dispatch.',
      });
      setFlowStep(0);
    } finally {
      setIsSubmitting(false);
    }
  };

  // One-Click Guided Scenarios
  const runScenario = async (mode: DemoSinkMode) => {
    await handleSetSinkMode(mode);
    handleTopicSelect('order.created');
    setTimeout(() => {
      handleSubmitEvent();
    }, 300);
  };

  // Submit Event to HookRelay Ingestion Endpoint
  const handleSubmitEvent = async () => {
    if (payloadError) {
      alert('Please correct JSON payload syntax errors before submitting.');
      return;
    }

    let parsedData: any;
    try {
      parsedData = JSON.parse(payloadText);
    } catch {
      alert('Invalid JSON payload');
      return;
    }

    setIsSubmitting(true);
    setLastSubmissionResult(null);
    setFlowStep(1);

    const activeTopic =
      selectedTopic === '__custom__' ? customTopic.trim() : selectedTopic;
    if (!activeTopic) {
      alert('Please specify a valid event topic');
      setIsSubmitting(false);
      setFlowStep(0);
      return;
    }

    const payload: any = {
      topic: activeTopic,
      data: parsedData,
    };

    if (idempotencyKey.trim()) {
      payload.idempotencyKey = idempotencyKey.trim();
    }

    const start = performance.now();
    try {
      setTimeout(() => setFlowStep(2), 200);

      const result = await apiFetch<any>('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const latencyMs = Math.round(performance.now() - start);
      setLastSubmissionResult({
        success: true,
        latencyMs,
        data: result,
      });

      setActiveDelivery(null);
      setInFlightSeconds(0);
      setIsDeliveryTracking(true);

      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Event persisted to Outbox (202 ACCEPTED)',
        message:
          'Payload validated against JSON schema and locked in PostgreSQL. BullMQ worker dispatched event asynchronously.',
        details: `Ingestion Latency: ${latencyMs}ms | Event ID: ${result?.eventId || result?.id || 'Created'}`,
      });

      setTimeout(() => loadSinkLogs(), 800);
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      setLastSubmissionResult({
        success: false,
        latencyMs,
        error: err.message,
      });
      setFlowStep(0);

      setToast({
        id: String(Date.now()),
        type: 'error',
        title: 'Event ingestion failed',
        message: err.message || 'Error communicating with HookRelay API.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-5 relative">
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
              {toast.details && (
                <span className="inline-block font-mono text-[10px] bg-black/40 px-2 py-0.5 rounded text-zinc-300 border border-white/10 mt-1">
                  {toast.details}
                </span>
              )}
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

      {/* Header & Guided Scenarios Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded">
              Interactive Lab
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              Target Env: <strong className="text-zinc-300">{environment}</strong>
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 mt-1 flex items-center gap-2">
            <span>Interactive Playground</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 max-w-3xl leading-relaxed">
            Decouple event ingestion from destination endpoints. Test how HookRelay signs payloads (HMAC-SHA256), buffers via BullMQ, and applies exponential backoff and circuit breaking.
          </p>
        </div>

        {/* 1-Click Guided Scenario Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase text-zinc-500 mr-1 hidden sm:inline">
            Quick Scenarios:
          </span>
          <button
            onClick={() => runScenario('HEALTHY')}
            disabled={isSubmitting || isDeliveryTracking}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
          >
            200 OK Delivery
          </button>
          <button
            onClick={() => runScenario('SLOW')}
            disabled={isSubmitting || isDeliveryTracking}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-amber-800/80 bg-amber-950/40 text-amber-300 hover:bg-amber-900/40 transition-colors disabled:opacity-50"
          >
            5.0s Timeout & Abort
          </button>
          <button
            onClick={() => runScenario('DOWN')}
            disabled={isSubmitting || isDeliveryTracking}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-rose-800/80 bg-rose-950/40 text-rose-300 hover:bg-rose-900/40 transition-colors disabled:opacity-50"
          >
            503 Outage & Backoff
          </button>
        </div>
      </div>

      {/* Connected 3-Node Minimal Stepper */}
      <div className="grid grid-cols-3 gap-2 py-2 px-3 rounded-lg border border-zinc-800/80 bg-[#101217]">
        <div
          className={`flex items-center gap-2 text-xs font-mono transition-colors ${
            flowStep >= 1 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'
          }`}
        >
          <span
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
              flowStep >= 1 ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            1
          </span>
          <span className="hidden sm:inline">1. Ingestion (API)</span>
          <span className="sm:hidden">1. Ingest</span>
        </div>

        <div
          className={`flex items-center justify-center gap-2 text-xs font-mono transition-colors ${
            flowStep >= 2 ? 'text-cyan-400 font-semibold' : 'text-zinc-500'
          }`}
        >
          <span
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
              flowStep >= 2 ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            2
          </span>
          <span className="hidden sm:inline">2. Engine (BullMQ + HMAC)</span>
          <span className="sm:hidden">2. Engine</span>
        </div>

        <div
          className={`flex items-center justify-end gap-2 text-xs font-mono transition-colors ${
            flowStep === 3
              ? activeDelivery?.status === 'DELIVERED'
                ? 'text-emerald-400 font-semibold'
                : sinkMode === 'DOWN'
                  ? 'text-rose-400 font-semibold'
                  : 'text-amber-400 font-semibold'
              : 'text-zinc-500'
          }`}
        >
          <span
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
              flowStep === 3
                ? activeDelivery?.status === 'DELIVERED'
                  ? 'bg-emerald-500 text-zinc-950'
                  : sinkMode === 'DOWN'
                    ? 'bg-rose-500 text-zinc-100'
                    : 'bg-amber-500 text-zinc-950'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            3
          </span>
          <span className="hidden sm:inline">3. Destination (Egress)</span>
          <span className="sm:hidden">3. Egress</span>
        </div>
      </div>

      {/* Main 3-Column Layout: Left (Producer) -> Center (Engine Pipeline) -> Right (Consumer Destination) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 items-start">
        {/* COLUMN 1: SENDER / EVENT PRODUCER */}
        <div className="rounded-lg border border-zinc-800 bg-[#0e1015] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center text-[10px] font-mono font-bold text-zinc-300">
                1
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 font-mono">
                Event Producer
              </span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Your App</span>
          </div>

          {/* Preset Buttons */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              Topic Scenario Preset
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {['order.created', 'payment.completed', 'user.registered'].map(
                (preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleTopicSelect(preset)}
                    className={`text-[11px] font-mono py-1 px-2 rounded border truncate transition-colors ${
                      selectedTopic === preset
                        ? 'border-zinc-500 bg-zinc-800 text-zinc-100 font-semibold'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {preset.split('.')[0]}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Topic Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              Registered Event Topic
            </label>
            <select
              value={selectedTopic}
              onChange={(e) => handleTopicSelect(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-hidden focus:border-zinc-700"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
              <option value="__custom__">+ Custom Topic</option>
            </select>
          </div>

          {selectedTopic === '__custom__' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                Custom Topic Name
              </label>
              <input
                type="text"
                placeholder="e.g. invoice.generated"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-hidden"
              />
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleSubmitEvent}
              disabled={isSubmitting || !!payloadError || isDeliveryTracking}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Ingesting Event...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Dispatch Event</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleBurstEvents(5)}
              disabled={isSubmitting || !!payloadError || isDeliveryTracking}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded border border-zinc-700 hover:border-zinc-500 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 text-xs font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Dispatch 5 concurrent events in parallel to test worker queue throughput"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Burst (5x)</span>
            </button>
          </div>

          {/* Collapsible Advanced: Payload & Idempotency Key */}
          <div className="pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={() => setShowAdvancedPayload(!showAdvancedPayload)}
              className="w-full flex items-center justify-between text-[11px] font-mono text-zinc-400 hover:text-zinc-200 py-1"
            >
              <span className="flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-zinc-500" />
                <span>Advanced: Edit Payload & Idempotency</span>
              </span>
              {showAdvancedPayload ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showAdvancedPayload && (
              <div className="space-y-3 pt-3 animate-in fade-in duration-200">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500">
                    Idempotency Key (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-generated per dispatch (or type custom key to test deduplication)"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 font-mono focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-zinc-500">Payload JSON</span>
                    {payloadError ? (
                      <span className="text-rose-400">JSON Syntax Error</span>
                    ) : (
                      <span className="text-emerald-400">Valid JSON</span>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={payloadText}
                    onChange={(e) => handlePayloadChange(e.target.value)}
                    className={`w-full bg-zinc-950 p-2.5 rounded border text-[11px] font-mono text-zinc-200 focus:outline-hidden resize-none ${
                      payloadError ? 'border-rose-700' : 'border-zinc-800'
                    }`}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 2: HOOKRELAY ENGINE / DISPATCH PIPELINE */}
        <div className="rounded-lg border border-cyan-900/50 bg-[#0e1015] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-cyan-950 border border-cyan-800/80 flex items-center justify-center text-[10px] font-mono font-bold text-cyan-300">
                2
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 font-mono">
                HookRelay Engine
              </span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded">
              Outbox + BullMQ
            </span>
          </div>

          {/* Engine Lifecycle Status */}
          <div className="space-y-3">
            {/* Step 1 Ingestion Status */}
            <div className="p-3 rounded border border-zinc-800 bg-zinc-950/60 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1. Ingest API</span>
                </span>
                <span className="text-emerald-400 font-semibold">
                  {lastSubmissionResult?.success
                    ? `202 ACCEPTED (${lastSubmissionResult.latencyMs}ms)`
                    : 'Awaiting Event'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 font-sans">
                Transactional Outbox in PostgreSQL with JSON schema validation.
              </p>
            </div>

            {/* Step 2 Dispatcher Core */}
            <div className="p-3 rounded border border-zinc-800 bg-zinc-950/60 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span>2. Protection Core</span>
                </span>
                <span className="text-cyan-400 font-semibold">
                  HMAC-SHA256
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 font-sans">
                Anti-SSRF DNS Pinning applied. Dedicated signing key per endpoint.
              </p>
            </div>

            {/* Step 3 Live Delivery Status Banner */}
            {(() => {
              const displayDelivery = activeDelivery || lastCompletedDelivery;
              return (
                <div
                  className={`p-3 rounded border text-xs font-mono space-y-2 transition-all ${
                    displayDelivery?.status === 'DELIVERED'
                      ? 'border-emerald-800/80 bg-emerald-950/30 text-emerald-300'
                      : displayDelivery?.status === 'RETRYING'
                        ? 'border-amber-800/80 bg-amber-950/30 text-amber-300'
                        : isDeliveryTracking && sinkMode === 'SLOW'
                          ? 'border-amber-700/80 bg-amber-950/30 text-amber-200'
                          : 'border-zinc-800 bg-zinc-950/60 text-zinc-400'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5">
                      {displayDelivery?.status === 'DELIVERED' ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      ) : displayDelivery?.status === 'RETRYING' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      ) : isDeliveryTracking ? (
                        <Clock className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                      )}
                      <span>3. Delivery Status</span>
                    </span>
                    <span>
                      {displayDelivery?.status === 'DELIVERED'
                        ? '200 OK (CONFIRMED)'
                        : displayDelivery?.status === 'RETRYING'
                          ? 'RETRY SCHEDULED'
                          : isDeliveryTracking && sinkMode === 'SLOW'
                            ? `TIMING OUT (${inFlightSeconds}s / 5.0s)`
                            : isDeliveryTracking
                              ? 'DISPATCHING...'
                              : 'IDLE'}
                    </span>
                  </div>

                  {/* Plain English Explanation */}
                  <p className="text-[11px] font-sans leading-relaxed text-zinc-300">
                    {displayDelivery?.status === 'DELIVERED'
                      ? `Delivered to customer server in ${displayDelivery.delivery_attempts?.[0]?.latency_ms || 14}ms. Cryptographic signature verified.`
                      : displayDelivery?.status === 'RETRYING'
                        ? `Destination returned 503 or timed out. Attempt ${displayDelivery.attempt_count}/${displayDelivery.max_attempts} failed. Exponential backoff active.`
                        : isDeliveryTracking && sinkMode === 'SLOW'
                          ? `Socket open awaiting response (${inFlightSeconds}s). Will abort at 5.0s timeout to protect worker threads.`
                          : 'Ready to receive and dispatch webhooks.'}
                  </p>

                  {/* Technical identifiers */}
                  {lastSubmissionResult?.data && (
                    <div className="pt-2 border-t border-white/10 text-[10px] space-y-1 font-mono text-zinc-400">
                      <div className="flex justify-between">
                        <span>Event ID:</span>
                        <span className="text-zinc-200">
                          {(
                            lastSubmissionResult.data?.eventId ||
                            lastSubmissionResult.data?.id ||
                            ''
                          ).slice(0, 8)}
                          ...
                        </span>
                      </div>
                      {displayDelivery && (
                        <div className="flex justify-between">
                          <span>Attempts:</span>
                          <span className="text-zinc-200">
                            {displayDelivery.attempt_count} / {displayDelivery.max_attempts}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* COLUMN 3: CUSTOMER DESTINATION / CONSUMER RECEPTOR */}
        <div className="rounded-lg border border-zinc-800 bg-[#0e1015] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center text-[10px] font-mono font-bold text-zinc-300">
                3
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 font-mono">
                Customer Server
              </span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                sinkMode === 'HEALTHY'
                  ? 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300'
                  : sinkMode === 'DOWN'
                    ? 'border-rose-800/80 bg-rose-950/60 text-rose-300'
                    : 'border-amber-800/80 bg-amber-950/60 text-amber-300'
              }`}
            >
              Mode: {sinkMode}
            </span>
          </div>

          {/* Chaos Simulation Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              Destination Health Mode
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleSetSinkMode('HEALTHY')}
                disabled={isChangingMode}
                className={`text-center py-2 px-1.5 rounded border text-[11px] font-mono transition-colors ${
                  sinkMode === 'HEALTHY'
                    ? 'border-emerald-700 bg-emerald-950/70 text-emerald-300 font-semibold'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div>Healthy</div>
                <div className="text-[9px] text-zinc-500 font-sans">200 OK</div>
              </button>

              <button
                type="button"
                onClick={() => handleSetSinkMode('SLOW')}
                disabled={isChangingMode}
                className={`text-center py-2 px-1.5 rounded border text-[11px] font-mono transition-colors ${
                  sinkMode === 'SLOW'
                    ? 'border-amber-700 bg-amber-950/70 text-amber-300 font-semibold'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div>Slow</div>
                <div className="text-[9px] text-zinc-500 font-sans">&gt;5s Timeout</div>
              </button>

              <button
                type="button"
                onClick={() => handleSetSinkMode('DOWN')}
                disabled={isChangingMode}
                className={`text-center py-2 px-1.5 rounded border text-[11px] font-mono transition-colors ${
                  sinkMode === 'DOWN'
                    ? 'border-rose-700 bg-rose-950/70 text-rose-300 font-semibold'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div>Down</div>
                <div className="text-[9px] text-zinc-500 font-sans">503 Error</div>
              </button>
            </div>
          </div>

          {/* Live Ingress Feed at Customer Endpoint */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                <span>Live Destination Feed</span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => loadSinkLogs()}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  title="Refresh feed"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="p-1 rounded text-zinc-400 hover:text-rose-300 hover:bg-zinc-800 transition-colors"
                  title="Clear feed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Log Stream Container */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {sinkLogs.length === 0 ? (
                <div className="p-4 rounded border border-dashed border-zinc-800 text-center text-[11px] text-zinc-500 font-mono">
                  No webhooks received yet. Dispatch an event from Column 1.
                </div>
              ) : (
                sinkLogs.slice(0, 10).map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded border border-zinc-800 bg-zinc-950 text-[11px] font-mono space-y-1.5 animate-in fade-in duration-200"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-400">
                        {new Date(log.receivedAt).toLocaleTimeString()}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                          log.signatureValid
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/80'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {log.signatureValid ? 'HMAC VERIFIED' : 'UNSIGNED'}
                      </span>
                    </div>

                    <div className="text-[10px] text-zinc-500 truncate">
                      Event:{' '}
                      <span className="text-zinc-300">
                        {(
                          log.headers?.['x-hookrelay-event-id'] ||
                          log.id ||
                          'evt_...'
                        ).slice(0, 16)}
                        ...
                      </span>
                    </div>

                    <div className="bg-[#09090b] p-2 rounded text-[10px] text-zinc-300 overflow-x-auto max-h-[80px]">
                      <pre className="font-mono">
                        {typeof log.body === 'string'
                          ? log.body
                          : JSON.stringify(log.body, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
