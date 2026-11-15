export class IngestEventDto {
  topic!: string;
  data!: Record<string, any>;
  idempotencyKey?: string;
  idempotency_key?: string;
}
