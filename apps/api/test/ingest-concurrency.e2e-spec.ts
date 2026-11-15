import * as crypto from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';

describe('Ingest Concurrency, Idempotency & RLS Isolation (E2E / Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Tenant A identifiers
  let tenantAId: string;
  let rawApiKeyA: string;

  // Tenant B identifiers
  let tenantBId: string;
  let rawApiKeyB: string;

  const topicName = 'order.created';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    // Ensure dedicated non-superuser role exists for PostgreSQL RLS validation
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hookrelay_test_tenant') THEN
          CREATE ROLE hookrelay_test_tenant NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
          GRANT USAGE ON SCHEMA public TO hookrelay_test_tenant;
          GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hookrelay_test_tenant;
        END IF;
      END
      $$;
    `);

    // 1. Provision Tenant A & API Key
    const tenantA = await prisma.tenants.create({
      data: {
        name: 'Tenant Alpha E2E',
        slug: `tenant-alpha-${crypto.randomUUID()}`,
      },
    });
    tenantAId = tenantA.id;

    rawApiKeyA = `hr_live_${crypto.randomBytes(24).toString('hex')}`;
    const hashA = crypto.createHash('sha256').update(rawApiKeyA).digest('hex');
    await prisma.api_keys.create({
      data: {
        tenant_id: tenantAId,
        name: 'Alpha Ingest Key',
        key_prefix: rawApiKeyA.slice(0, 8),
        key_hash: hashA,
        environment: 'PRODUCTION',
      },
    });

    await prisma.event_topics.create({
      data: {
        tenant_id: tenantAId,
        name: topicName,
        description: 'Order created topic for Alpha',
        payload_schema: {
          type: 'object',
          required: ['orderId', 'amount'],
          properties: {
            orderId: { type: 'string' },
            amount: { type: 'number' },
          },
        },
      },
    });

    // 2. Provision Tenant B & API Key
    const tenantB = await prisma.tenants.create({
      data: {
        name: 'Tenant Beta E2E',
        slug: `tenant-beta-${crypto.randomUUID()}`,
      },
    });
    tenantBId = tenantB.id;

    rawApiKeyB = `hr_live_${crypto.randomBytes(24).toString('hex')}`;
    const hashB = crypto.createHash('sha256').update(rawApiKeyB).digest('hex');
    await prisma.api_keys.create({
      data: {
        tenant_id: tenantBId,
        name: 'Beta Ingest Key',
        key_prefix: rawApiKeyB.slice(0, 8),
        key_hash: hashB,
        environment: 'PRODUCTION',
      },
    });

    await prisma.event_topics.create({
      data: {
        tenant_id: tenantBId,
        name: topicName,
        description: 'Order created topic for Beta',
        payload_schema: {
          type: 'object',
          required: ['orderId', 'amount'],
          properties: {
            orderId: { type: 'string' },
            amount: { type: 'number' },
          },
        },
      },
    });
  });

  afterAll(async () => {
    // Clean up test tenants and dependent entities via cascading DB foreign keys
    try {
      if (prisma) {
        if (tenantAId) {
          await prisma.events.deleteMany({ where: { tenant_id: tenantAId } });
          await prisma.event_topics.deleteMany({ where: { tenant_id: tenantAId } });
          await prisma.api_keys.deleteMany({ where: { tenant_id: tenantAId } });
          await prisma.tenants.delete({ where: { id: tenantAId } });
        }
        if (tenantBId) {
          await prisma.events.deleteMany({ where: { tenant_id: tenantBId } });
          await prisma.event_topics.deleteMany({ where: { tenant_id: tenantBId } });
          await prisma.api_keys.deleteMany({ where: { tenant_id: tenantBId } });
          await prisma.tenants.delete({ where: { id: tenantBId } });
        }
      }
    } catch (cleanupError) {
      console.warn('Failed cleaning up test tenants in ingest-concurrency:', cleanupError);
    }

    if (app) {
      await app.close();
    }
  });

  describe('50 Concurrent Ingestion Requests with identical idempotencyKey', () => {
    it('should process 50 simultaneous POSTs, creating exactly 1 event and deduplicating 49', async () => {
      const sharedIdempotencyKey = `idem-race-${crypto.randomUUID()}`;
      const payload = {
        topic: topicName,
        data: {
          orderId: 'ord-concurrent-100',
          amount: 250.75,
        },
        idempotencyKey: sharedIdempotencyKey,
      };

      const CONCURRENCY_COUNT = 50;

      // Dispatch 50 simultaneous HTTP requests over Promise.all
      const requests = Array.from({ length: CONCURRENCY_COUNT }).map((_, index) =>
        request(app.getHttpServer())
          .post('/api/v1/events')
          .set('X-API-Key', rawApiKeyA)
          .set('X-Correlation-Id', `corr-req-${index}`)
          .send(payload),
      );

      const responses = await Promise.all(requests);

      // Status code distribution assertions
      const acceptedResponses = responses.filter((res: any) => res.status === 202);
      const deduplicatedResponses = responses.filter((res: any) => res.status === 200);

      expect(acceptedResponses.length).toBe(1);
      expect(deduplicatedResponses.length).toBe(CONCURRENCY_COUNT - 1);

      // Verify payloads
      const firstEventId = acceptedResponses[0].body.eventId;
      expect(firstEventId).toBeDefined();
      expect(acceptedResponses[0].body.deduplicated).toBe(false);

      for (const dedupRes of deduplicatedResponses) {
        expect(dedupRes.body.eventId).toBe(firstEventId);
        expect(dedupRes.body.deduplicated).toBe(true);
      }

      // Verify exact database state
      const databaseEvents = await prisma.events.findMany({
        where: {
          tenant_id: tenantAId,
          idempotency_key: sharedIdempotencyKey,
        },
      });

      expect(databaseEvents.length).toBe(1);
      expect(databaseEvents[0].id).toBe(firstEventId);
      expect(databaseEvents[0].status).toBe('PENDING');
    });
  });

  describe('Multi-tenant composite uniqueness on (tenant_id, idempotency_key)', () => {
    it('should allow two different tenants to use the identical idempotencyKey without collision', async () => {
      const crossTenantIdempotencyKey = `cross-tenant-idem-${crypto.randomUUID()}`;

      // Tenant A dispatches with this idempotency key
      const resA = await request(app.getHttpServer())
        .post('/api/v1/events')
        .set('X-API-Key', rawApiKeyA)
        .send({
          topic: topicName,
          data: { orderId: 'ord-alpha-1', amount: 50 },
          idempotencyKey: crossTenantIdempotencyKey,
        });

      expect(resA.status).toBe(202);
      expect(resA.body.deduplicated).toBe(false);

      // Tenant B dispatches with the identical idempotency key
      const resB = await request(app.getHttpServer())
        .post('/api/v1/events')
        .set('X-API-Key', rawApiKeyB)
        .send({
          topic: topicName,
          data: { orderId: 'ord-beta-1', amount: 90 },
          idempotencyKey: crossTenantIdempotencyKey,
        });

      // Crucial: Tenant B must succeed with 202 rather than being falsely deduplicated as Tenant A
      expect(resB.status).toBe(202);
      expect(resB.body.deduplicated).toBe(false);
      expect(resB.body.eventId).not.toBe(resA.body.eventId);

      // Both events exist under their respective tenant records
      const eventA = await prisma.events.findUnique({
        where: { id: resA.body.eventId },
      });
      const eventB = await prisma.events.findUnique({
        where: { id: resB.body.eventId },
      });

      expect(eventA?.tenant_id).toBe(tenantAId);
      expect(eventB?.tenant_id).toBe(tenantBId);
      expect(eventA?.idempotency_key).toBe(crossTenantIdempotencyKey);
      expect(eventB?.idempotency_key).toBe(crossTenantIdempotencyKey);
    });
  });

  describe('Row-Level Security (RLS) Multi-Tenant Isolation', () => {
    it('should prevent Tenant A from reading Tenant B events through RLS context', async () => {
      // Query events setting PostgreSQL session variable to Tenant A under non-bypass role
      const tenantAVisibleEvents = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE hookrelay_test_tenant');
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_tenant_id', '${tenantAId}', true)`,
        );
        return tx.$queryRawUnsafe<Array<{ id: string; tenant_id: string }>>(
          'SELECT id, tenant_id FROM events',
        );
      });

      // Query events setting PostgreSQL session variable to Tenant B under non-bypass role
      const tenantBVisibleEvents = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE hookrelay_test_tenant');
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_tenant_id', '${tenantBId}', true)`,
        );
        return tx.$queryRawUnsafe<Array<{ id: string; tenant_id: string }>>(
          'SELECT id, tenant_id FROM events',
        );
      });

      expect(tenantAVisibleEvents.length).toBeGreaterThan(0);
      expect(tenantBVisibleEvents.length).toBeGreaterThan(0);

      // Guarantee strict disjoint isolation: no event of Tenant B is visible to Tenant A
      for (const event of tenantAVisibleEvents) {
        expect(event.tenant_id).toBe(tenantAId);
        expect(event.tenant_id).not.toBe(tenantBId);
      }

      for (const event of tenantBVisibleEvents) {
        expect(event.tenant_id).toBe(tenantBId);
        expect(event.tenant_id).not.toBe(tenantAId);
      }
    });
  });
});
