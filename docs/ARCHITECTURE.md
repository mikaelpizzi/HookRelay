# Arquitectura Técnica — HookRelay (Event Dispatcher Engine)

## 1. Propósito Operativo

### Problema real
Los sistemas transaccionales (pasarelas de pago, e-commerce, ERPs) necesitan notificar cambios de estado a servidores externos. Hacer llamadas HTTP síncronas desde el flujo principal acopla la disponibilidad del emisor a la estabilidad de redes externas: si el receptor cae o tarda 15 segundos, se bloquean hilos, se pierden eventos o se duplican operaciones.

### Qué hace HookRelay
Plataforma de infraestructura B2B multi-tenant que desacopla emisores y receptores:
- **Para emisores:** Endpoint REST de ingesta rápida (< 25 ms) con idempotencia y respuesta `202 Accepted`.
- **Para receptores:** Entrega At-Least-Once con firma HMAC-SHA256, reintentos exponenciales y Circuit Breakers.
- **Para operaciones:** Dashboard con trazabilidad por intento HTTP, replay manual y receptor de prueba integrado.

---

## 2. Diagrama de Flujo Principal

```
[App Emisora]                                  [Servidor Receptor]
     │                                                ▲
     │ POST /api/v1/events                           │ POST (webhook firmado HMAC)
     │ X-API-Key + Idempotency-Key                   │ X-Webhook-Signature
     ▼                                                │
┌─────────────────────────────────────────────────────┤
│                    NestJS (Monolito Modular)        │
│                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌────────────┐│
│  │  Ingest   │───▶│ Outbox Poller │───▶│  Worker    ││──────┘
│  │  Module   │    │ (Adaptive)   │    │ (BullMQ)   ││
│  └──────────┘    └──────────────┘    └────────────┘│
│       │                │                    │       │
│       ▼                ▼                    ▼       │
│  ┌──────────────────────────────────────────────┐  │
│  │              PostgreSQL 16                    │  │
│  │  events │ deliveries │ delivery_attempts      │  │
│  │  (RLS)  │ (Outbox)   │ (Particionada)        │  │
│  └──────────────────────────────────────────────┘  │
│       │                                    │       │
│       │              ┌─────────┐          │       │
│       └──────────────▶│  Redis  │◀─────────┘       │
│                       │ BullMQ  │                   │
│                       └─────────┘                   │
│                                                     │
│  ┌────────────┐                    ┌──────────────┐│
│  │  Archiver   │───────────────────▶│ S3 (Frío)    ││
│  │  (Cron 30d) │                    │ .jsonl.gz    ││
│  └────────────┘                    └──────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## 3. Casos de Uso Nucleares

| ID    | Caso de Uso                     | Actor            | Resultado Esperado |
|-------|---------------------------------|------------------|--------------------|
| CU-01 | Provisionar Tenant y API Keys   | Administrador    | Clave devuelta una sola vez; solo hash SHA-256 persistido. |
| CU-02 | Registrar Endpoint y Suscripciones | Desarrollador | URL validada anti-SSRF, secreto HMAC generado, tópicos asociados por entorno. |
| CU-03 | Ingestar Evento Idempotente     | App Emisora      | `202 Accepted` en < 25 ms. Duplicados devuelven `200 OK` sin re-encolar. |
| CU-04 | Despachar Webhook               | Worker (Sistema) | Firma HMAC, POST con timeout 5s, registro de intento. Fallo → Backoff exponencial. |
| CU-05 | Operar y Reintentar Manualmente | Operador (UI)    | Inspección de cabeceras/error, reinicio de circuito, Replay con prioridad alta. |
| CU-06 | Archivar Historial Frío         | Cron (Sistema)   | Particiones > 30 días → `.jsonl.gz` en S3 → `DETACH` + `DROP` en PostgreSQL. |

---

## 4. Requisitos No Funcionales

### Rendimiento
- Latencia de ingesta: < 25 ms (p99) sin llamadas de red externas.
- Connection timeout saliente: 1,500 ms.
- Response timeout saliente: 5,000 ms.

### Reintentos
- Máximo 5 intentos por Delivery.
- Fórmula: `Delay = (60_000 × 2^(attempt-1)) + randomInt(0, 30_000)`.
- Secuencia aproximada: ~1 min → ~2 min → ~4 min → ~8 min → DEAD_LETTER.

### Contrapresión
- Si la cola BullMQ supera 5,000 trabajos: responder `429 Too Many Requests` con `Retry-After: 10`.

### Seguridad
- Firma saliente: `X-Webhook-Signature: t=<unix_ts>,v1=<hmac_sha256_hex>`.
- Anti-replay: rechazo si `|now - t| > 300 segundos`.
- Anti-SSRF: validación DNS/IP en el momento de abrir socket TCP (DNS Pinning).
- Rangos bloqueados: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`.

