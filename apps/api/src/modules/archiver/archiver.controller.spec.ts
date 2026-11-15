import { Test, TestingModule } from '@nestjs/testing';
import { ArchiverController } from './archiver.controller';
import { ArchiverService } from './archiver.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

describe('ArchiverController', () => {
  let controller: ArchiverController;
  let archiverService: any;

  const mockTenantId = 'tenant-admin-123';

  const mockSummary = {
    startedAt: '2026-11-15T10:00:00.000Z',
    completedAt: '2026-11-15T10:00:02.000Z',
    retentionDays: 30,
    archivedCount: 1,
    totalRowsArchived: 42,
    partitions: [
      {
        partitionName: 'delivery_attempts_2026_09',
        s3Key:
          'archives/delivery_attempts/year=2026/month=09/delivery_attempts_2026_09.jsonl.gz',
        eTag: 'e-tag-456',
        rowCount: 42,
        uncompressedBytes: 2048,
        compressedBytes: 512,
        archivedAt: '2026-11-15T10:00:02.000Z',
      },
    ],
  };

  const mockPartitions = [
    {
      name: 'delivery_attempts_2026_11',
      bound:
        "FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00')",
      from: '2026-11-01 00:00:00+00',
      to: '2026-12-01 00:00:00+00',
      isDefault: false,
      isAttached: true,
      estimatedRows: 150,
    },
    {
      name: 'delivery_attempts_default',
      bound: 'DEFAULT',
      from: null,
      to: null,
      isDefault: true,
      isAttached: true,
      estimatedRows: 0,
    },
  ];

  beforeEach(async () => {
    archiverService = {
      triggerManualArchival: jest.fn().mockResolvedValue(mockSummary),
      listPartitions: jest.fn().mockResolvedValue(mockPartitions),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArchiverController],
      providers: [
        {
          provide: ArchiverService,
          useValue: archiverService,
        },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ArchiverController>(ArchiverController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('runArchival', () => {
    it('should trigger manual archival with default retention when dto is omitted', async () => {
      const result = await controller.runArchival(mockTenantId);

      expect(archiverService.triggerManualArchival).toHaveBeenCalledWith(
        undefined,
      );
      expect(result).toEqual(mockSummary);
    });

    it('should trigger manual archival with custom retention days', async () => {
      const result = await controller.runArchival(mockTenantId, {
        retentionDays: 60,
      });

      expect(archiverService.triggerManualArchival).toHaveBeenCalledWith(60);
      expect(result).toEqual(mockSummary);
    });
  });

  describe('getPartitions', () => {
    it('should return the active partitions and their ranges', async () => {
      const result = await controller.getPartitions(mockTenantId);

      expect(archiverService.listPartitions).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockPartitions);
    });
  });
});
