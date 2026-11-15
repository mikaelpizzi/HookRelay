# Plan de Implementación — HookRelay

## Objetivo
Construir un Motor de Despacho Confiable de Eventos y Webhooks como segundo proyecto de portafolio. Este plan está diseñado para ser ejecutado fase por fase por agentes de desarrollo (Gemini Flash 3.8 / Hydrogen) usando las directivas definidas en `AGENTS.md`, `GEMINI.md` global y las Skills del proyecto.

> [!IMPORTANT]
> Antes de iniciar cualquier fase, el agente debe leer `AGENTS.md` en la raíz del proyecto y `docs/ARCHITECTURE.md` para contexto completo.

---

## Fase 0 — Scaffolding del Monorepo y Entorno Docker

### Meta
Proyecto NestJS y Next.js levantados con Docker Compose funcional. PostgreSQL ejecutando `schema.sql`, Redis respondiendo y AWS Emulator corriendo.

### Tareas
1. Inicializar repositorio Git con `.gitignore` existente.
2. Crear `apps/api/` como proyecto NestJS:
   - `npm init` + dependencias: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@prisma/client`, `prisma`, `bullmq`, `ioredis`, `ajv`, `pino`, `pino-pretty`, `@aws-sdk/client-s3`, `undici`.
   - Dev deps: `@nestjs/testing`, `typescript`, `@types/node`, `eslint`, `jest`, `ts-jest`, `supertest`.
   - `tsconfig.json` con `strict: true`, `esModuleInterop: true`, target ES2022.
   - ESLint con reglas TypeScript (sin Prettier, configuración mínima).
3. Crear `apps/dashboard/` como proyecto Next.js (App Router):
   - `npx create-next-app@latest --typescript --tailwind --app --src-dir --no-import-alias`.
   - Variable de entorno: `NEXT_PUBLIC_API_URL=http://localhost:3000`.
4. Verificar `docker-compose.yml` existente:
   - `docker compose up -d` debe levantar Postgres, Redis y AWS Emulator.
   - `psql` contra el contenedor debe mostrar las tablas del `schema.sql`.
5. Configurar Prisma apuntando a `DATABASE_URL` con `prisma init --datasource-provider postgresql`.
   - Generar `prisma/schema.prisma` que refleje las tablas de `database/schema.sql`.
   - **No usar migraciones de Prisma para la estructura inicial** (ya está en `schema.sql`); usar `prisma db pull` para generar el schema desde la DB existente.
6. Crear script `npm run start:dev` que levante NestJS en modo watch.

### Criterio de cierre
- `docker compose up -d` → 3 contenedores healthy.
- `npx prisma generate` → cliente generado sin errores.
- `npm run start:dev` en `apps/api/` → servidor en `:3000` respondiendo `GET /health` con `{ status: "ok" }`.
- `npm run dev` en `apps/dashboard/` → página en `:3001`.
- Commit: `chore(scaffold): initialize monorepo with NestJS, Next.js, Docker Compose and Prisma`.

---

## Fase 1 — Módulo de Autenticación y Contexto Multi-Tenant

### Meta
API Keys funcionales con hash SHA-256, Guard de autenticación y contexto RLS por transacción.

### Tareas
1. **AuthModule** (`apps/api/src/modules/auth/`):
   - `ApiKeyGuard` (NestJS Guard): Extrae `X-API-Key` del header, calcula `crypto.createHash('sha256').update(key).digest('hex')`, busca en `api_keys` donde `revoked_at IS NULL` y `(expires_at IS NULL OR expires_at > NOW())`.
   - Inyecta `tenantId` y `environment` en el objeto `Request`.
   - Actualiza `last_used_at` de forma asíncrona (sin bloquear la respuesta).
2. **Middleware RLS**: Interceptor que ejecuta `SET LOCAL app.current_tenant_id = $1` al inicio de cada transacción Prisma para operaciones del Dashboard.
3. **Endpoint de provisión** (para desarrollo/demo):
   - `POST /api/v1/tenants` → Crea tenant con slug.
   - `POST /api/v1/tenants/:id/api-keys` → Genera clave con `crypto.randomBytes(32)`, devuelve el texto plano **una sola vez**, persiste solo `key_hash` y `key_prefix` (primeros 8 caracteres).
4. **Seed de demo**: Script que crea un tenant "Demo Corp" con una API Key y tópicos de ejemplo.

