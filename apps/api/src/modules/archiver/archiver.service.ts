import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import * as zlib from 'zlib';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ARCHIVE_STORAGE_PORT,
  ArchiveStoragePort,
} from './ports/archive-storage.port';
import {
  ArchivalRunSummary,
  ArchivedPartitionResult,
  PartitionDefinition,
  PartitionInfo,
} from './interfaces/archiver.interfaces';

export function getPartitionDefinitionForMonth(date: Date): PartitionDefinition {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed (0 to 11)

  const fromMonthStr = String(month + 1).padStart(2, '0');
  const from = `${year}-${fromMonthStr}-01 00:00:00+00`;

  const nextMonthDate = new Date(Date.UTC(year, month + 1, 1));
  const toYear = nextMonthDate.getUTCFullYear();
  const toMonthStr = String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0');
  const to = `${toYear}-${toMonthStr}-01 00:00:00+00`;

  const name = `delivery_attempts_${year}_${fromMonthStr}`;

  return {
    name,
    from,
    to,
    year: String(year),
    month: fromMonthStr,
  };
}

@Injectable()
export class ArchiverService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ArchiverService.name);
  public isArchiving = false;
  private archivalIntervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARCHIVE_STORAGE_PORT)
    private readonly storageAdapter: ArchiveStoragePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureFuturePartitions();

    if (process.env.ARCHIVER_ENABLED === 'true') {
      this.startScheduledArchival();
    }
  }

  onModuleDestroy(): void {
    if (this.archivalIntervalHandle) {
      clearInterval(this.archivalIntervalHandle);
      this.archivalIntervalHandle = undefined;
    }
  }

  /**
   * Starts periodic background partition archival when ARCHIVER_ENABLED is true.
   */
  startScheduledArchival(): void {
    const intervalMs = parseInt(
      process.env.ARCHIVER_INTERVAL_MS || '86400000',
      10,
    );
    this.logger.log(
      `Starting scheduled cold storage archival loop every ${intervalMs} ms`,
    );

    this.archivalIntervalHandle = setInterval(async () => {
      try {
        await this.archiveOldPartitions();
      } catch (error: any) {
        this.logger.error(
          `Background archival run failed: ${error?.message || error}`,
          error?.stack,
        );
      }
    }, intervalMs);
  }

  /**
   * Ensures that partitions for the current and next calendar months exist.
   * Creates them declaratively if missing.
   */
  async ensureFuturePartitions(): Promise<string[]> {
    const now = new Date();
    const currentDef = getPartitionDefinitionForMonth(now);
    const nextMonthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const nextDef = getPartitionDefinitionForMonth(nextMonthDate);

    const definitions = [currentDef, nextDef];
    const createdPartitions: string[] = [];

    for (const def of definitions) {
      const ddl = `CREATE TABLE IF NOT EXISTS ${def.name} PARTITION OF delivery_attempts FOR VALUES FROM ('${def.from}') TO ('${def.to}')`;
      this.logger.log(
        `Verifying declarative partition ${def.name} [${def.from} -> ${def.to}]`,
      );
      await this.prisma.$executeRawUnsafe(ddl);
      createdPartitions.push(def.name);
    }

    return createdPartitions;
  }

  /**
   * Queries pg_catalog to inspect all child partitions and detached tables for delivery_attempts.
   */
  async listPartitions(): Promise<PartitionInfo[]> {
    // 1. Attached child partitions
    const attachedRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        c.relname AS "tableName",
        pg_get_expr(c.relpartbound, c.oid) AS "partitionBound",
        c.reltuples::bigint AS "estimatedRows"
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.relname = 'delivery_attempts'
        AND n.nspname = 'public'
      ORDER BY c.relname ASC;
    `);

    const results: PartitionInfo[] = [];

    for (const row of attachedRows) {
      const bound = row.partitionBound || '';
      const isDefault = bound.trim().toUpperCase() === 'DEFAULT';
      let from: string | null = null;
      let to: string | null = null;

      const match = bound.match(
        /FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)/i,
      );
      if (match) {
        from = match[1];
        to = match[2];
      }

      results.push({
        name: row.tableName,
        bound,
        from,
        to,
        isDefault,
        isAttached: true,
        estimatedRows: Number(row.estimatedRows || 0),
      });
    }

    // 2. Detached legacy delivery_attempts tables awaiting archival or dropped
    const detachedRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        c.relname AS "tableName",
        c.reltuples::bigint AS "estimatedRows"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname ~ '^delivery_attempts_\\d{4}_\\d{2}$'
        AND NOT EXISTS (
          SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid
        )
      ORDER BY c.relname ASC;
    `);

    for (const row of detachedRows) {
      const nameMatch = row.tableName.match(
        /^delivery_attempts_(\d{4})_(\d{2})$/,
      );
      let from: string | null = null;
      let to: string | null = null;
      if (nameMatch) {
        const year = parseInt(nameMatch[1], 10);
        const month = parseInt(nameMatch[2], 10) - 1;
        const def = getPartitionDefinitionForMonth(
          new Date(Date.UTC(year, month, 1)),
        );
        from = def.from;
        to = def.to;
      }

      results.push({
        name: row.tableName,
        bound: from && to ? `FOR VALUES FROM ('${from}') TO ('${to}')` : '',
        from,
        to,
        isDefault: false,
        isAttached: false,
        estimatedRows: Number(row.estimatedRows || 0),
      });
    }

    return results;
  }

  /**
   * Identifies partitions older than retentionDays, detaches them, serializes to JSONL,
   * compresses via gzip, uploads to S3, verifies ETag and drops the table.
   */
  async archiveOldPartitions(
    retentionDays: number = 30,
  ): Promise<ArchivalRunSummary> {
    if (this.isArchiving) {
      this.logger.warn(
        'Archival execution already in progress, skipping concurrent run',
      );
      const nowIso = new Date().toISOString();
      return {
        startedAt: nowIso,
        completedAt: nowIso,
        retentionDays,
        archivedCount: 0,
        totalRowsArchived: 0,
        partitions: [],
      };
    }

    this.isArchiving = true;
    const startedAt = new Date().toISOString();
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffTime);

    this.logger.log(
      `Starting partition archival with retentionDays=${retentionDays} (cutoff: ${cutoffDate.toISOString()})`,
    );

    try {
      const allPartitions = await this.listPartitions();

      // Only archive partitions with explicit upper boundary that has fully elapsed
      const eligiblePartitions = allPartitions.filter((partition) => {
        if (partition.isDefault || !partition.to) {
          return false;
        }
        const toTime = new Date(partition.to).getTime();
        return toTime <= cutoffTime;
      });

      this.logger.log(
        `Identified ${eligiblePartitions.length} partition(s) eligible for cold storage archival`,
      );

      const archivedPartitions: ArchivedPartitionResult[] = [];
      let totalRowsArchived = 0;

      for (const partition of eligiblePartitions) {
        const result = await this.archiveSinglePartition(partition);
        archivedPartitions.push(result);
        totalRowsArchived += result.rowCount;
      }

      const completedAt = new Date().toISOString();
      return {
        startedAt,
        completedAt,
        retentionDays,
        archivedCount: archivedPartitions.length,
        totalRowsArchived,
        partitions: archivedPartitions,
      };
    } finally {
      this.isArchiving = false;
    }
  }

  /**
   * Detaches a single partition, dumps rows in batches to JSONL, compresses,
   * uploads to S3, verifies ETag and drops the partition table.
   */
  private async archiveSinglePartition(
    partition: PartitionInfo,
  ): Promise<ArchivedPartitionResult> {
    const partitionName = partition.name;

    // 1. Detach partition if currently attached
    if (partition.isAttached) {
      this.logger.log(`Detaching partition table "${partitionName}"`);
      try {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE delivery_attempts DETACH PARTITION "${partitionName}" CONCURRENTLY`,
        );
      } catch (concurrentError: any) {
        // Fallback if CONCURRENTLY is not supported in the active transactional context
        this.logger.warn(
          `CONCURRENTLY detach failed for "${partitionName}", falling back to standard DETACH: ${concurrentError?.message || concurrentError}`,
        );
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE delivery_attempts DETACH PARTITION "${partitionName}"`,
        );
      }
    }

    // 2. Read rows in cursor/batch chunks
    const batchSize = 5000;
    let offset = 0;
    let hasMore = true;
    const jsonlLines: string[] = [];
    let rowCount = 0;

    while (hasMore) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "${partitionName}" ORDER BY created_at ASC, id ASC LIMIT ${batchSize} OFFSET ${offset}`,
      );

      if (!rows || rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        // Safely serialize rows accommodating any BigInt or Timestamp values
        const serialized = JSON.stringify(row, (_key, val) =>
          typeof val === 'bigint' ? val.toString() : val,
        );
        jsonlLines.push(serialized);
      }

      rowCount += rows.length;
      if (rows.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    // 3. Serialize to JSON Lines format (each object separated by newline)
    const jsonlContent =
      jsonlLines.length > 0 ? jsonlLines.join('\n') + '\n' : '';
    const uncompressedBuffer = Buffer.from(jsonlContent, 'utf-8');

    // 4. Compress via gzip
    const compressedBuffer = zlib.gzipSync(uncompressedBuffer);

    // 5. Build S3 key: archives/delivery_attempts/year=YYYY/month=MM/<partition_name>.jsonl.gz
    const nameMatch = partitionName.match(
      /^delivery_attempts_(\d{4})_(\d{2})$/,
    );
    let year = 'unknown';
    let month = 'unknown';
    if (nameMatch) {
      year = nameMatch[1];
      month = nameMatch[2];
    } else if (partition.from) {
      const fromDate = new Date(partition.from);
      year = String(fromDate.getUTCFullYear());
      month = String(fromDate.getUTCMonth() + 1).padStart(2, '0');
    }

    const s3Key = `archives/delivery_attempts/year=${year}/month=${month}/${partitionName}.jsonl.gz`;

    // 6. Upload to S3 and verify ETag
    this.logger.log(
      `Uploading partition "${partitionName}" to S3 (${uncompressedBuffer.length} raw bytes -> ${compressedBuffer.length} gzip bytes) -> ${s3Key}`,
    );

    const uploadResult = await this.storageAdapter.uploadArchive(
      s3Key,
      compressedBuffer,
    );

    if (!uploadResult?.eTag) {
      throw new Error(
        `Archival upload failed for partition "${partitionName}": S3 did not return an ETag`,
      );
    }

    // 7. Drop detached partition table after confirmed upload
    this.logger.log(
      `S3 upload verified with ETag "${uploadResult.eTag}". Dropping detached partition table "${partitionName}"`,
    );
    await this.prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS "${partitionName}"`,
    );

    return {
      partitionName,
      s3Key,
      eTag: uploadResult.eTag,
      rowCount,
      uncompressedBytes: uncompressedBuffer.length,
      compressedBytes: compressedBuffer.length,
      archivedAt: new Date().toISOString(),
    };
  }

  /**
   * Manually triggers archival of old partitions.
   */
  async triggerManualArchival(
    retentionDays: number = 30,
  ): Promise<ArchivalRunSummary> {
    return this.archiveOldPartitions(retentionDays);
  }
}
