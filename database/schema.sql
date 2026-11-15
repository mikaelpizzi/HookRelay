-- ============================================================================
-- HookRelay — Event Dispatcher Engine
-- PostgreSQL 16 — Schema DDL Completo
-- ============================================================================

-- ============================================================================
-- 1. DOMINIOS CONTROLADOS (Cero valores quemados en código)
-- ============================================================================
CREATE TYPE environment_type AS ENUM ('SANDBOX', 'PRODUCTION');
CREATE TYPE event_status     AS ENUM ('PENDING', 'DISPATCHED');
CREATE TYPE delivery_status  AS ENUM ('PENDING', 'IN_FLIGHT', 'DELIVERED', 'RETRYING', 'DEAD_LETTER');
CREATE TYPE circuit_state    AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- ============================================================================
-- 2. NÚCLEO MULTI-TENANT Y CATÁLOGO
-- ============================================================================
CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(120) NOT NULL CHECK (char_length(trim(name)) >= 2),
    slug        VARCHAR(60)  NOT NULL UNIQUE CHECK (slug ~* '^[a-z0-9-]+$'),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    key_prefix   VARCHAR(16)  NOT NULL,
    key_hash     CHAR(64)     NOT NULL UNIQUE,
    environment  environment_type NOT NULL DEFAULT 'PRODUCTION',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_api_key_dates CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE event_topics (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name           VARCHAR(120) NOT NULL CHECK (name ~* '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
    description    TEXT,
    payload_schema JSONB        NOT NULL DEFAULT '{"type": "object"}'::jsonb,
    max_attempts   SMALLINT     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_topic_name UNIQUE (tenant_id, name)
);

-- ============================================================================
-- 3. ENDPOINTS Y SUSCRIPCIONES (Descomposición 5FN)
-- ============================================================================
CREATE TABLE webhook_endpoints (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url                  TEXT          NOT NULL CHECK (url ~* '^https?://.+'),
    description          VARCHAR(255),
    signing_secret       VARCHAR(128)  NOT NULL,
    is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
    circuit_status       circuit_state NOT NULL DEFAULT 'CLOSED',
    consecutive_failures INTEGER       NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    failure_threshold    SMALLINT      NOT NULL DEFAULT 5 CHECK (failure_threshold BETWEEN 1 AND 50),
    circuit_opened_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE endpoint_environments (
    endpoint_id UUID             NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    environment environment_type NOT NULL,
    PRIMARY KEY (endpoint_id, environment)
);

CREATE TABLE topic_environments (
    topic_id    UUID             NOT NULL REFERENCES event_topics(id) ON DELETE CASCADE,
    environment environment_type NOT NULL,
    PRIMARY KEY (topic_id, environment)
);

CREATE TABLE endpoint_topic_subscriptions (
    endpoint_id UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    topic_id    UUID        NOT NULL REFERENCES event_topics(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (endpoint_id, topic_id)
);

-- ============================================================================
-- 4. INGESTA INMUTABLE Y ENTREGAS (Outbox & Delivery State Machine)
-- ============================================================================
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    topic_id        UUID             NOT NULL REFERENCES event_topics(id) ON DELETE RESTRICT,
    environment     environment_type NOT NULL,
    idempotency_key VARCHAR(128)     NOT NULL,
    correlation_id  VARCHAR(64)      NOT NULL,
    payload         JSONB            NOT NULL,
    status          event_status     NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE deliveries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      UUID            NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    endpoint_id   UUID            NOT NULL REFERENCES webhook_endpoints(id) ON DELETE RESTRICT,
    status        delivery_status NOT NULL DEFAULT 'PENDING',
    attempt_count SMALLINT        NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts  SMALLINT        NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    next_retry_at TIMESTAMPTZ,
    delivered_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_endpoint_delivery UNIQUE (event_id, endpoint_id)
);

-- ============================================================================
-- 5. AUDITORÍA PARTICIONADA POR RANGO (Append-Only)
-- ============================================================================
CREATE TABLE delivery_attempts (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    delivery_id      UUID        NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
    endpoint_id      UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE RESTRICT,
    attempt_number   SMALLINT    NOT NULL CHECK (attempt_number >= 1),
    is_success       BOOLEAN     NOT NULL,
    http_status      SMALLINT    CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
    latency_ms       INTEGER     NOT NULL CHECK (latency_ms >= 0),
    request_headers  JSONB       NOT NULL,
    response_body    TEXT,
    error_code       VARCHAR(64),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE delivery_attempts_2026_11 PARTITION OF delivery_attempts
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE delivery_attempts_2026_12 PARTITION OF delivery_attempts
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE delivery_attempts_2027_01 PARTITION OF delivery_attempts
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE delivery_attempts_default PARTITION OF delivery_attempts DEFAULT;

-- ============================================================================
-- 6. ÍNDICES ESTRATÉGICOS
-- ============================================================================

-- Índice parcial para el Outbox Poller (minúsculo en RAM)
CREATE INDEX idx_events_outbox_pending
    ON events (created_at ASC)
    WHERE status = 'PENDING';

-- Índice parcial para entregas activas
CREATE INDEX idx_deliveries_active_queue
    ON deliveries (next_retry_at ASC NULLS FIRST)
    WHERE status IN ('PENDING', 'RETRYING');

-- Covering Index para el Dashboard (evita saltos al heap)
CREATE INDEX idx_attempts_endpoint_metrics
    ON delivery_attempts (endpoint_id, created_at DESC)
    INCLUDE (is_success, http_status, latency_ms);

-- Lookup rápido de API Keys por hash
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;

-- Lookup de endpoints activos por tenant
CREATE INDEX idx_endpoints_tenant_active
    ON webhook_endpoints (tenant_id)
    WHERE is_active = TRUE;

-- ============================================================================
-- 7. VISTAS
-- ============================================================================

-- Recomposición 5FN: qué endpoints reciben qué eventos en qué entorno
CREATE VIEW v_active_subscriptions AS
SELECT
    e.tenant_id,
    e.id          AS endpoint_id,
    e.url         AS endpoint_url,
    e.signing_secret,
    e.circuit_status,
    t.id          AS topic_id,
    t.name        AS topic_name,
    t.max_attempts,
    ee.environment
FROM webhook_endpoints e
INNER JOIN endpoint_environments ee
    ON e.id = ee.endpoint_id
INNER JOIN endpoint_topic_subscriptions ets
    ON e.id = ets.endpoint_id
INNER JOIN event_topics t
    ON ets.topic_id = t.id
INNER JOIN topic_environments te
    ON t.id = te.topic_id AND ee.environment = te.environment
WHERE e.is_active = TRUE;

-- Seguridad: oculta key_hash de consultas administrativas
CREATE VIEW v_api_keys_public AS
SELECT
    id,
    tenant_id,
    name,
    key_prefix,
    environment,
    last_used_at,
    expires_at,
    revoked_at,
    created_at
FROM api_keys;

-- Observabilidad: métricas consolidadas 24h para el Dashboard
CREATE VIEW v_endpoint_health_metrics AS
SELECT
    e.id                   AS endpoint_id,
    e.tenant_id,
    e.url,
    e.is_active,
    e.circuit_status,
    e.consecutive_failures,
    COUNT(da.id) FILTER (WHERE da.created_at >= NOW() - INTERVAL '24 hours')
        AS total_attempts_24h,
    COUNT(da.id) FILTER (WHERE da.created_at >= NOW() - INTERVAL '24 hours' AND da.is_success)
        AS successful_attempts_24h,
    ROUND(
        COALESCE(
            AVG(da.latency_ms) FILTER (WHERE da.created_at >= NOW() - INTERVAL '24 hours'),
            0
        )::numeric, 2
    ) AS avg_latency_ms_24h
FROM webhook_endpoints e
LEFT JOIN delivery_attempts da
    ON e.id = da.endpoint_id
GROUP BY e.id;

-- ============================================================================
-- 8. FUNCIONES Y TRIGGERS
-- ============================================================================

-- Actualización automática de updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_topics_updated_at
    BEFORE UPDATE ON event_topics FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_endpoints_updated_at
    BEFORE UPDATE ON webhook_endpoints FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_deliveries_updated_at
    BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Inmutabilidad del log de auditoría (append-only estricto)
CREATE OR REPLACE FUNCTION fn_prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security violation: delivery_attempts is append-only. Use partition detachment for archiving.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_mutation
    BEFORE UPDATE OR DELETE ON delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_mutation();

-- Máquina de estados del Circuit Breaker tras cada intento HTTP
CREATE OR REPLACE FUNCTION fn_update_endpoint_circuit()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_success THEN
        UPDATE webhook_endpoints
        SET consecutive_failures = 0,
            circuit_status       = 'CLOSED',
            circuit_opened_at    = NULL
        WHERE id = NEW.endpoint_id
          AND (consecutive_failures > 0 OR circuit_status <> 'CLOSED');
    ELSE
        UPDATE webhook_endpoints
        SET consecutive_failures = consecutive_failures + 1,
            circuit_status = CASE
                WHEN (consecutive_failures + 1) >= failure_threshold THEN 'OPEN'::circuit_state
                ELSE circuit_status
            END,
            circuit_opened_at = CASE
                WHEN (consecutive_failures + 1) >= failure_threshold AND circuit_status <> 'OPEN' THEN NOW()
                ELSE circuit_opened_at
            END
        WHERE id = NEW.endpoint_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_endpoint_circuit
    AFTER INSERT ON delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION fn_update_endpoint_circuit();

-- ============================================================================
-- 9. ROW-LEVEL SECURITY (Aislamiento Multi-Tenant)
-- ============================================================================

ALTER TABLE api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_topics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;

ALTER TABLE api_keys          FORCE ROW LEVEL SECURITY;
ALTER TABLE event_topics      FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE events            FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_keys ON api_keys
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_topics ON event_topics
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_endpoints ON webhook_endpoints
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_events ON events
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
