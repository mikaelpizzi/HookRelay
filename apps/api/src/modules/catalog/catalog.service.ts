import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, event_topics } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchemaValidatorService } from './schema-validator.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';

export const TOPIC_NAME_REGEX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schemaValidatorService: SchemaValidatorService,
  ) {}

  /**
   * Registers a new event topic for the specified tenant after validating name format and schema.
   */
  async createTopic(
    tenantId: string,
    dto: CreateTopicDto,
  ): Promise<event_topics> {
    if (!dto.name || !TOPIC_NAME_REGEX.test(dto.name)) {
      throw new BadRequestException(
        'Invalid topic name format. Expected lowercase alphanumeric segments separated by dots (e.g. "order.created")',
      );
    }

    const payloadSchema =
      dto.payloadSchema ?? (dto as Record<string, any>).payload_schema;

    if (
      !payloadSchema ||
      typeof payloadSchema !== 'object' ||
      Array.isArray(payloadSchema)
    ) {
      throw new BadRequestException(
        'payloadSchema must be a valid JSON Schema object',
      );
    }

    const isSchemaValid =
      this.schemaValidatorService.compileAndValidateSchema(payloadSchema);
    if (!isSchemaValid) {
      throw new BadRequestException(
        'Invalid JSON Schema definition for payloadSchema',
      );
    }

    const maxAttempts =
      dto.maxAttempts ?? (dto as Record<string, any>).max_attempts ?? 5;

    if (
      typeof maxAttempts !== 'number' ||
      maxAttempts < 1 ||
      maxAttempts > 10
    ) {
      throw new BadRequestException(
        'maxAttempts must be an integer between 1 and 10',
      );
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      try {
        return await tx.event_topics.create({
          data: {
            tenant_id: tenantId,
            name: dto.name,
            description: dto.description ?? null,
            payload_schema: payloadSchema as Prisma.InputJsonValue,
            max_attempts: maxAttempts,
          },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            `Topic with name '${dto.name}' already exists for this tenant`,
          );
        }
        throw error;
      }
    });
  }

  /**
   * Lists all event topics belonging to the authenticated tenant.
   */
  async listTopics(tenantId: string): Promise<event_topics[]> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.event_topics.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
      });
    });
  }

  /**
   * Retrieves a single topic by ID, ensuring it belongs to the authenticated tenant.
   */
  async getTopicById(tenantId: string, id: string): Promise<event_topics> {
    const topic = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.event_topics.findFirst({
        where: { id, tenant_id: tenantId },
      });
    });

    if (!topic) {
      throw new NotFoundException(`Topic with ID '${id}' not found`);
    }

    return topic;
  }

  /**
   * Updates an existing topic. If payloadSchema is modified, revalidates and purges cached validator.
   */
  async updateTopic(
    tenantId: string,
    id: string,
    dto: UpdateTopicDto,
  ): Promise<event_topics> {
    // Verifies tenant ownership and existence
    await this.getTopicById(tenantId, id);

    const payloadSchema =
      dto.payloadSchema ?? (dto as Record<string, any>).payload_schema;

    if (payloadSchema !== undefined) {
      if (
        !payloadSchema ||
        typeof payloadSchema !== 'object' ||
        Array.isArray(payloadSchema)
      ) {
        throw new BadRequestException(
          'payloadSchema must be a valid JSON Schema object',
        );
      }

      const isSchemaValid =
        this.schemaValidatorService.compileAndValidateSchema(payloadSchema);
      if (!isSchemaValid) {
        throw new BadRequestException(
          'Invalid JSON Schema definition for payloadSchema',
        );
      }

      this.schemaValidatorService.invalidate(id);
    }

    const maxAttempts =
      dto.maxAttempts ?? (dto as Record<string, any>).max_attempts;

    if (
      maxAttempts !== undefined &&
      (typeof maxAttempts !== 'number' ||
        maxAttempts < 1 ||
        maxAttempts > 10)
    ) {
      throw new BadRequestException(
        'maxAttempts must be an integer between 1 and 10',
      );
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.event_topics.update({
        where: { id },
        data: {
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(payloadSchema !== undefined
            ? { payload_schema: payloadSchema as Prisma.InputJsonValue }
            : {}),
          ...(maxAttempts !== undefined ? { max_attempts: maxAttempts } : {}),
        },
      });
    });
  }
}
