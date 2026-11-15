export class TriggerArchiveDto {
  /**
   * Minimum age in days for a partition's upper boundary to be eligible for archival.
   * Defaults to 30 days if omitted.
   */
  retentionDays?: number;
}