### Criterio de cierre
- Petición con `X-API-Key` válida → 200. Sin clave → 401. Clave revocada → 401.
- RLS impide acceso cruzado entre tenants (verificar con test manual contra psql).
- Commit: `feat(auth): implement API Key guard with SHA-256 hashing and RLS tenant context`.

---

## Fase 2 — Catálogo de Tópicos y Validación JSON Schema

### Meta
EventTopics registrables por tenant con JSON Schema de validación compilado y cacheado.

### Tareas
1. **CatalogModule** (`apps/api/src/modules/catalog/`):
   - CRUD de `event_topics` con validación de formato `nombre.subnombre` (regex del CHECK en DB).
   - Almacena `payload_schema` como JSONB.
   - Servicio `SchemaValidatorService`: compila JSON Schemas con Ajv al cargar y los cachea en un `Map<topicId, ValidateFunction>`. Invalida caché al actualizar el tópico.
2. Endpoints REST:
   - `GET /api/v1/topics` — Lista tópicos del tenant (RLS).
   - `POST /api/v1/topics` — Crea tópico con nombre y schema.
   - `PATCH /api/v1/topics/:id` — Actualiza descripción o schema.

### Criterio de cierre
- Crear tópico `payment.succeeded` con schema `{ type: "object", required: ["amount", "currency"] }`.
- Payload válido pasa. Payload sin `amount` → error de validación con detalle del campo faltante.
- Commit: `feat(catalog): event topics with JSON Schema validation and Ajv caching`.

---

## Fase 3 — Endpoints, Suscripciones 5FN y Validación Anti-SSRF

### Meta
Endpoints registrables con secreto HMAC, suscripciones descompuestas en 5FN y validación SSRF al registrar.

### Tareas
1. **EndpointsModule** (`apps/api/src/modules/endpoints/`):
   - `POST /api/v1/endpoints` — Registra URL, genera `signing_secret` con `crypto.randomBytes(32).toString('hex')` prefijado `whsec_`, valida que la URL no apunte a IPs privadas.
   - `GET /api/v1/endpoints` — Lista con métricas (usa `v_endpoint_health_metrics`).
   - `PATCH /api/v1/endpoints/:id` — Activa/desactiva, cambia URL (re-valida SSRF).
   - `DELETE /api/v1/endpoints/:id` — Soft delete (`is_active = false`).
2. **SsrfValidatorService** (`apps/api/src/modules/endpoints/ssrf-validator.service.ts`):
   - Resuelve hostname con `dns.lookup()`.
   - Valida IP contra rangos bloqueados (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7, fe80::/10).
   - Rechaza con `400 Bad Request` y mensaje claro.
3. **Suscripciones 5FN**:
   - `POST /api/v1/endpoints/:id/subscriptions` — Asocia tópico(s) por entorno.
   - Inserta en las tres tablas de proyección binaria (`endpoint_environments`, `topic_environments`, `endpoint_topic_subscriptions`).
   - `GET /api/v1/endpoints/:id/subscriptions` — Lee de `v_active_subscriptions`.

### Criterio de cierre
- Registrar endpoint `https://example.com/webhook` → OK con secreto devuelto.
- Registrar `http://127.0.0.1:8080` → `400 SSRF_BLOCKED`.
- Registrar `http://169.254.169.254/latest/meta-data/` → `400 SSRF_BLOCKED`.
- Suscribir endpoint a tópico en PRODUCTION → aparece en `v_active_subscriptions`.
- Commit: `feat(endpoints): CRUD with HMAC secret, 5NF subscriptions and SSRF validation`.

---

## Fase 4 — Ingesta Transaccional con Idempotencia y Backpressure

### Meta
Endpoint de ingesta respondiendo en < 25 ms con garantía de persistencia, idempotencia y control de contrapresión.