### Circuit Breaker
- Umbral: 5 fallos consecutivos (5xx o timeout) → estado `OPEN`.
- Enfriamiento: 60 segundos en `OPEN` → `HALF_OPEN` → 1 petición de prueba → `CLOSED` si éxito.

---

## 5. Esquema Relacional (Resumen)

### Tablas principales (5-6 tablas + 3 tablas de suscripción 5FN)

| Tabla | Rol | Particularidad |
|-------|-----|----------------|
| `tenants` | Organizaciones aisladas | Slug único, soft-delete con `is_active` |
| `api_keys` | Credenciales de emisores | Solo `key_hash` (SHA-256) + `key_prefix` visible |
| `event_topics` | Catálogo formal de tipos de evento | `payload_schema` JSONB para validación Ajv |
| `webhook_endpoints` | URLs destino con Circuit Breaker | `signing_secret`, `circuit_status`, `failure_threshold` |
| `endpoint_environments` | 5FN: Endpoint × Entorno | Proyección binaria |
| `topic_environments` | 5FN: Tópico × Entorno | Proyección binaria |
| `endpoint_topic_subscriptions` | 5FN: Endpoint × Tópico | Proyección binaria |
| `events` | Hechos inmutables con Outbox | `idempotency_key` único por tenant, `status: PENDING → DISPATCHED` |
| `deliveries` | Obligaciones de entrega | FSM: `PENDING → IN_FLIGHT → DELIVERED / RETRYING → DEAD_LETTER` |
| `delivery_attempts` | Log de auditoría append-only | **Particionada por mes**, trigger de Circuit Breaker |

### Vistas
- `v_active_subscriptions` — Recomposición 5FN para resolver suscripciones activas.
- `v_api_keys_public` — Oculta `key_hash` del frontend.
- `v_endpoint_health_metrics` — Métricas consolidadas 24h para el Dashboard.

### Triggers
- `fn_set_updated_at()` — Actualización automática de timestamps.
- `fn_prevent_audit_mutation()` — Inmutabilidad del log de auditoría.
- `fn_update_endpoint_circuit()` — Máquina de estados del Circuit Breaker.

### Row-Level Security
- Activada con `FORCE` en tablas de tenant.
- Variable de sesión: `app.current_tenant_id`.
- Worker con rol `BYPASSRLS`.

---

## 6. Algoritmos Críticos del Backend

### 6.1 Ingesta Transaccional
1. Guard extrae `X-API-Key`, calcula SHA-256, valida contra `api_keys`.
2. Verifica backpressure (cola < 5,000).
3. Valida payload contra JSON Schema del EventTopic (Ajv, cacheado).
4. `INSERT ... ON CONFLICT DO NOTHING` (idempotencia).
5. Emite `outbox.wake` en memoria.
6. Responde `202 Accepted`.

### 6.2 Outbox Poller Adaptativo (Ahorro de cómputo)
- Se activa por señal `outbox.wake` (ingesta nueva) o al arrancar.
- Procesa lotes con `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`.
- Crea `deliveries` usando `v_active_subscriptions`.
- Marca eventos como `DISPATCHED`.
- Encola en BullMQ con `addBulk`.
- **Cuando un lote devuelve 0 filas: se suspende completamente** (0 consultas a PostgreSQL hasta la siguiente ingesta). Esto permite que bases de datos scale-to-zero (Neon) no consuman horas de cómputo innecesarias.

