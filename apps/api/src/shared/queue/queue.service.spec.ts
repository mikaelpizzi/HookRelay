import { QueueService } from './queue.service';

const mockRedisInstance = {
  on: jest.fn(),
  disconnect: jest.fn(),
};

const mockQueueInstance = {
  getWaitingCount: jest.fn(),
  close: jest.fn(),
};

jest.mock('ioredis', () => {
  const MockIORedis = jest.fn().mockImplementation(() => mockRedisInstance);
  return {
    __esModule: true,
    default: MockIORedis,
    MockIORedis,
  };
});

jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => mockQueueInstance),
}));

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueInstance.getWaitingCount.mockResolvedValue(10);
    mockQueueInstance.close.mockResolvedValue(undefined);
    service = new QueueService();
  });

  it('should return waiting count from the bullmq queue', async () => {
    mockQueueInstance.getWaitingCount.mockResolvedValue(42);
    const count = await service.getWaitingCount();
    expect(count).toBe(42);
    expect(mockQueueInstance.getWaitingCount).toHaveBeenCalledTimes(1);
  });

  it('should gracefully return 0 when redis or queue fails', async () => {
    mockQueueInstance.getWaitingCount.mockRejectedValue(
      new Error('Redis connection refused'),
    );
    const count = await service.getWaitingCount();
    expect(count).toBe(0);
  });

  it('should expose the underlying queue instance', () => {
    const queue = service.getQueue();
    expect(queue).toBe(mockQueueInstance);
  });

  it('should close queue and disconnect redis on destroy', async () => {
    await service.onModuleDestroy();
    expect(mockQueueInstance.close).toHaveBeenCalledTimes(1);
    expect(mockRedisInstance.disconnect).toHaveBeenCalledTimes(1);
  });
});