### Tareas
1. **IngestModule** (`apps/api/src/modules/ingest/`):
   - `POST /api/v1/events` — Recibe `{ topic, data, idempotencyKey? }`.
   - Valida payload contra JSON Schema del tópico (SchemaValidatorService).
   - Genera `correlation_id` desde header `X-Correlation-Id` o `crypto.randomUUID()`.
   - Si no se envía `idempotencyKey`, genera uno con `crypto.randomUUID()`.
   - **Backpressure**: Antes de transacción, consulta `queue.getWaitingCount()`. Si > 5000 → `429 Too Many Requests` con `Retry-After: 10`.
   - **Transacción**: `INSERT INTO events ... ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.
     - Si insert retorna fila → nuevo evento, emite `outbox.wake`, responde `202 Accepted` con `{ eventId }`.
     - Si no retorna fila → duplicado, busca el existente, responde `200 OK` con `{ eventId, deduplicated: true }`.
2. **EventEmitter interno**: Usa `@nestjs/event-emitter` para emitir `outbox.wake` sin acoplamiento directo.

### Criterio de cierre
- `POST /events` con payload válido → `202` en < 25 ms (medir con `console.time`).
- Segundo POST con mismo `idempotencyKey` → `200` con `deduplicated: true`, sin fila nueva en DB.
- POST con cola > 5000 (simulado) → `429`.
- POST con payload inválido contra schema → `422` con detalle del error.
- Commit: `feat(ingest): transactional event ingestion with idempotency, schema validation and backpressure`.

---

## Fase 5 — Outbox Poller Adaptativo y Creación de Deliveries

### Meta
Proceso que toma eventos PENDING, resuelve suscripciones y los encola en BullMQ, suspendiéndose cuando no hay trabajo.

### Tareas
1. **OutboxPollerService** (`apps/api/src/modules/dispatcher/outbox-poller.service.ts`):
   - Escucha evento `outbox.wake` y al arrancar el servidor.
   - Ejecuta ciclos de `processNextBatch(batchSize = 100)`:
     - `SELECT id, topic_id, environment FROM events WHERE status = 'PENDING' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`.
     - Usa `v_active_subscriptions` para resolver endpoints suscritos.
     - `INSERT INTO deliveries (event_id, endpoint_id, max_attempts) ... ON CONFLICT DO NOTHING`.
     - `UPDATE events SET status = 'DISPATCHED' WHERE id = ANY($1)`.
     - `queue.addBulk(deliveries)` en BullMQ.
   - **Suspensión adaptativa**: Si el lote devuelve 0 filas, detiene el timer (`clearInterval`). Solo se reactiva con el siguiente `outbox.wake`. Esto permite que Neon (scale-to-zero) suspenda cómputo.
2. **Reconciliación de seguridad**: Al arrancar el servidor, procesa un lote para recuperar eventos que quedaron PENDING si el proceso anterior murió.

### Criterio de cierre
- Ingestar 5 eventos → los 5 aparecen como deliveries en BullMQ.
- Si no hay eventos PENDING, el poller no ejecuta consultas (verificar con `pg_stat_activity`).
- Ingestar evento con 3 endpoints suscritos → 3 deliveries creados.
- Commit: `feat(dispatcher): adaptive outbox poller with FOR UPDATE SKIP LOCKED and BullMQ enqueue`.

---

## Fase 6 — Firma HMAC-SHA256 y Cliente HTTP Seguro

### Meta
Servicios de firma criptográfica y transporte HTTP con DNS Pinning anti-SSRF.

### Tareas
1. **HmacSignerService** (`apps/api/src/modules/dispatcher/hmac-signer.service.ts`):
   - `signPayload(rawBody, secret, timestamp?)`: Calcula `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`, retorna `t=${timestamp},v1=${hex}`.
   - `verifySignature(rawBody, header, secret, toleranceSec = 300)`: Parsea `t=` y `v1=`, verifica ventana temporal, compara con `crypto.timingSafeEqual()`.
2. **SafeHttpTransport** (`apps/api/src/modules/dispatcher/safe-http-transport.ts`):
   - Implementa `WebhookTransportPort`.
   - Usa `undici` con `Agent` configurado con `connect.lookup` personalizado que invoca `resolveAndValidateHost()` (DNS Pinning).
   - `connectTimeout: 1500`, `bodyTimeout: 5000`.
   - Excepción controlada: permite destinos que coincidan con `DEMO_SINK_URL` del `.env`.
3. **SsrfGuard** (`apps/api/src/modules/dispatcher/ssrf-guard.ts`):
   - `isPrivateOrReservedIp(ip)`: Valida contra tabla de CIDRs bloqueados (IPv4 + IPv6).
   - `resolveAndValidateHost(hostname)`: `dns.lookup()` → valida → retorna IP segura.

### Criterio de cierre
- Firma sobre payload conocido produce digest verificable.
- Alterar 1 byte del payload → verificación falla.
- Timestamp con > 300s de antigüedad → verificación falla.
- `resolveAndValidateHost('localhost')` → lanza `SSRF_BLOCKED`.
- Commit: `feat(dispatcher): HMAC-SHA256 signer with anti-replay and safe HTTP transport with DNS pinning`.

---

## Fase 7 — Worker BullMQ (Despacho, Backoff y Circuit Breaker)

### Meta
Procesador de trabajos que ejecuta el despacho HTTP, registra intentos y gestiona reintentos con backoff exponencial y circuit breaker.

### Tareas
1. **DispatcherProcessor** (`apps/api/src/modules/dispatcher/dispatcher.processor.ts`):
   - Registra procesador BullMQ para cola `dispatch-webhook`.
   - Por cada job:
     a. Lee Delivery, Event y Endpoint. Si `delivery.status === 'DELIVERED'` o `endpoint.is_active === false` → retorna sin acción.
     b. **Circuit Breaker check**:
        - Si `OPEN` y `NOW() - circuit_opened_at < 60s` → reprograma job con delay 60s **sin incrementar `attempt_count`**.
        - Si `OPEN` y expiró → actualiza a `HALF_OPEN` (sonda de recuperación).
     c. Firma payload con `HmacSignerService`.
     d. Envía POST con `SafeHttpTransport` incluyendo headers: `X-Webhook-Signature`, `X-Webhook-Delivery-Id`, `X-Correlation-Id`, `Content-Type: application/json`.
     e. **Registro transaccional** (respetando jerarquía de bloqueos):
        - Inserta en `delivery_attempts` (el trigger `fn_update_endpoint_circuit` se ejecuta automáticamente).
        - Si `is_success`: `delivery.status = 'DELIVERED'`, `delivered_at = NOW()`.
        - Si falló y `attempt_count + 1 < max_attempts`: `delivery.status = 'RETRYING'`, calcula `next_retry_at`, reencola con `delay`.
        - Si agotó intentos: `delivery.status = 'DEAD_LETTER'`.
2. **Cálculo de delay**:
   ```
   baseDelay = 60_000 * Math.pow(2, attemptNumber - 1)
   jitter = Math.floor(Math.random() * 30_000)
   delay = baseDelay + jitter
   ```
3. **Graceful Shutdown**: Captura `SIGTERM` → `worker.close()` → espera jobs in-flight → cierra proceso.

### Criterio de cierre
- Ingestar evento con endpoint saludable → DeliveryAttempt con `is_success: true`, Delivery en `DELIVERED`.
- Endpoint que responde 503 → reintento programado con delay correcto.
- 5 fallos consecutivos → Delivery en `DEAD_LETTER`, endpoint `circuit_status = 'OPEN'`.
- Circuito abierto → worker no hace HTTP, reprograma sin consumir intento.
- Commit: `feat(dispatcher): BullMQ worker with exponential backoff, circuit breaker and HMAC signing`.

---

## Fase 8 — Receptor de Prueba en Vivo (Demo Sink)

### Meta
Endpoint interno configurable que simula un servidor receptor para demos sin dependencias externas.

### Tareas
1. **DemoSinkModule** (`apps/api/src/modules/demo-sink/`):
   - `POST /api/demo/webhook-sink` — Recibe webhooks como si fuera un servidor externo.
     - Verifica la firma HMAC usando `HmacSignerService.verifySignature()` con el secreto del endpoint demo.
     - Comportamiento controlado por variable en memoria (no en DB):
       - `HEALTHY` → 200 OK con `{ received: true, signatureValid: boolean }`.
       - `DOWN` → 503 Service Unavailable.
       - `SLOW` → `await sleep(6000)` → timeout del worker.
   - `PUT /api/demo/webhook-sink/mode` — Cambia el modo (`HEALTHY` | `DOWN` | `SLOW`).
   - `GET /api/demo/webhook-sink/mode` — Devuelve el modo actual.
   - `GET /api/demo/webhook-sink/log` — Devuelve los últimos 50 webhooks recibidos (en memoria, circular buffer).

### Criterio de cierre
- Despachar webhook al sink en modo HEALTHY → 200, firma verificada.
- Cambiar a DOWN → 503, worker entra en reintento.
- Cambiar a SLOW → timeout tras 5s, worker registra error.
- Commit: `feat(demo-sink): configurable webhook receiver for live demonstrations`.

---

## Fase 9 — Archivado en Frío hacia S3

### Meta
Proceso programado que migra particiones antiguas de `delivery_attempts` hacia S3 en formato comprimido.

### Tareas
1. **S3ArchiveAdapter** (`apps/api/src/modules/archiver/s3-archive.adapter.ts`):
   - Implementa `ArchiveStoragePort`.
   - `S3Client` con `forcePathStyle: true` y `endpoint` desde `AWS_ENDPOINT_URL`.
   - `onModuleInit()`: verifica bucket con `HeadBucketCommand`, crea con `CreateBucketCommand` si no existe.
   - `uploadArchive(key, stream)`: `PutObjectCommand` con verificación de ETag.
2. **ArchiverService** (`apps/api/src/modules/archiver/archiver.service.ts`):
   - Cron configurable (diario por defecto, deshabilitado si `ARCHIVER_ENABLED=false`).
   - Identifica particiones de `delivery_attempts` con datos > 30 días.
   - `ALTER TABLE delivery_attempts DETACH PARTITION <nombre>`.
   - Lee filas con cursor en bloques de 5,000 → serializa JSON Lines → comprime con `zlib.createGzip()`.
   - Sube a S3 bajo clave `archives/delivery_attempts/year=YYYY/month=MM/dump.jsonl.gz`.
   - Tras confirmar 200 + ETag → `DROP TABLE <partición>`.
3. **Creación proactiva de particiones**: Al arrancar, verifica que existan particiones para el mes actual y el siguiente. Si no, las crea.

### Criterio de cierre
- Ejecutar archivado contra AWS Emulator → objeto `.jsonl.gz` en bucket.
- Descargar y descomprimir → contenido coincide con registros originales.
- Partición eliminada de PostgreSQL.
- `trg_prevent_audit_mutation` sigue bloqueando UPDATE/DELETE en particiones activas.
- Commit: `feat(archiver): cold storage archival to S3 with partition detach and gzip compression`.

---

## Fase 10 — Dashboard Operativo (Next.js)

### Meta
Panel funcional con 4 vistas, acceso demo sin registro y estética de herramienta de ingeniería.

### Tareas
1. **Layout base**:
   - Sidebar con navegación: Demo, Endpoints, Entregas, Configuración.
   - Barra superior con indicador de estado del backend (verde/rojo) y nombre del tenant.
   - Banner de cold-start si `GET /health` tarda > 5s.
   - Tipografía monoespaciada (Geist Mono / JetBrains Mono) para datos técnicos.
   - Paleta neutra (#FAFAFA fondo claro, #09090B fondo oscuro).
2. **Vista Demo Sandbox**:
   - Botón "Entrar como Tenant Demo" (carga credenciales preconfiguradas, 0 registro).
   - Selector de tópico de ejemplo + editor JSON editable.
   - Botón "Disparar Evento" → `POST /api/v1/events`.
   - Interruptor del receptor: 200 OK / 503 Error / Timeout.
   - Log en tiempo real de webhooks recibidos por el sink con resultado de verificación de firma.
3. **Vista Salud de Endpoints**:
   - Tabla con datos de `v_endpoint_health_metrics`.
   - Columnas: URL, entorno, tasa éxito 24h (%), latencia promedio (ms), badge de circuito.
   - Botón "Reiniciar Circuito" por endpoint.
4. **Vista Inspector de Entregas**:
   - Lista paginada filtrable por estado (`DELIVERED`, `RETRYING`, `DEAD_LETTER`) y `correlation_id`.
   - Panel lateral (Drawer) al seleccionar: timeline de intentos, cabeceras enviadas, cuerpo de respuesta/error, latencia.
   - Botón "Replay" → reencola delivery con prioridad alta.
5. **Vista Configuración**:
   - Alta/edición de endpoints con validación SSRF en tiempo real.
   - Matriz de suscripción (tópicos × entornos).
   - Generación de API Keys con modal que muestra el secreto una sola vez.

### Criterio de cierre
- Demo funcional sin registro: entrar, disparar evento, ver entrega en tiempo real.
- Cambiar receptor a DOWN, disparar 5 eventos, ver reintentos, ver circuito abierto.
- Restaurar receptor, hacer Replay, ver entrega exitosa.
- Commit: `feat(dashboard): operational dashboard with demo sandbox, health metrics, delivery inspector and config`.

---

## Fase 11 — Suite de Pruebas Automatizadas

### Meta
5 suites de tests cubriendo criptografía, SSRF, concurrencia, caos de red y archivado S3.

### Tareas
Implementar las 5 suites definidas en la skill `test-integracion`:
1. `crypto.spec.ts` — Firma HMAC, verificación, anti-replay.
2. `ssrf-guard.spec.ts` — Bloqueo de IPs privadas/reservadas.
3. `ingest-concurrency.e2e-spec.ts` — 50 peticiones simultáneas, idempotencia, RLS.
4. `dispatcher-chaos.e2e-spec.ts` — Servidor caótico, backoff, circuit breaker.
5. `archiver-s3.e2e-spec.ts` — Archivado contra emulador, verificación de integridad.

### Criterio de cierre
- Las 5 suites pasan en verde localmente contra Docker Compose.
- `npm run test:unit` y `npm run test:e2e` definidos en `package.json`.
- Commit: `test(core): integration and chaos tests for HMAC, SSRF, concurrency, backoff and S3 archival`.

---

## Fase 12 — CI/CD, README y Pulido Final

### Meta
Pipeline de GitHub Actions verde, README de arquitectura y preparación para despliegue.

### Tareas
1. Verificar que `.github/workflows/ci.yml` existente pase en GitHub.
2. **README.md** (documento de arquitectura, NO marketing):
   - Diagrama de flujo (Mermaid).
   - Sección "Architectural Decisions & Trade-offs" (monolito vs microservicios, BullMQ vs SQS, Outbox vs dual-write).
   - Instrucciones exactas: `docker compose up -d && npm run start:dev`.
   - Screenshots o GIFs del dashboard en acción.
   - Sección de despliegue gratuito (Vercel + Render + Neon + Redis Cloud + Supabase).
3. Terraform: verificar que `terraform fmt` y `terraform validate` pasen.
4. Seed de datos demo completo para que `docker compose up` + `npm run seed` deje todo listo.

### Criterio de cierre
- CI verde en GitHub.
- `README.md` con diagrama, trade-offs y comandos de levantamiento.
- Terraform validado.
- Commit: `docs(readme): architecture documentation with trade-offs, deployment guide and Mermaid diagrams`.

---

## Fase 13 — Despliegue Público Gratuito

### Meta
Aplicación accesible en internet a $0 permanentes.

### Tareas
1. **Neon** (PostgreSQL): Crear proyecto, copiar `DATABASE_URL`, ejecutar `schema.sql` + seed.
2. **Redis Cloud**: Crear instancia free (30 MB), copiar `REDIS_URL`.
3. **Supabase Storage**: Crear bucket privado, obtener endpoint S3-compatible, configurar credenciales.
4. **Render** (Backend): Crear Web Service, conectar repo GitHub, configurar variables de entorno, health check en `/health`.
5. **Vercel** (Frontend): Importar `apps/dashboard/`, configurar `NEXT_PUBLIC_API_URL`.
6. **UptimeRobot** (opcional): Monitor `GET /health` cada 10 min para evitar cold starts.
7. Verificar demo pública funcional de punta a punta.

### Criterio de cierre
- URL pública del dashboard accesible.
- Demo funcional: disparar evento, ver entrega, simular fallo, ver reintento, replay exitoso.
- Todo gratuito y sin tarjeta de crédito.

---

## Notas para Agentes

> [!TIP]
> - Usar `/plan` antes de cada fase para proponer la estructura antes de editar.
> - Invocar `self` para cada fase de implementación, manteniendo libre el chat principal.
> - Leer la skill `cierre-seguro` para el protocolo de validación y commit.
> - Leer la skill `esquema-db` antes de modificar cualquier tabla, vista o trigger.
> - Leer la skill `test-integracion` antes de escribir tests.
> - Cada fase debe terminar con un commit semántico (ver mensajes sugeridos arriba).
> - El documento `docs/ARCHITECTURE.md` contiene los algoritmos de referencia con pseudocódigo.

> [!WARNING]
> - **NO** usar `git reset --hard`, `git restore .` ni `docker compose down -v`.
> - **NO** crear microservicios, repositorios separados ni bases de datos adicionales.
> - **NO** mockear PostgreSQL ni Redis en tests de integración.
> - **NO** usar S3 en el hot path (ingesta o despacho).
> - **NO** generar nombres marketeros ni emojis.
