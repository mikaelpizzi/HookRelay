import { environment_type } from '@prisma/client';

export class SubscribeTopicDto {
  topicId?: string;
  topic_id?: string;
  environment!: environment_type;
}
