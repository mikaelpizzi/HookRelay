import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { Readable } from 'stream';
import { PrismaClient } from '@prisma/client';
import { ArchiverService } from '../src/modules/archiver/archiver.service';
import {
  ArchiveStoragePort,
  UploadArchiveResult,
} from '../src/modules/archiver/ports/archive-storage.port';

class InMemoryArchiveStorageAdapter implements ArchiveStoragePort {
  public archives = new Map<string, Buffer>();

  async ensureBucketExists(): Promise<void> {
    // In-memory bucket is always initialized and ready
  }

  async uploadArchive(
    key: string,
    bufferOrStream: Buffer | Uint8Array | Readable,
  ): Promise<UploadArchiveResult> {
    let buffer: Buffer;
    if (Buffer.isBuffer(bufferOrStream)) {
      buffer = bufferOrStream;
    } else if (bufferOrStream instanceof Uint8Array) {
      buffer = Buffer.from(bufferOrStream);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of bufferOrStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    }

    this.archives.set(key, buffer);
    return { eTag: `mock-etag-${crypto.randomBytes(8).toString('hex')}` };
  }

  async getArchive(key: string): Promise<Buffer> {
    const archive = this.archives.get(key);
    if (!archive) {
      throw new Error(`Cold storage object not found for key "${key}"`);
    }
    return archive;
  }
}

