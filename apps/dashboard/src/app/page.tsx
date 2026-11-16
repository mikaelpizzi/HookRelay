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
  Sliders,
  Check,
  ArrowRight,
  ShieldCheck,
  Server,
  Zap,
  X,
  AlertTriangle,
  Timer,
  Activity,
  CornerDownRight,
  ArrowUpRight,
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

export default function DemoSandboxPage() {
  const { apiFetch, environment } = useTenant();

  // Topics
  const [topics, setTopics] = useState<EventTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>('order.created');
  const [customTopic, setCustomTopic] = useState<string>('');

  // Event Input
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(SAMPLE_PAYLOADS['order.created'], null, 2),
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSubmissionResult, setLastSubmissionResult] = useState<any | null>(null);

  // Active Delivery Lifecycle Tracking
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null);
  const [inFlightSeconds, setInFlightSeconds] = useState<number>(0);
  const [isDeliveryTracking, setIsDeliveryTracking] = useState<boolean>(false);

  // Receptor Mode & Logs
  const [sinkMode, setSinkMode] = useState<DemoSinkMode>('HEALTHY');
  const [isChangingMode, setIsChangingMode] = useState<boolean>(false);
  const [sinkLogs, setSinkLogs] = useState<DemoSinkLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);

  // Visual Animated Flow Step: 0 = idle, 1 = app emitting, 2 = HookRelay processing, 3 = receptor receiving
  const [flowStep, setFlowStep] = useState<number>(0);

  // Toast Notification
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Auto-dismiss toast after 6 seconds
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
      // Demo fallback
    }
  }, [apiFetch, selectedTopic]);

  // Load Receptor Mode
  const loadSinkMode = useCallback(async () => {
    try {
      const data = await apiFetch<{ mode: DemoSinkMode }>(
        '/api/demo/webhook-sink/mode',
      );
      if (data?.mode) {
        setSinkMode(data.mode);
      }
    } catch {
      // Demo sink might be quiet
    }
  }, [apiFetch]);

  // Load Sink Logs
  const loadSinkLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const data = await apiFetch<DemoSinkLogEntry[]>(
        '/api/demo/webhook-sink/log',
      );
      if (Array.isArray(data)) {
        setSinkLogs(data);
      }
    } catch {
      // Failed to load logs
    } finally {
      setIsLoadingLogs(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadTopics();
    loadSinkMode();
    loadSinkLogs();
  }, [loadTopics, loadSinkMode, loadSinkLogs]);

  // Auto-refresh sink logs every 3 seconds
  useEffect(() => {
    if (!autoRefreshLogs) return;
    const interval = setInterval(() => {
      loadSinkLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefreshLogs, loadSinkLogs]);

  // High-resolution in-flight second counter
  useEffect(() => {
    if (!isDeliveryTracking) {
      return;
    }
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
            setFlowStep(3);
            setToast({
              id: String(Date.now()),
              type: 'success',
              title: 'Webhook entregado exitosamente (200 OK)',
              message:
                'El receptor confirmó la recepción con 200 OK y la firma HMAC-SHA256 fue validada criptográficamente.',
              details: `Intento ${delivery.attempt_count}/${delivery.max_attempts} | Latencia: ${delivery.delivery_attempts?.[0]?.latency_ms ?? 0}ms`,
            });
            setTimeout(() => setFlowStep(0), 4000);
            return;
          }

          if (delivery.status === 'DEAD_LETTER') {
            setIsDeliveryTracking(false);
            setFlowStep(3);
            setToast({
              id: String(Date.now()),
              type: 'error',
              title: 'Agotados todos los intentos (Dead Letter Queue)',
              message:
                'El receptor no respondió después del límite de reintentos. HookRelay resguardó el evento en DLQ sin pérdida de datos.',
              details: `Intentos: ${delivery.attempt_count}/${delivery.max_attempts} agotados`,
            });
            return;
          }

          const latestAttempt = delivery.delivery_attempts?.[0];
          if (latestAttempt && !latestAttempt.is_success) {
            setFlowStep(3);
            if (
              latestAttempt.error_code === 'HEADERS_TIMEOUT' ||
              (latestAttempt.latency_ms && latestAttempt.latency_ms >= 4500)
            ) {
              setToast({
                id: String(Date.now()),
                type: 'warning',
                title: 'Timeout de 5.0s alcanzado: Conexión cortada',
                message:
                  'El servidor receptor tardó más de 5000ms. HookRelay abortó el socket TCP para proteger el sistema, registró el intento fallido y agendó el reintento en BullMQ con Backoff + Jitter.',
                details: `Intento ${delivery.attempt_count}/${delivery.max_attempts} fallido | Latencia: ${latestAttempt.latency_ms}ms`,
              });
            } else if (
              latestAttempt.http_status === 503 ||
              sinkMode === 'DOWN'
            ) {
              setToast({
                id: String(Date.now()),
                type: 'warning',
                title: 'Receptor caído (503 Service Unavailable)',
                message:
                  'El receptor rechazó la entrega con HTTP 503. HookRelay activó la cola de reintentos exponencial y sumó un fallo al Circuit Breaker.',
                details: `Intento ${delivery.attempt_count}/${delivery.max_attempts} | Próximo reintento agendado`,
              });
            }
          }
        }
      } catch {
        // Silently continue polling
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

  const handleTemplateSelect = (topicName: string) => {
    setSelectedTopic(topicName);
    if (SAMPLE_PAYLOADS[topicName]) {
      const formatted = JSON.stringify(SAMPLE_PAYLOADS[topicName], null, 2);
      setPayloadText(formatted);
      setPayloadError(null);
    }
  };

  // Change Receptor Mode
  const handleModeChange = async (mode: DemoSinkMode) => {
    setIsChangingMode(true);
    try {
      await apiFetch('/api/demo/webhook-sink/mode', {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      });
      setSinkMode(mode);
    } catch (err: any) {
      alert(`Failed to set mode: ${err.message}`);
    } finally {
      setIsChangingMode(false);
    }
  };

  // Clear Sink Logs
  const handleClearLogs = async () => {
    try {
      await apiFetch('/api/demo/webhook-sink/log', {
        method: 'DELETE',
      });
      setSinkLogs([]);
    } catch (err: any) {
      alert(`Failed to clear logs: ${err.message}`);
    }
  };

  // Trigger Event with animated flow and toast
  const handleTriggerEvent = async () => {
    let parsedData: any;
    try {
      parsedData = JSON.parse(payloadText);
    } catch {
      setPayloadError('Formato JSON inválido');
      return;
    }

    setIsSubmitting(true);
    setLastSubmissionResult(null);

    // Step 1: App Emisora envia evento
    setFlowStep(1);

    const activeTopic =
      selectedTopic === '__custom__' ? customTopic.trim() : selectedTopic;
    if (!activeTopic) {
      alert('Especifica un tópico válido');
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
      // Step 2: HookRelay procesa evento encolando y firmando
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

      // Inicializar seguimiento en tiempo real de la entrega
      setActiveDelivery(null);
      setInFlightSeconds(0);
      setIsDeliveryTracking(true);

      // Notificación inmediata de ingesta asegurada en Outbox
      setToast({
        id: String(Date.now()),
        type: 'success',
        title: 'Evento persistido en Outbox (202 ACCEPTED)',
        message:
          'HookRelay validó el esquema JSON y aseguró el evento en PostgreSQL. El dispatcher seguro encola el envío en BullMQ hacia el receptor.',
        details: `Latencia de ingesta: ${latencyMs}ms | Event ID: ${result?.eventId || result?.id || 'Generado'}`,
      });

      // Refrescar registros del receptor de inmediato
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
        title: 'Fallo en la ingesta del evento',
        message: err.message || 'Error al comunicarse con la API de HookRelay.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-5 sm:top-5 z-50 sm:max-w-md w-auto animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`p-3.5 sm:p-4 rounded-lg border shadow-xl backdrop-blur-md flex items-start gap-3 ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700/80 text-emerald-200'
                : toast.type === 'warning'
                  ? 'bg-amber-950/90 border-amber-700/80 text-amber-200'
                  : 'bg-rose-950/90 border-rose-700/80 text-rose-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : toast.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-1">
              <div className="text-xs font-bold font-mono tracking-tight text-zinc-100">
                {toast.title}
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed font-sans">
                {toast.message}
              </p>
              {toast.details && (
                <div className="text-[10px] font-mono text-zinc-400 pt-1 border-t border-zinc-800/60 mt-1">
                  {toast.details}
                </div>
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

      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-400" />
            <span>Demo Sandbox</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 font-sans">
            Experimenta cómo viaja un webhook de extremo a extremo: desde la ingesta en tu app hasta la entrega segura al cliente final.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded">
            Target Env: <strong className="text-zinc-200">{environment}</strong>
          </span>
        </div>
      </div>

      {/* 1. Diagrama Visual Horizontal de 3 Pasos */}
      <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-3.5 sm:p-4.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-zinc-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-300">
              Arquitectura del Flujo de Webhooks
            </span>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            {flowStep === 0 && 'Listo para disparar evento'}
            {flowStep === 1 && '1/3 Tu app emitiendo evento...'}
            {flowStep === 2 && '2/3 HookRelay asegurando en Outbox y firmando...'}
            {flowStep === 3 && (
              isDeliveryTracking && inFlightSeconds < 5.0 && sinkMode === 'SLOW' && activeDelivery?.status !== 'DELIVERED'
                ? `3/3 Conectando al receptor... (${inFlightSeconds}s / 5.0s límite)`
                : activeDelivery?.status === 'RETRYING'
                  ? `Intento ${activeDelivery.attempt_count}/${activeDelivery.max_attempts} fallido -> En cola de reintentos (Backoff + Jitter)`
                  : activeDelivery?.status === 'DELIVERED'
                    ? `3/3 Entregado al receptor (200 OK en ${activeDelivery.delivery_attempts?.[0]?.latency_ms || 12}ms)`
                    : sinkMode === 'HEALTHY'
                      ? '3/3 Entregado al receptor (200 OK)'
                      : sinkMode === 'DOWN'
                        ? '3/3 Servidor caído (503) -> En cola de reintentos'
                        : '3/3 Timeout detectado (>5s) -> Reintento programado'
            )}
          </span>
        </div>

        <div className="flex md:grid md:grid-cols-3 gap-3 items-stretch relative overflow-x-auto pb-2 md:pb-0 snap-x snap-mandatory scrollbar-none">
          {/* Paso 1: Tu App Emisora */}
          <div
            className={`min-w-[85vw] sm:min-w-[320px] md:min-w-0 snap-center p-3.5 rounded-lg border transition-all duration-300 ${
              flowStep === 1
                ? 'border-emerald-500 bg-emerald-950/40 ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-950/50'
                : 'border-zinc-800 bg-zinc-950/80 text-zinc-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold ${
                    flowStep === 1
                      ? 'bg-emerald-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  1
                </span>
                <span className="text-xs font-bold font-mono text-zinc-100">
                  Tu App Emisora
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Ingress</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              Publica el evento vía <code className="text-zinc-200 font-mono">POST /api/v1/events</code> con payload de negocio y clave de idempotencia.
            </p>
          </div>

          {/* Paso 2: HookRelay Engine */}
          <div
            className={`min-w-[85vw] sm:min-w-[320px] md:min-w-0 snap-center p-3.5 rounded-lg border transition-all duration-300 ${
              flowStep === 2
                ? 'border-cyan-500 bg-cyan-950/40 ring-1 ring-cyan-500/50 shadow-lg shadow-cyan-950/50'
                : 'border-zinc-800 bg-zinc-950/80 text-zinc-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold ${
                    flowStep === 2
                      ? 'bg-cyan-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  2
                </span>
                <span className="text-xs font-bold font-mono text-zinc-100">
                  HookRelay Engine
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Core</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              Persiste en Outbox, encola en BullMQ, calcula firma <code className="text-zinc-200 font-mono">HMAC-SHA256</code> y aplica DNS Pinning.
            </p>
          </div>

          {/* Paso 3: Servidor Receptor */}
          <div
            className={`min-w-[85vw] sm:min-w-[320px] md:min-w-0 snap-center p-3.5 rounded-lg border transition-all duration-300 ${
              flowStep === 3
                ? sinkMode === 'HEALTHY'
                  ? 'border-emerald-500 bg-emerald-950/40 ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-950/50'
                  : sinkMode === 'DOWN'
                    ? 'border-rose-500 bg-rose-950/40 ring-1 ring-rose-500/50 shadow-lg shadow-rose-950/50'
                    : 'border-amber-500 bg-amber-950/40 ring-1 ring-amber-500/50 shadow-lg shadow-amber-950/50'
                : 'border-zinc-800 bg-zinc-950/80 text-zinc-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold ${
                    flowStep === 3
                      ? sinkMode === 'HEALTHY'
                        ? 'bg-emerald-500 text-zinc-950'
                        : sinkMode === 'DOWN'
                          ? 'bg-rose-500 text-zinc-100'
                          : 'bg-amber-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  3
                </span>
                <span className="text-xs font-bold font-mono text-zinc-100">
                  Servidor Receptor
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Egress</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              {sinkMode === 'HEALTHY' &&
                'Verifica la firma criptográfica y confirma la recepción con HTTP 200 OK.'}
              {sinkMode === 'DOWN' &&
                'Simula fallo HTTP 503. HookRelay protege el endpoint y encola reintentos con jitter.'}
              {sinkMode === 'SLOW' &&
                'Simula retardo >5s. HookRelay corta el socket por timeout y agenda reintento.'}
            </p>
          </div>
        </div>

        {/* Indicador de pasos táctil en móvil */}
        <div className="flex md:hidden items-center justify-center gap-2 pt-0.5">
          <span className="text-[10px] font-mono text-zinc-500">Paso 1 Tu App &rarr; 2 HookRelay &rarr; 3 Receptor</span>
        </div>
      </div>

      {/* 2. Monitor de Ciclo de Vida y Diagnóstico de la Entrega en Tiempo Real */}
      {lastSubmissionResult?.success && (
        <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-4 sm:p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-zinc-100 uppercase tracking-wide font-mono">
                Monitor del Ciclo de Despacho en Vivo
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-zinc-400">
                Event ID:{' '}
                <strong className="text-zinc-200 font-mono">
                  {(
                    lastSubmissionResult.data?.eventId ||
                    lastSubmissionResult.data?.id ||
                    '........'
                  ).slice(0, 8)}
                  ...
                </strong>
              </span>
              <Badge
                statusText={
                  activeDelivery?.status ||
                  (isDeliveryTracking ? 'IN_FLIGHT' : 'PENDING')
                }
                size="sm"
              >
                STATUS: {activeDelivery?.status || (isDeliveryTracking ? 'IN_FLIGHT' : 'PENDING')}
              </Badge>
              {activeDelivery && (
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                  Intento {activeDelivery.attempt_count} / {activeDelivery.max_attempts}
                </span>
              )}
            </div>
          </div>

          {/* Lifecycle Step Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Step 1: Ingesta */}
            <div className="p-3 rounded border border-emerald-800/60 bg-emerald-950/20 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between text-emerald-400 font-semibold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>1. Ingesta HTTP</span>
                </span>
                <span>202 ACCEPTED</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans">
                Outbox persistido en Postgres en <strong className="text-zinc-200 font-mono">{lastSubmissionResult.latencyMs}ms</strong>.
              </p>
            </div>

            {/* Step 2: Engine & Worker */}
            <div className="p-3 rounded border border-cyan-800/60 bg-cyan-950/20 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between text-cyan-400 font-semibold">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  <span>2. Dispatcher Core</span>
                </span>
                <span>BullMQ Activo</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans">
                Firma <code className="text-zinc-300 font-mono">HMAC-SHA256</code> generada y DNS Pinning anti-SSRF aplicado.
              </p>
            </div>

            {/* Step 3: Receptor Externo */}
            <div
              className={`p-3 rounded border text-xs font-mono space-y-1 transition-all ${
                activeDelivery?.status === 'DELIVERED'
                  ? 'border-emerald-700/80 bg-emerald-950/30 text-emerald-300'
                  : activeDelivery?.status === 'RETRYING'
                    ? 'border-amber-700/80 bg-amber-950/30 text-amber-300'
                    : isDeliveryTracking && sinkMode === 'SLOW'
                      ? 'border-amber-600/80 bg-amber-950/20 text-amber-200'
                      : 'border-zinc-800 bg-zinc-900/50 text-zinc-300'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  {activeDelivery?.status === 'DELIVERED' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  ) : activeDelivery?.status === 'RETRYING' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
                  )}
                  <span>3. Receptor Egress</span>
                </span>
                <span>
                  {activeDelivery?.status === 'DELIVERED'
                    ? '200 OK'
                    : activeDelivery?.status === 'RETRYING'
                      ? 'REINTENTANDO'
                      : isDeliveryTracking && sinkMode === 'SLOW'
                        ? `${inFlightSeconds}s / 5.0s`
                        : 'DESPACHANDO'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans">
                {activeDelivery?.status === 'DELIVERED'
                  ? `Entrega confirmada en ${activeDelivery.delivery_attempts?.[0]?.latency_ms || 12}ms.`
                  : activeDelivery?.status === 'RETRYING'
                    ? `Fallo detectado en intento ${activeDelivery.attempt_count}. Backoff programado.`
                    : isDeliveryTracking && sinkMode === 'SLOW'
                      ? 'Conexión abierta esperando respuesta del receptor...'
                      : 'Esperando respuesta del servidor receptor...'}
              </p>
            </div>
          </div>

          {/* SLOW Mode In-Flight Live Timer Bar */}
          {isDeliveryTracking && sinkMode === 'SLOW' && activeDelivery?.status !== 'DELIVERED' && inFlightSeconds < 5.0 && (
            <div className="p-3 rounded bg-amber-950/30 border border-amber-800/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-amber-300">
                <span className="flex items-center gap-1.5 font-bold">
                  <Clock className="w-3.5 h-3.5 animate-spin" />
                  <span>Simulación SLOW en curso: Socket esperando respuesta...</span>
                </span>
                <span className="font-mono text-amber-200 font-bold">
                  {inFlightSeconds.toFixed(1)}s / 5.0s límite
                </span>
              </div>
              {/* Animated Progress Bar */}
              <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-amber-500 h-1.5 rounded-full transition-all duration-100 ease-linear"
                  style={{ width: `${Math.min(100, (inFlightSeconds / 5.0) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                El receptor configurado en <strong className="text-zinc-200">SLOW</strong> demora intencionalmente. HookRelay mantiene el socket abierto de forma segura hasta el límite de 5000ms. En cuanto se cumplan los 5s, el motor cortará la conexión para proteger los recursos y activará la cola de reintentos.
              </p>
            </div>
          )}

          {/* Post-Timeout or Failed Retry Diagnostic Notice */}
          {activeDelivery?.status === 'RETRYING' && (
            <div className="p-3.5 rounded bg-amber-950/40 border border-amber-700/80 text-xs font-mono space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-amber-300 font-bold">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    {activeDelivery.delivery_attempts?.[0]?.error_code === 'HEADERS_TIMEOUT' ||
                    (activeDelivery.delivery_attempts?.[0]?.latency_ms && activeDelivery.delivery_attempts[0].latency_ms >= 4500)
                      ? 'TIMEOUT DE 5.0s ALCANZADO — SOCKET CORTADO POR SEGURIDAD'
                      : 'FALLO HTTP 503 — SERVIDOR EXTERNO NO DISPONIBLE'}
                  </span>
                </span>
                <span className="text-[11px] font-mono text-zinc-400 font-normal">
                  Latencia registrada:{' '}
                  <strong className="text-zinc-200 font-mono">
                    {activeDelivery.delivery_attempts?.[0]?.latency_ms ?? 5000}ms
                  </strong>
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
                HookRelay abortó el socket tras exceder el límite de seguridad de 5000ms para evitar agotamiento de conexiones (Thread Starvation). El evento no se perdió: permanece encolado en BullMQ con <strong className="text-zinc-200">Exponential Backoff y Full Jitter</strong> para su próximo reintento.
              </p>
              <div className="pt-2 border-t border-amber-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold font-sans">
                  <span>
                    👉 <strong>Prueba interactiva:</strong> Cambia el receptor a &quot;HEALTHY&quot; (200 OK) arriba a la derecha. En el siguiente reintento automático, el estado cambiará a DELIVERED en tiempo real.
                  </span>
                </div>
                {activeDelivery.next_retry_at && (
                  <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                    Siguiente intento: {new Date(activeDelivery.next_retry_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Success Diagnostic Notice */}
          {activeDelivery?.status === 'DELIVERED' && (
            <div className="p-3 rounded bg-emerald-950/40 border border-emerald-700/80 text-xs font-mono space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>ENTREGA EXITOSA CONFIRMADA (HTTP 200 OK)</span>
              </div>
              <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
                El webhook fue aceptado y verificado por el receptor en{' '}
                <strong className="text-zinc-100 font-mono">
                  {activeDelivery.delivery_attempts?.[0]?.latency_ms ?? 12}ms
                </strong>{' '}
                en el intento{' '}
                <strong className="text-zinc-100 font-mono">
                  {activeDelivery.attempt_count} de {activeDelivery.max_attempts}
                </strong>
                . La firma criptográfica HMAC-SHA256 coincidió exactamente.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Left Column: Event Generator */}
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Event Dispatch Generator
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Simula tu aplicación enviando una notificación de negocio en tiempo real.
                </p>
              </div>
              <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0">
                <span className="text-[10px] font-mono text-zinc-500 uppercase mr-0.5">Presets:</span>
                {Object.keys(SAMPLE_PAYLOADS).map((tplName) => (
                  <button
                    key={tplName}
                    onClick={() => handleTemplateSelect(tplName)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                      selectedTopic === tplName
                        ? 'border-emerald-600 bg-emerald-950/80 text-emerald-300 font-bold'
                        : 'border-zinc-800/80 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tplName.split('.')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                TÓPICO DEL EVENTO
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selectedTopic}
                  onChange={(e) => {
                    const newTopic = e.target.value;
                    setSelectedTopic(newTopic);
                    if (SAMPLE_PAYLOADS[newTopic]) {
                      setPayloadText(
                        JSON.stringify(SAMPLE_PAYLOADS[newTopic], null, 2),
                      );
                      setPayloadError(null);
                    }
                  }}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
                >
                  {topics.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                  {topics.length === 0 && (
                    <>
                      <option value="order.created">order.created</option>
                      <option value="payment.completed">payment.completed</option>
                      <option value="user.registered">user.registered</option>
                    </>
                  )}
                  <option value="__custom__">+ Custom Topic</option>
                </select>
                {selectedTopic === '__custom__' && (
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="e.g. invoice.paid"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
                  />
                )}
              </div>
            </div>

            {/* Idempotency Key (Optional) */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-mono text-zinc-400">
                  CLAVE DE IDEMPOTENCIA (OPCIONAL)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setIdempotencyKey(`test_idem_${Math.random().toString(36).slice(2, 10)}`)
                  }
                  className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Generar Aleatoria
                </button>
              </div>
              <input
                type="text"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                placeholder="e.g. idem_98a72b0c (opcional)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              />
            </div>

            {/* Interactive JSON Editor */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-mono text-zinc-400">
                  CARGA ÚTIL JSON (PAYLOAD)
                </label>
                {payloadError ? (
                  <span className="text-[10px] text-rose-400 font-mono">
                    Error de Sintaxis
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" /> JSON Válido
                  </span>
                )}
              </div>
              <textarea
                value={payloadText}
                onChange={(e) => handlePayloadChange(e.target.value)}
                rows={7}
                className={`w-full bg-[#0c0c0e] font-mono text-xs text-zinc-300 p-3 rounded border leading-relaxed focus:outline-hidden resize-y ${
                  payloadError ? 'border-rose-800/80' : 'border-zinc-800 focus:border-zinc-700'
                }`}
                spellCheck={false}
              />
            </div>

            {/* Trigger Button */}
            <button
              onClick={handleTriggerEvent}
              disabled={isSubmitting || !!payloadError}
              className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded text-xs font-semibold tracking-wide transition-all active:scale-[0.99] ${
                isSubmitting || !!payloadError
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold border border-emerald-500 shadow-md shadow-emerald-950/40'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Ingestando Evento...' : 'Disparar Evento (Trigger Event)'}</span>
            </button>

            {/* Result Box */}
            {lastSubmissionResult && (
              <div
                className={`p-3 rounded border text-xs font-mono space-y-1.5 ${
                  lastSubmissionResult.success
                    ? 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300'
                    : 'border-rose-800/70 bg-rose-950/40 text-rose-300'
                }`}
              >
                <div className="flex justify-between items-center font-bold">
                  <span>
                    {lastSubmissionResult.success
                      ? 'EVENTO ACEPTADO (202 ACCEPTED)'
                      : 'FALLO EN INGESTA'}
                  </span>
                  <span>{lastSubmissionResult.latencyMs}ms</span>
                </div>
                {lastSubmissionResult.success ? (
                  <div className="text-[11px] space-y-0.5 text-zinc-300">
                    <div>
                      Event ID:{' '}
                      <span className="text-zinc-100 font-bold">
                        {lastSubmissionResult.data?.eventId ||
                          lastSubmissionResult.data?.id}
                      </span>
                    </div>
                    <div>
                      Correlation ID:{' '}
                      <span className="text-zinc-400">
                        {lastSubmissionResult.data?.correlationId}
                      </span>
                    </div>
                    <div>
                      Deduplicated:{' '}
                      <span
                        className={
                          lastSubmissionResult.data?.deduplicated
                            ? 'text-amber-400 font-bold'
                            : 'text-emerald-400'
                        }
                      >
                        {String(lastSubmissionResult.data?.deduplicated)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-rose-200 break-words">
                    {lastSubmissionResult.error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Receptor Control & Live Feed */}
        <div className="space-y-4">
          {/* Live Receptor Control */}
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Receptor Simulation Control
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Simula el estado del servidor externo que recibe el webhook (prueba qué ocurre si se cae o responde lento).
                </p>
              </div>
              <Badge statusText={sinkMode} size="sm" className="self-start sm:self-auto shrink-0">
                MODE: {sinkMode}
              </Badge>
            </div>

            {/* Mode Toggle Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleModeChange('HEALTHY')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-2 sm:p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'HEALTHY'
                    ? 'border-emerald-600 bg-emerald-950/80 text-emerald-300 font-bold ring-1 ring-emerald-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">HEALTHY</span>
                <span className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-full">
                  200 OK
                </span>
              </button>

              <button
                onClick={() => handleModeChange('SLOW')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-2 sm:p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'SLOW'
                    ? 'border-amber-600 bg-amber-950/80 text-amber-300 font-bold ring-1 ring-amber-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">SLOW</span>
                <span className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-full">
                  Timeout (&gt;5s)
                </span>
              </button>

              <button
                onClick={() => handleModeChange('DOWN')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-2 sm:p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'DOWN'
                    ? 'border-rose-600 bg-rose-950/80 text-rose-300 font-bold ring-1 ring-rose-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">DOWN</span>
                <span className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-full">
                  503 Error
                </span>
              </button>
            </div>
          </div>

          {/* Live Sink Event Feed */}
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Live Receptor Webhook Feed
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Inspección en tiempo real de los webhooks recibidos y verificación criptográfica de la firma HMAC-SHA256.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                <button
                  onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    autoRefreshLogs
                      ? 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-500'
                  }`}
                  title="Toggle automatic 3-second polling"
                >
                  Live Polling: {autoRefreshLogs ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => loadSinkLogs()}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Manual refresh"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  onClick={handleClearLogs}
                  className="p-1 rounded text-zinc-500 hover:text-rose-400 transition-colors"
                  title="Clear buffer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Feed List */}
            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {sinkLogs.length === 0 ? (
                <div className="p-8 text-center text-zinc-600 font-mono text-xs border border-dashed border-zinc-800/80 rounded">
                  No hay webhooks recibidos aún. Dispara un evento a la izquierda para observar la entrega.
                </div>
              ) : (
                sinkLogs.map((log) => {
                  const signatureStatus =
                    log.signatureValid === true
                      ? 'VALID'
                      : log.signatureValid === false
                        ? 'INVALID'
                        : 'UNSIGNED';

                  return (
                    <div
                      key={log.id}
                      className="border border-zinc-800/90 rounded bg-zinc-950 p-3 space-y-2 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400 text-[11px]">
                            {new Date(log.receivedAt).toLocaleTimeString()}
                          </span>
                          <Badge
                            statusText={signatureStatus}
                            size="sm"
                          >
                            HMAC: {signatureStatus}
                          </Badge>
                        </div>
                        <span className="text-[10px] text-zinc-500">
                          Modo del receptor: {log.modeAtReceipt}
                        </span>
                      </div>

                      {/* Header snippet */}
                      <div className="text-[10px] text-zinc-400 flex flex-wrap gap-x-3 gap-y-1">
                        {log.headers?.['x-hookrelay-delivery-id'] && (
                          <span>
                            Delivery:{' '}
                            <span className="text-zinc-200">
                              {log.headers['x-hookrelay-delivery-id'].slice(0, 8)}...
                            </span>
                          </span>
                        )}
                        {log.headers?.['x-hookrelay-event-id'] && (
                          <span>
                            Event:{' '}
                            <span className="text-zinc-200">
                              {log.headers['x-hookrelay-event-id'].slice(0, 8)}...
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Payload preview */}
                      <div className="bg-[#0c0c0e] border border-zinc-800/80 rounded p-2 overflow-x-auto text-[11px] text-zinc-300">
                        <pre>
                          {typeof log.body === 'string'
                            ? log.body
                            : JSON.stringify(log.body, null, 2)}
                        </pre>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
