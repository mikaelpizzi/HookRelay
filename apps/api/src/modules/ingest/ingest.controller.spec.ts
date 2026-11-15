import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { environment_type } from '@prisma/client';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { BackpressureException } from './exceptions/backpressure.exception';

describe('IngestController', () => {
  let controller: IngestController;
  let ingestService: any;
  let mockRes: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDto = {
    topic: 'order.created',
    data: { orderId: 'ord-123' },
    idempotencyKey: 'idem-123',
  };

  beforeEach(async () => {
    ingestService = {
      ingestEvent: jest.fn(),
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [{ provide: IngestService, useValue: ingestService }],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IngestController>(IngestController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should propagate provided correlation ID header and set 202 Accepted for new events', async () => {
    const providedCorrelationId = 'custom-correlation-id-999';
    const mockResult = {
      eventId: 'event-uuid-1',
      correlationId: providedCorrelationId,
      status: 'ACCEPTED',
      deduplicated: false,
    };

    ingestService.ingestEvent.mockResolvedValueOnce(mockResult);

    const result = await controller.ingest(
      mockTenantId,
      environment_type.PRODUCTION,
      providedCorrelationId,
      mockDto,
      mockRes,
    );

    expect(result).toBe(mockResult);
    expect(ingestService.ingestEvent).toHaveBeenCalledWith(
      mockTenantId,
      environment_type.PRODUCTION,
      mockDto,
      providedCorrelationId,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      providedCorrelationId,
    );
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
  });

  it('should generate a correlation ID when header is missing', async () => {
    const mockResult = {
      eventId: 'event-uuid-2',
      correlationId: 'generated-id',
      status: 'ACCEPTED',
      deduplicated: false,
    };

    ingestService.ingestEvent.mockResolvedValueOnce(mockResult);

    await controller.ingest(
      mockTenantId,
      environment_type.SANDBOX,
      undefined,
      mockDto,
      mockRes,
    );

    expect(ingestService.ingestEvent).toHaveBeenCalledWith(
      mockTenantId,
      environment_type.SANDBOX,
      mockDto,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      expect.any(String),
    );
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
  });

  it('should set 200 OK status when event is deduplicated', async () => {
    const mockResult = {
      eventId: 'event-uuid-existing',
      correlationId: 'original-corr-id',
      status: 'PENDING',
      deduplicated: true,
    };

    ingestService.ingestEvent.mockResolvedValueOnce(mockResult);

    const result = await controller.ingest(
      mockTenantId,
      environment_type.PRODUCTION,
      'corr-id',
      mockDto,
      mockRes,
    );

    expect(result).toBe(mockResult);
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('should attach Retry-After header to response when BackpressureException is thrown', async () => {
    ingestService.ingestEvent.mockRejectedValueOnce(new BackpressureException());

    await expect(
      controller.ingest(
        mockTenantId,
        environment_type.PRODUCTION,
        'corr-id',
        mockDto,
        mockRes,
      ),
    ).rejects.toThrow(BackpressureException);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '10');
  });
});
