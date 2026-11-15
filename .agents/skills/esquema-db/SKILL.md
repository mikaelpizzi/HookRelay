---
name: esquema-db
description: Gestión del esquema SQL de PostgreSQL 16 para HookRelay. Activar cuando se modifiquen tablas, vistas, triggers, índices, particiones o políticas RLS. Contiene el modelo relacional normalizado hasta 5FN, restricciones CHECK, particionamiento declarativo y Row-Level Security.
---

# Gestión del Esquema de Base de Datos — HookRelay

## Principios de Modelado (No negociables)

### Normalización
- Tablas de configuración y suscripciones: normalizadas hasta **5FN** (descomposición en proyecciones binarias sin pérdida).
- Tabla `events.payload`: JSONB permitido (3FN/BCNF respecto a `event_id`) porque es un hecho histórico inmutable.
- Tabla `delivery_attempts.endpoint_id`: desnormalización controlada para evitar JOIN en triggers y covering indexes.

### Cero valores quemados
- Estados, entornos y tipos modelados con `CREATE TYPE ... AS ENUM`.
- Todo valor de negocio (tópicos, umbrales, políticas) en tablas de catálogo, nunca hardcodeados.
- Restricciones `CHECK` a nivel de motor para invariantes físicas.

### Particionamiento
- `delivery_attempts` particionada por `PARTITION BY RANGE (created_at)` con granularidad mensual.
- Crear particiones nuevas antes de que inicie el mes (job de mantenimiento o al arrancar la app).
- Archivar particiones antiguas con `DETACH PARTITION` + `DROP TABLE` (nunca `DELETE` masivo).

## Archivo fuente
El DDL completo vive en `database/schema.sql`. Toda modificación al esquema debe:
1. Editarse primero en `schema.sql`.
2. Generar la migración correspondiente en Prisma si aplica.
3. Probarse contra PostgreSQL 16 real en Docker (nunca contra SQLite ni mocks).

## Jerarquía de bloqueos
Toda transacción concurrente debe adquirir bloqueos en este orden:
`events` → `deliveries` → `delivery_attempts` → (trigger actualiza `webhook_endpoints`)

## Row-Level Security
- Activada con `FORCE` en: `api_keys`, `event_topics`, `webhook_endpoints`, `events`.
- La API establece `SET LOCAL app.current_tenant_id = '<uuid>'` en cada transacción de usuario.
- El Worker usa un rol con `BYPASSRLS` para procesar entregas de todos los tenants.

## Vistas obligatorias
| Vista | Propósito |
|-------|-----------|
| `v_active_subscriptions` | Recomposición 5FN: qué endpoints reciben qué eventos en qué entorno |
| `v_api_keys_public` | Seguridad: oculta `key_hash` de consultas administrativas |
| `v_endpoint_health_metrics` | Observabilidad: métricas 24h consolidadas para el Dashboard |

## Triggers obligatorios
| Trigger | Tabla | Acción |
|---------|-------|--------|
| `trg_*_updated_at` | `tenants`, `event_topics`, `webhook_endpoints`, `deliveries` | `BEFORE UPDATE` → `NOW()` |
| `trg_prevent_audit_mutation` | `delivery_attempts` | `BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION` |
| `trg_update_endpoint_circuit` | `delivery_attempts` | `AFTER INSERT` → Actualiza circuit breaker del endpoint |
