export class UpdateTopicDto {
  description?: string;
  payloadSchema?: Record<string, any>;
  maxAttempts?: number;
}
