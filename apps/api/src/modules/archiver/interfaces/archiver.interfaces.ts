export interface PartitionDefinition {
  name: string;
  from: string;
  to: string;
  year: string;
  month: string;
}

export interface PartitionInfo {
  name: string;
  bound: string;
  from: string | null;
  to: string | null;
  isDefault: boolean;
  isAttached: boolean;
  estimatedRows: number;
}

export interface ArchivedPartitionResult {
  partitionName: string;
  s3Key: string;
  eTag: string;
  rowCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
  archivedAt: string;
}

export interface ArchivalRunSummary {
  startedAt: string;
  completedAt: string;
  retentionDays: number;
  archivedCount: number;
  totalRowsArchived: number;
  partitions: ArchivedPartitionResult[];
}
