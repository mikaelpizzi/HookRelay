# Directivas del Proyecto — HookRelay (Event Dispatcher Engine)

## Contexto del Proyecto
Motor de despacho confiable de eventos y webhooks. Infraestructura B2B multi-tenant que garantiza entrega At-Least-Once mediante colas diferidas, firma HMAC-SHA256, reintentos con Exponential Backoff + Jitter y Circuit Breakers.

Referencia arquitectónica completa: @./docs/ARCHITECTURE.md

## Stack Tecnológico
- **Backend:** NestJS + TypeScript (monolito modular, cero microservicios)
- **Base de datos:** PostgreSQL 16 (SQL nativo via Prisma + `$queryRaw` para concurrencia)
- **Colas:** Redis 7 + BullMQ (reintentos diferidos, backoff nativo)
- **Frontend:** Next.js (App Router) + Tailwind CSS
- **AWS:** `@aws-sdk/client-s3` (archivado frío contra emulador local o Supabase S3 en producción)
- **Infraestructura:** Docker Compose (local), Terraform (definición AWS), GitHub Actions (CI/CD)

## Fronteras Estrictas (Anti-Sobreingeniería)
- **PROHIBIDO** fragmentar en microservicios, usar gRPC, Kafka, RabbitMQ o bases NoSQL.
- **PROHIBIDO** usar S3 en el camino crítico de ingesta o despacho (solo archivado frío > 30 días).
- **PROHIBIDO** crear ORMs personalizados; usar Prisma para consultas estándar y `$queryRaw` solo donde se necesite `FOR UPDATE SKIP LOCKED` o bloqueos de fila.
- **PROHIBIDO** mockear PostgreSQL o Redis en tests de integración; usar contenedores reales.
- El backend completo (API + Worker + Demo Sink) debe funcionar en un único proceso NestJS con ≤ 512 MB RAM.

## Lenguaje Ubicuo (Nomenclatura Obligatoria)
Usar exclusivamente estos términos en código, SQL, API y UI:
- **Tenant:** Organización aislada dueña de claves, tópicos y endpoints.
- **ApiKey:** Credencial de autenticación (solo se almacena hash SHA-256 + prefijo visible).
- **EventTopic:** Tipo de evento formal con JSON Schema de validación.
- **Event:** Hecho inmutable enviado por la app emisora.
- **Endpoint:** URL HTTPS destino con secreto HMAC y estado de Circuit Breaker.
- **Subscription:** Regla que vincula Endpoint + EventTopic + Entorno.
- **Delivery:** Obligación de entregar un Event a un Endpoint suscrito.
- **DeliveryAttempt:** Registro inmutable (append-only) de cada ejecución HTTP POST.
- **PROHIBIDO** usar "message", "notification", "task" o "job" para referirse a estas entidades.

## Estructura de Módulos del Backend
```
apps/api/src/modules/
├── auth/          # Validación API Keys (SHA-256), contexto RLS del Tenant
├── catalog/       # EventTopics, validación JSON Schema (Ajv)
├── endpoints/     # CRUD Endpoints, Suscripciones 5FN, validación anti-SSRF
├── ingest/        # POST /api/v1/events, idempotencia, backpressure, señal outbox.wake
├── dispatcher/    # Outbox Poller adaptativo, Worker BullMQ, firma HMAC, cliente HTTP seguro
├── archiver/      # Serialización .jsonl.gz, upload S3, detach/drop de particiones
└── demo-sink/     # Receptor HTTP configurable (200/503/timeout) para demos en vivo
```

## Jerarquía de Bloqueos en PostgreSQL (Obligatoria)
Toda transacción concurrente debe respetar este orden estricto:
1. `events` (primero)
2. `deliveries` (segundo)
3. `delivery_attempts` → dispara trigger que actualiza `webhook_endpoints` (último)

**PROHIBIDO** modificar `webhook_endpoints` antes de insertar en `delivery_attempts` dentro de la misma transacción.

## Puertos e Interfaces (Arquitectura Hexagonal Ligera)
Los módulos `dispatcher` y `archiver` dependen de interfaces en `shared/ports/`:
- `ArchiveStoragePort` — implementado por `S3ArchiveAdapter`
- `WebhookTransportPort` — implementado por `UndiciWebhookTransportAdapter`
- `QueuePort` — implementado por `BullMqQueueAdapter`

Las implementaciones concretas se inyectan via el contenedor de NestJS; los servicios de dominio nunca importan `@aws-sdk/*` ni `undici` directamente.

## Ciclo de Cierre para Subagentes
Antes de reportar al agente padre, validar siempre:
1. `npx tsc --noEmit` (cero errores de tipos)
2. `npm run lint` (cero warnings)
3. `npm run test` (si hay tests del módulo tocado)
4. `git add . && git commit -m "tipo(alcance): descripción"`

## Servicios Activos Esperados en Desarrollo
- API NestJS: `http://localhost:3000`
- Dashboard Next.js: `http://localhost:3001`
- PostgreSQL: `localhost:5432` (db: `hookrelay`, user: `app_user`)
- Redis: `localhost:6379`
- AWS Emulator (S3): `http://localhost:9297`
