export interface IngestResult {
  eventId: string;
  correlationId: string;
  status: string;
  deduplicated: boolean;
}
