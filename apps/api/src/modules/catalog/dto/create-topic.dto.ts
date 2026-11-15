export class CreateTopicDto {
  name!: string;
  description?: string;
  payloadSchema!: Record<string, any>;
  maxAttempts?: number;
}