### 6.3 Worker BullMQ (Despacho + Backoff + Circuit Breaker)
1. Lee Delivery, Event y Endpoint.
2. Si `circuit_status = OPEN` y no expiró enfriamiento → reprograma sin consumir intento.
3. Si expiró → `HALF_OPEN`, permite sonda.
4. Resuelve DNS y valida IP (anti-SSRF con DNS Pinning).
5. Firma HMAC-SHA256: `signedContent = ${timestamp}.${rawBody}`.
6. POST con `connectTimeout: 1500ms`, `bodyTimeout: 5000ms`.
7. Inserta `DeliveryAttempt` (trigger actualiza Circuit Breaker).
8. Éxito → `DELIVERED`. Fallo + intentos restantes → `RETRYING` + delay en BullMQ. Agotado → `DEAD_LETTER`.

### 6.4 Archivado S3 (Ciclo de vida del dato)
1. Identifica particiones cerradas > 30 días.
2. `DETACH PARTITION` (instantáneo, sin bloqueo).
3. Lee con cursor en bloques de 5,000 → serializa JSON Lines → comprime gzip.
4. `PutObjectCommand` al bucket S3.
5. Confirma ETag → `DROP TABLE` (libera espacio sin AUTOVACUUM).

---

## 7. Dashboard Operativo (Next.js)

### Vistas del panel

| Vista | Funcionalidad |
|-------|---------------|
| **Demo Sandbox** | Botón "Entrar como Tenant Demo" (0 registro). Selector de tópico, editor JSON, disparo de evento. Interruptor del receptor: 200 OK / 503 / Timeout. Muestra verificación de firma. |
| **Salud de Endpoints** | Tabla con URL, entorno, tasa éxito 24h (%), latencia promedio, badge de circuito. Botón reiniciar circuito. |
| **Inspector de Entregas** | Lista filtrable por estado y correlation_id. Panel lateral con timeline de intentos, cabeceras, cuerpo de respuesta/error. Botón Replay. |
| **Configuración** | Alta de endpoints (validación SSRF en tiempo real), matriz de suscripción, generación de API Keys (modal de secreto único). |

### Directrices UX
- Estética de herramienta de ingeniería (Linear, Stripe, Vercel). Fondo neutro, bordes sutiles.
- Tipografía monoespaciada para datos técnicos.
- Banner de cold-start si el backend está despertando (Render free tier).

---

## 8. Infraestructura

### Local (Docker Compose)
- `postgres:16-alpine` + schema.sql montado en `/docker-entrypoint-initdb.d/`.
- `redis:7-alpine` con `maxmemory 128mb --maxmemory-policy noeviction`.
- `amazon/aws-emulator:latest` en puerto 9297.

### Producción ($0)
| Componente | Proveedor | Notas |
|------------|-----------|-------|
| Frontend | Vercel (Hobby) | Deploy automático desde GitHub. |
| Backend | Render (Free) | Contenedor único, 512 MB RAM, 750 h/mes. |
| PostgreSQL | Neon (Free) | 1 GB permanente. Scale-to-zero compatible con Outbox Adaptativo. |
| Redis | Redis Cloud (Free 30 MB) | Sin límite de comandos (no usar Upstash para BullMQ). |
| S3 | Supabase Storage (S3 Protocol) | `forcePathStyle: true`, mismas llamadas que emulador local. |

### IaC (Terraform — Validación sin cuenta AWS)
- `/infra/terraform/`: VPC, subnets, ECS Fargate, RDS, ElastiCache, S3 Lifecycle, IAM.
- CI ejecuta `terraform fmt -check` y `terraform validate` sin credenciales.

### CI/CD (GitHub Actions)
- Servicios: Postgres + Redis + AWS Emulator.
- Pasos: tests E2E → Terraform validate → build Docker.

---

## 9. Despliegue Gratuito — Guardrails de Cuota

### Outbox Poller Adaptativo
El poller detiene toda consulta cuando `PENDING = 0`, permitiendo que Neon suspenda cómputo. Un `outbox.wake` reactiva el ciclo al instante.

### BullMQ en Redis Cloud
Redis Cloud Free no limita comandos mensuales. BullMQ puede hacer polling sin agotar cuota (a diferencia de Upstash que tiene 500K comandos/mes).

### Render Cold Start
Un monitor gratuito (UptimeRobot o cron-job.org) hace `GET /health` cada 10 min durante semanas de entrevistas. El dashboard muestra un banner de arranque en vez de errores de red.

### Demo sin fricción
Botón "Entrar como Tenant Demo" carga credenciales preconfiguradas. El receptor de prueba vive dentro del mismo contenedor. Cero dependencia de servidores externos del visitante.
