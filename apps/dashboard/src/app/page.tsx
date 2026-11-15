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
} from 'lucide-react';
import { useTenant } from '../context/tenant-context';
import { Badge } from '../components/ui/badge';
import { DemoSinkLogEntry, DemoSinkMode, EventTopic } from '../lib/types';

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
      setTimeout(() => setFlowStep(2), 250);

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

      // Step 3: Receptor externo recibe el webhook
      setTimeout(() => {
        setFlowStep(3);

        // Disparar toast según el modo del receptor
        if (sinkMode === 'HEALTHY') {
          setToast({
            id: String(Date.now()),
            type: 'success',
            title: 'Webhook entregado exitosamente (200 OK)',
            message:
              'HookRelay validó el contrato JSON, aseguró la persistencia en Outbox, firmó con HMAC-SHA256 y el servidor receptor confirmó la recepción.',
            details: `Latencia de ingesta: ${latencyMs}ms | Event ID: ${result?.id || 'Generado'}`,
          });
        } else if (sinkMode === 'DOWN') {
          setToast({
            id: String(Date.now()),
            type: 'warning',
            title: 'Receptor caído (503): En cola de reintentos',
            message:
              'El servidor externo rechazó la conexión. HookRelay activó el Backoff Exponencial con Jitter y reintentará automáticamente sin perder datos.',
            details: 'Estado de entrega: RETRYING | Fallos consecutivos incrementados en Circuit Breaker',
          });
        } else if (sinkMode === 'SLOW') {
          setToast({
            id: String(Date.now()),
            type: 'warning',
            title: 'Timeout de respuesta (>5s): Reintento programado',
            message:
              'El servidor externo tardó más del límite de seguridad. HookRelay abortó el socket TCP para proteger los hilos y programó el reintento.',
            details: 'Tiempo de espera agotado (>5000ms) | Reintento automático agendado',
          });
        }
      }, 750);

      // Refresh logs shortly after to show incoming dispatch
      setTimeout(() => loadSinkLogs(), 900);
      setTimeout(() => loadSinkLogs(), 2200);

      // Reset flow animation
      setTimeout(() => setFlowStep(0), 3000);
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
    <div className="p-6 max-w-7xl mx-auto space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 max-w-md w-full animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`p-4 rounded-lg border shadow-xl backdrop-blur-md flex items-start gap-3 ${
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
      <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-4.5 space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
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
              sinkMode === 'HEALTHY'
                ? '3/3 Entregado al receptor (200 OK)'
                : sinkMode === 'DOWN'
                  ? '3/3 Servidor caído (503) -> En cola de reintentos'
                  : '3/3 Timeout detectado (>5s) -> Reintento programado'
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch relative">
          {/* Paso 1: Tu App Emisora */}
          <div
            className={`p-3.5 rounded-lg border transition-all duration-300 ${
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
            className={`p-3.5 rounded-lg border transition-all duration-300 ${
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
            className={`p-3.5 rounded-lg border transition-all duration-300 ${
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Event Generator */}
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Event Dispatch Generator
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Simula tu aplicación enviando una notificación de negocio en tiempo real.
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {Object.keys(SAMPLE_PAYLOADS).map((tplName) => (
                  <button
                    key={tplName}
                    onClick={() => handleTemplateSelect(tplName)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                      selectedTopic === tplName
                        ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
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
              <div className="flex gap-2">
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
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
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
                placeholder="e.g. idem_98a72b0c (garantiza entrega única si la red reintenta)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
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
                rows={10}
                className={`w-full bg-[#0c0c0e] font-mono text-xs text-zinc-300 p-3 rounded border leading-relaxed focus:outline-hidden ${
                  payloadError ? 'border-rose-800/80' : 'border-zinc-800 focus:border-zinc-700'
                }`}
                spellCheck={false}
              />
            </div>

            {/* Trigger Button */}
            <button
              onClick={handleTriggerEvent}
              disabled={isSubmitting || !!payloadError}
              className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded text-xs font-semibold tracking-wide transition-all ${
                isSubmitting || !!payloadError
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold border border-emerald-500'
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
                        {lastSubmissionResult.data?.id}
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
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Receptor Simulation Control
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Simula el estado del servidor externo que recibe el webhook (prueba qué ocurre si se cae o responde lento).
                </p>
              </div>
              <Badge statusText={sinkMode} size="sm">
                MODE: {sinkMode}
              </Badge>
            </div>

            {/* Mode Toggle Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleModeChange('HEALTHY')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'HEALTHY'
                    ? 'border-emerald-600 bg-emerald-950/80 text-emerald-300 font-bold ring-1 ring-emerald-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">HEALTHY</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">
                  200 OK (~5ms)
                </span>
              </button>

              <button
                onClick={() => handleModeChange('SLOW')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'SLOW'
                    ? 'border-amber-600 bg-amber-950/80 text-amber-300 font-bold ring-1 ring-amber-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">SLOW</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">
                  Timeout (6000ms)
                </span>
              </button>

              <button
                onClick={() => handleModeChange('DOWN')}
                disabled={isChangingMode}
                className={`flex flex-col items-center justify-center p-3 rounded border text-xs font-mono transition-all ${
                  sinkMode === 'DOWN'
                    ? 'border-rose-600 bg-rose-950/80 text-rose-300 font-bold ring-1 ring-rose-500'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <span className="text-xs font-bold">DOWN</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">
                  503 Service Unavail
                </span>
              </button>
            </div>
          </div>

          {/* Live Sink Event Feed */}
          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-mono">
                  Live Receptor Webhook Feed
                </span>
                <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Inspección en tiempo real de los webhooks recibidos y verificación criptográfica de la firma HMAC-SHA256.
                </p>
              </div>
              <div className="flex items-center gap-2">
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
