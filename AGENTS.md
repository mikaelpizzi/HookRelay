# Directivas del Proyecto — HookRelay (Event Dispatcher Engine)

Arquitectura: @./docs/ARCHITECTURE.md | Plan de fases: @./docs/IMPLEMENTATION_PLAN.md

## 1. Stack y Monorepo
- **Backend (`apps/api`):** NestJS, Prisma (`db pull` únicamente, nunca `migrate`), BullMQ, `ioredis`, `ajv`, `undici`, `@aws-sdk/client-s3`.
- **Frontend (`apps/dashboard`):** Next.js (App Router), TypeScript estricto, Tailwind CSS.
- **Servicios locales (`docker-compose.yml`):** PostgreSQL 16 (`:5432`), Redis 7 (`:6379`), AWS Emulator (`:9297`).

## 2. Invariantes de Ingeniería
- **Monolito Modular:** Prohibido dividir en microservicios o crear bases de datos adicionales.
- **Fuente de Verdad SQL:** `database/schema.sql`. Tras cambios en SQL: `npx prisma db pull && npx prisma generate`.
- **Lenguaje Ubicuo Obligatorio:** `Tenant`, `ApiKey`, `EventTopic`, `Event`, `Endpoint`, `Subscription`, `Delivery`, `DeliveryAttempt`. Prohibido usar "message" o "notification".
- **Jerarquía de Bloqueos:** `events` → `deliveries` → `delivery_attempts` (dispara trigger en `webhook_endpoints`).
- **Aislamiento Multi-Tenant:** Consultas del Dashboard bajo RLS (`SET LOCAL app.current_tenant_id`). Worker con rol `BYPASSRLS`.
- **Outbox Adaptativo:** El poller entra en reposo absoluto (0 queries a Postgres) cuando `status = 'PENDING'` llega a 0.

## 3. Protocolo de Ejecución por Fases
- Una sola fase a la vez según `docs/IMPLEMENTATION_PLAN.md`.
- Proponer estructura antes de tocar código.
- Invocar `self` para la implementación pesada manteniendo libre el chat principal.
- Skills activas en `.agents/skills/`: `esquema-db`, `test-integracion` y `cierre-seguro`.

## 4. Comandos de Verificación Obligatorios
Antes de cerrar cualquier tarea o fase:
- **Backend:** `npm --prefix apps/api run lint && npx --prefix apps/api tsc --noEmit`
- **Frontend:** `npm --prefix apps/dashboard run lint && npx --prefix apps/dashboard tsc --noEmit`
- **Tests:** `npm --prefix apps/api run test:unit` (o test de integración según la fase).