describe('Partition Archiver & S3 Storage Verification (E2E / Integration)', () => {
  let prisma: PrismaClient;
  let archiverService: ArchiverService;
  let storageAdapter: InMemoryArchiveStorageAdapter;

  const testPartitionName = 'delivery_attempts_2020_01';
  const testPartitionFrom = '2020-01-01 00:00:00+00';
  const testPartitionTo = '2020-02-01 00:00:00+00';

  let tenantId: string;
  let topicId: string;
  let endpointId: string;
  let deliveryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    storageAdapter = new InMemoryArchiveStorageAdapter();
    archiverService = new ArchiverService(prisma as any, storageAdapter);

    // 1. Provision supporting parent records in PostgreSQL
    const tenant = await prisma.tenants.create({
      data: {
        name: 'Archiver E2E Tenant',
        slug: `archiver-tenant-${crypto.randomUUID()}`,
      },
    });
    tenantId = tenant.id;

    const topic = await prisma.event_topics.create({
      data: {
        tenant_id: tenantId,
        name: 'order.archived',
        payload_schema: { type: 'object' },
      },
    });
    topicId = topic.id;

    const endpoint = await prisma.webhook_endpoints.create({
      data: {
        tenant_id: tenantId,
        url: 'https://example.com/archived-webhook',
        signing_secret: 'whsec_archiver_test_secret',
        is_active: true,
      },
    });
    endpointId = endpoint.id;

    const event = await prisma.events.create({
      data: {
        tenant_id: tenantId,
        topic_id: topicId,
        environment: 'PRODUCTION',
        idempotency_key: `archiver-idem-${crypto.randomUUID()}`,
        correlation_id: `archiver-corr-${crypto.randomUUID()}`,
        payload: { archived: true },
        status: 'DISPATCHED',
      },
    });

    const delivery = await prisma.deliveries.create({
      data: {
        event_id: event.id,
        endpoint_id: endpointId,
        status: 'DELIVERED',
        attempt_count: 2,
        max_attempts: 5,
      },
    });
    deliveryId = delivery.id;

    // 2. Ensure test partition table exists attached to delivery_attempts
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${testPartitionName}" PARTITION OF delivery_attempts
      FOR VALUES FROM ('${testPartitionFrom}') TO ('${testPartitionTo}');
    `);
  });

  afterAll(async () => {
    try {
      // Ensure test partition is dropped if test failed prematurely
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${testPartitionName}"`);
    } catch {
      // Ignore partition cleanup error
    } finally {
      await prisma.$disconnect();
    }
  });

  describe('Cold Storage Archival of Elapsed Partitions', () => {
    const attempt1Id = crypto.randomUUID();
    const attempt2Id = crypto.randomUUID();

    it('should seed old records (> 30 days) into the target partition', async () => {
      // Direct insertion respecting partitioned table boundaries
      await prisma.$executeRawUnsafe(`
        INSERT INTO delivery_attempts (
          id,
          delivery_id,
          endpoint_id,
          attempt_number,
          is_success,
          http_status,
          latency_ms,
          error_code,
          request_headers,
          created_at
        ) VALUES
        (
          '${attempt1Id}'::uuid,
          '${deliveryId}'::uuid,
          '${endpointId}'::uuid,
          1,
          FALSE,
          500,
          120,
          'INTERNAL_ERROR',
          '{"Content-Type": "application/json"}'::jsonb,
          '2020-01-15 10:00:00+00'::timestamptz
        ),
        (
          '${attempt2Id}'::uuid,
          '${deliveryId}'::uuid,
          '${endpointId}'::uuid,
          2,
          TRUE,
          200,
          45,
          NULL,
          '{"Content-Type": "application/json"}'::jsonb,
          '2020-01-15 10:01:00+00'::timestamptz
        );
      `);

      const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) FROM "${testPartitionName}"`,
      );
      expect(Number(countRows[0].count)).toBe(2);
    });

    it('should execute ArchiverService, detaching partition and uploading .jsonl.gz archive', async () => {
      const summary = await archiverService.archiveOldPartitions(30);

      expect(summary.archivedCount).toBeGreaterThanOrEqual(1);

      const targetResult = summary.partitions.find(
        (p) => p.partitionName === testPartitionName,
      );
      expect(targetResult).toBeDefined();
      expect(targetResult?.rowCount).toBe(2);
      expect(targetResult?.s3Key).toBe(
        'archives/delivery_attempts/year=2020/month=01/delivery_attempts_2020_01.jsonl.gz',
      );
      expect(targetResult?.eTag).toBeDefined();
      expect(targetResult?.compressedBytes).toBeGreaterThan(0);
    });

    it('should download .jsonl.gz from storage, decompress via zlib, and verify records match original data', async () => {
      const s3Key =
        'archives/delivery_attempts/year=2020/month=01/delivery_attempts_2020_01.jsonl.gz';
      const compressedBuffer = await storageAdapter.getArchive(s3Key);

      // Decompress gzip payload
      const uncompressed = zlib.gunzipSync(compressedBuffer);
      const text = uncompressed.toString('utf-8').trim();

      const lines = text.split('\n');
      expect(lines.length).toBe(2);

      const record1 = JSON.parse(lines[0]);
      const record2 = JSON.parse(lines[1]);

      // Assert record 1
      expect(record1.id).toBe(attempt1Id);
      expect(record1.delivery_id).toBe(deliveryId);
      expect(record1.attempt_number).toBe(1);
      expect(record1.is_success).toBe(false);
      expect(record1.http_status).toBe(500);
      expect(record1.error_code).toBe('INTERNAL_ERROR');

      // Assert record 2
      expect(record2.id).toBe(attempt2Id);
      expect(record2.delivery_id).toBe(deliveryId);
      expect(record2.attempt_number).toBe(2);
      expect(record2.is_success).toBe(true);
      expect(record2.http_status).toBe(200);
      expect(record2.latency_ms).toBe(45);
    });

    it('should confirm the partition table was detached and dropped from PostgreSQL', async () => {
      const checkTable = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM pg_class WHERE relname = '${testPartitionName}'`,
      );

      expect(checkTable.length).toBe(0);
    });
  });

  describe('PostgreSQL Audit Immutability Trigger (trg_prevent_audit_mutation)', () => {
    let activeAttemptId: string;

    beforeAll(async () => {
      // Ensure current month partition exists
      await archiverService.ensureFuturePartitions();

      // Insert an attempt row into the active partition
      activeAttemptId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(`
        INSERT INTO delivery_attempts (
          id,
          delivery_id,
          endpoint_id,
          attempt_number,
          is_success,
          http_status,
          latency_ms,
          request_headers
        ) VALUES (
          '${activeAttemptId}'::uuid,
          '${deliveryId}'::uuid,
          '${endpointId}'::uuid,
          1,
          TRUE,
          200,
          30,
          '{}'::jsonb
        );
      `);
    });

    it('should reject UPDATE operations on delivery_attempts with Security violation error', async () => {
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE delivery_attempts
          SET http_status = 204
          WHERE id = '${activeAttemptId}'::uuid
        `),
      ).rejects.toThrow(
        /Security violation: delivery_attempts is append-only/,
      );
    });

    it('should reject DELETE operations on delivery_attempts with Security violation error', async () => {
      await expect(
        prisma.$executeRawUnsafe(`
          DELETE FROM delivery_attempts
          WHERE id = '${activeAttemptId}'::uuid
        `),
      ).rejects.toThrow(
        /Security violation: delivery_attempts is append-only/,
      );
    });
  });
});
