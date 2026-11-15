import * as zlib from 'zlib';
import { ArchiverService, getPartitionDefinitionForMonth } from './archiver.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArchiveStoragePort } from './ports/archive-storage.port';

describe('ArchiverService', () => {
  let service: ArchiverService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockStorageAdapter: jest.Mocked<ArchiveStoragePort>;

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PrismaService>;

    mockStorageAdapter = {
      ensureBucketExists: jest.fn().mockResolvedValue(undefined),
      uploadArchive: jest.fn().mockResolvedValue({ eTag: 'mock-etag-1234' }),
      getArchive: jest.fn().mockResolvedValue(Buffer.from('')),
    };

    service = new ArchiverService(mockPrisma, mockStorageAdapter);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('getPartitionDefinitionForMonth helper', () => {
    it('should generate correct partition bounds for mid-year date', () => {
      const date = new Date(Date.UTC(2026, 5, 15)); // June 2026
      const def = getPartitionDefinitionForMonth(date);

      expect(def.name).toBe('delivery_attempts_2026_06');
      expect(def.from).toBe('2026-06-01 00:00:00+00');
      expect(def.to).toBe('2026-07-01 00:00:00+00');
      expect(def.year).toBe('2026');
      expect(def.month).toBe('06');
    });

    it('should roll over year boundary cleanly for December', () => {
      const date = new Date(Date.UTC(2026, 11, 25)); // Dec 2026
      const def = getPartitionDefinitionForMonth(date);

      expect(def.name).toBe('delivery_attempts_2026_12');
      expect(def.from).toBe('2026-12-01 00:00:00+00');
      expect(def.to).toBe('2027-01-01 00:00:00+00');
      expect(def.year).toBe('2026');
      expect(def.month).toBe('12');
    });
  });

  describe('ensureFuturePartitions', () => {
    it('should execute declarative DDL for current and next month partitions', async () => {
      const result = await service.ensureFuturePartitions();

      expect(result).toHaveLength(2);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);

      const ddl1 = (mockPrisma.$executeRawUnsafe as jest.Mock).mock.calls[0][0];
      const ddl2 = (mockPrisma.$executeRawUnsafe as jest.Mock).mock.calls[1][0];

      expect(ddl1).toMatch(/^CREATE TABLE IF NOT EXISTS delivery_attempts_\d{4}_\d{2} PARTITION OF delivery_attempts/);
      expect(ddl2).toMatch(/^CREATE TABLE IF NOT EXISTS delivery_attempts_\d{4}_\d{2} PARTITION OF delivery_attempts/);
    });
  });

  describe('listPartitions', () => {
    it('should query and parse attached and detached partitions from pg_catalog', async () => {
      // Mock attached child partitions
      (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          tableName: 'delivery_attempts_2026_10',
          partitionBound: "FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00')",
          estimatedRows: '500',
        },
        {
          tableName: 'delivery_attempts_default',
          partitionBound: 'DEFAULT',
          estimatedRows: '0',
        },
      ]);

      // Mock detached partitions
      (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          tableName: 'delivery_attempts_2026_09',
          estimatedRows: '1200',
        },
      ]);

      const partitions = await service.listPartitions();

      expect(partitions).toHaveLength(3);

      expect(partitions[0]).toEqual({
        name: 'delivery_attempts_2026_10',
        bound: "FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00')",
        from: '2026-10-01 00:00:00+00',
        to: '2026-11-01 00:00:00+00',
        isDefault: false,
        isAttached: true,
        estimatedRows: 500,
      });

      expect(partitions[1]).toEqual({
        name: 'delivery_attempts_default',
        bound: 'DEFAULT',
        from: null,
        to: null,
        isDefault: true,
        isAttached: true,
        estimatedRows: 0,
      });

      expect(partitions[2]).toEqual({
        name: 'delivery_attempts_2026_09',
        bound: "FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00')",
        from: '2026-09-01 00:00:00+00',
        to: '2026-10-01 00:00:00+00',
        isDefault: false,
        isAttached: false,
        estimatedRows: 1200,
      });
    });
  });

  describe('archiveOldPartitions', () => {
    it('should detach, read batches, gzip compress, upload to S3, and drop table for eligible partitions', async () => {
      // 1. Mock listPartitions output
      jest.spyOn(service, 'listPartitions').mockResolvedValueOnce([
        {
          name: 'delivery_attempts_2026_08',
          bound: "FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00')",
          from: '2026-08-01 00:00:00+00',
          to: '2026-09-01 00:00:00+00',
          isDefault: false,
          isAttached: true,
          estimatedRows: 2,
        },
        {
          // Future / recent partition that must NOT be archived
          name: 'delivery_attempts_2099_01',
          bound: "FOR VALUES FROM ('2099-01-01 00:00:00+00') TO ('2099-02-01 00:00:00+00')",
          from: '2099-01-01 00:00:00+00',
          to: '2099-02-01 00:00:00+00',
          isDefault: false,
          isAttached: true,
          estimatedRows: 10,
        },
        {
          // Default partition must NOT be archived
          name: 'delivery_attempts_default',
          bound: 'DEFAULT',
          from: null,
          to: null,
          isDefault: true,
          isAttached: true,
          estimatedRows: 0,
        },
      ]);

      // 2. Mock rows reading in batches
      const mockRowsBatch1 = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          attempt_number: 1,
          is_success: true,
          latency_ms: 120,
          created_at: '2026-08-10T12:00:00.000Z',
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          attempt_number: 2,
          is_success: false,
          latency_ms: 500,
          created_at: '2026-08-11T12:00:00.000Z',
        },
      ];

      (mockPrisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce(mockRowsBatch1) // First batch returns 2 rows (< batchSize 5000, so done)
        .mockResolvedValueOnce([]);

      mockStorageAdapter.uploadArchive.mockResolvedValueOnce({
        eTag: 'etag-archived-2026-08',
      });

      const summary = await service.archiveOldPartitions(30);

      expect(summary.archivedCount).toBe(1);
      expect(summary.totalRowsArchived).toBe(2);
      expect(summary.partitions).toHaveLength(1);

      const archived = summary.partitions[0];
      expect(archived.partitionName).toBe('delivery_attempts_2026_08');
      expect(archived.s3Key).toBe(
        'archives/delivery_attempts/year=2026/month=08/delivery_attempts_2026_08.jsonl.gz',
      );
      expect(archived.eTag).toBe('etag-archived-2026-08');
      expect(archived.rowCount).toBe(2);
      expect(archived.compressedBytes).toBeGreaterThan(0);

      // Verify DETACH PARTITION was called
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'ALTER TABLE delivery_attempts DETACH PARTITION "delivery_attempts_2026_08" CONCURRENTLY',
      );

      // Verify S3 upload payload integrity by decompressing gzip
      expect(mockStorageAdapter.uploadArchive).toHaveBeenCalledTimes(1);
      const [uploadedKey, uploadedBuffer] = mockStorageAdapter.uploadArchive.mock.calls[0];
      expect(uploadedKey).toBe(
        'archives/delivery_attempts/year=2026/month=08/delivery_attempts_2026_08.jsonl.gz',
      );

      const gunzipped = zlib.gunzipSync(uploadedBuffer as Buffer).toString('utf-8');
      const lines = gunzipped.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).id).toBe('11111111-1111-1111-1111-111111111111');
      expect(JSON.parse(lines[1]).id).toBe('22222222-2222-2222-2222-222222222222');

      // Verify DROP TABLE was executed
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'DROP TABLE IF EXISTS "delivery_attempts_2026_08"',
      );
    });

    it('should fallback to standard DETACH when CONCURRENTLY fails', async () => {
      jest.spyOn(service, 'listPartitions').mockResolvedValueOnce([
        {
          name: 'delivery_attempts_2026_05',
          bound: "FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00')",
          from: '2026-05-01 00:00:00+00',
          to: '2026-06-01 00:00:00+00',
          isDefault: false,
          isAttached: true,
          estimatedRows: 0,
        },
      ]);

      (mockPrisma.$executeRawUnsafe as jest.Mock)
        .mockRejectedValueOnce(new Error('cannot run inside transaction'))
        .mockResolvedValueOnce(1) // fallback DETACH
        .mockResolvedValueOnce(1); // DROP TABLE

      (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]); // empty rows

      mockStorageAdapter.uploadArchive.mockResolvedValueOnce({
        eTag: 'empty-etag',
      });

      const summary = await service.archiveOldPartitions(30);

      expect(summary.archivedCount).toBe(1);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'ALTER TABLE delivery_attempts DETACH PARTITION "delivery_attempts_2026_05"',
      );
    });

    it('should safely prevent concurrent archival executions', async () => {
      service.isArchiving = true;

      const summary = await service.archiveOldPartitions(30);

      expect(summary.archivedCount).toBe(0);
      expect(mockStorageAdapter.uploadArchive).not.toHaveBeenCalled();
    });

    it('should throw and preserve table if S3 upload does not return ETag', async () => {
      jest.spyOn(service, 'listPartitions').mockResolvedValueOnce([
        {
          name: 'delivery_attempts_2026_01',
          bound: "FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00')",
          from: '2026-01-01 00:00:00+00',
          to: '2026-02-01 00:00:00+00',
          isDefault: false,
          isAttached: false,
          estimatedRows: 0,
        },
      ]);

      (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);
      mockStorageAdapter.uploadArchive.mockResolvedValueOnce({ eTag: '' });

      await expect(service.archiveOldPartitions(30)).rejects.toThrow('did not return an ETag');

      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalledWith(
        'DROP TABLE IF EXISTS "delivery_attempts_2026_01"',
      );
    });
  });

  describe('triggerManualArchival', () => {
    it('should delegate to archiveOldPartitions with specified retention', async () => {
      const spy = jest.spyOn(service, 'archiveOldPartitions').mockResolvedValueOnce({
        startedAt: '2026-11-15T00:00:00.000Z',
        completedAt: '2026-11-15T00:00:01.000Z',
        retentionDays: 14,
        archivedCount: 0,
        totalRowsArchived: 0,
        partitions: [],
      });

      const result = await service.triggerManualArchival(14);

      expect(spy).toHaveBeenCalledWith(14);
      expect(result.retentionDays).toBe(14);
    });
  });

  describe('lifecycle hooks', () => {
    it('should call ensureFuturePartitions on bootstrap', async () => {
      const spy = jest.spyOn(service, 'ensureFuturePartitions').mockResolvedValueOnce([]);

      await service.onApplicationBootstrap();

      expect(spy).toHaveBeenCalled();
    });

    it('should start and clear interval if ARCHIVER_ENABLED is true', async () => {
      process.env.ARCHIVER_ENABLED = 'true';
      process.env.ARCHIVER_INTERVAL_MS = '5000';

      jest.spyOn(service, 'ensureFuturePartitions').mockResolvedValueOnce([]);

      await service.onApplicationBootstrap();

      service.onModuleDestroy();
      delete process.env.ARCHIVER_ENABLED;
      delete process.env.ARCHIVER_INTERVAL_MS;
    });
  });
});
