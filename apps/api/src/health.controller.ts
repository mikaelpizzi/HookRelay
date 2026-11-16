import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './shared/prisma/prisma.service';
import { QueueService } from './shared/queue/queue.service';

@Controller(['health', 'api/v1/health'])
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  async check(@Res() res: Response) {
    const startTime = performance.now();
    let dbStatus = 'down';
    let dbLatencyMs = 0;
    let redisStatus = 'down';
    let redisLatencyMs = 0;

    // Check Database (PostgreSQL)
    try {
      const dbStart = performance.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Math.round(performance.now() - dbStart);
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    // Check Redis
    try {
      const redisStart = performance.now();
      const redis = this.queueService.getRedisClient();
      if (redis) {
        await redis.ping();
        redisLatencyMs = Math.round(performance.now() - redisStart);
        redisStatus = 'up';
      }
    } catch {
      redisStatus = 'down';
    }

    const totalLatencyMs = Math.round(performance.now() - startTime);
    const isHealthy = dbStatus === 'up' && redisStatus === 'up';

    const payload = {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: totalLatencyMs,
      services: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatencyMs,
        },
      },
    };

    return res
      .status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(payload);
  }
}
