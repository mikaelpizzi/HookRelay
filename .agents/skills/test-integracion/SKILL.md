---
name: test-integracion
description: Estrategia de pruebas de integración para HookRelay. Activar al escribir o ejecutar tests que involucren PostgreSQL, Redis, BullMQ, HMAC, SSRF o el emulador de AWS S3. Define qué probar, cómo levantar el entorno y qué aserciones son obligatorias.
---

# Estrategia de Tests de Integración — HookRelay

## Principio fundamental
En un sistema asíncrono, los tests unitarios con mocks artificiales no validan el comportamiento real. Los tests de integración deben correr contra PostgreSQL, Redis y el emulador de AWS S3 reales, levantados en Docker o como servicios en GitHub Actions.

## Entorno de pruebas
Antes de ejecutar cualquier suite E2E:
```bash
docker compose up -d postgres redis aws-emulator
```
Las variables apuntan a los servicios locales:
- `DATABASE_URL=postgresql://app_user:app_password@localhost:5432/hookrelay_test`
- `REDIS_URL=redis://localhost:6379/1` (DB 1 para tests, DB 0 para desarrollo)
- `AWS_ENDPOINT_URL=http://localhost:9297`

## Suites obligatorias

### 1. `crypto.spec.ts` (Unitaria)
- Genera firma HMAC-SHA256 sobre un payload conocido y verifica el digest.
- Verifica con `timingSafeEqual` que la firma correcta sea aceptada.
- Altera 1 byte del payload y confirma rechazo.
- Envía timestamp `t=` con > 300s de antigüedad y confirma rechazo (anti-replay).

### 2. `ssrf-guard.spec.ts` (Unitaria + Integración)
- Valida que `resolveAndValidateHost()` bloquee: `127.0.0.1`, `10.0.0.5`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `::1`, `fe80::1`.
- Verifica que `SafeHttpTransport` aborte la conexión TCP antes de enviar datos.
- Confirma que dominios públicos legítimos sí pasan la validación.

### 3. `ingest-concurrency.e2e-spec.ts` (Integración)
- Dispara 50 `POST /api/v1/events` simultáneas (`Promise.all`) con el mismo `Idempotency-Key`.
- Aserta: exactamente 1 fila en `events`, 1 `Delivery` creado, 49 respuestas con `200 OK` y mismo `eventId`.
- Crea dos tenants distintos, envía eventos con el mismo `idempotency_key` desde ambos.
- Verifica que RLS impide que el Tenant A vea eventos del Tenant B.

### 4. `dispatcher-chaos.e2e-spec.ts` (Integración / Caos HTTP)
- Levanta un servidor `node:http` efímero que responde `503` las primeras 3 veces.
- Verifica cálculo correcto de Exponential Backoff + Jitter entre intentos.
- Confirma que `trg_update_endpoint_circuit` cambia `circuit_status` a `OPEN` al alcanzar `failure_threshold`.
- Verifica que el Worker NO hace peticiones HTTP mientras el circuito está `OPEN`.
- Confirma transición `OPEN` → `HALF_OPEN` tras el período de enfriamiento.
- Restaura servidor a `200 OK` y verifica entrega exitosa (`DELIVERED`).

### 5. `archiver-s3.e2e-spec.ts` (Integración / AWS S3)
- Inserta registros en una partición antigua de `delivery_attempts`.
- Ejecuta `ArchiverService` contra el emulador local de AWS.
- Descarga el objeto `.jsonl.gz` desde S3 y descomprime.
- Verifica que el contenido descomprimido coincide con los registros originales.
- Confirma que la partición fue eliminada de PostgreSQL.
- Confirma que `trg_prevent_audit_mutation` sigue bloqueando UPDATE/DELETE en particiones activas.

## Aserciones de calidad
- Todo test debe limpiar sus datos al inicio (`TRUNCATE ... CASCADE` o transacciones con rollback).
- Los tests de concurrencia deben usar `Promise.all()` real, no loops secuenciales.
- Los tests de red deben cerrar el servidor efímero en `afterAll()`.
- Ningún test debe depender de orden de ejecución.
