import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import {
  environment_type,
  webhook_endpoints,
  endpoint_topic_subscriptions,
  circuit_state,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SsrfValidatorService } from './ssrf-validator.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';
import { SubscribeTopicDto } from './dto/subscribe-topic.dto';

@Injectable()
export class EndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssrfValidator: SsrfValidatorService,
  ) {}

  /**
   * Registers a new webhook endpoint with an HMAC signing secret and environment associations.
   */
  async createEndpoint(
    tenantId: string,
    dto: CreateEndpointDto,
  ): Promise<webhook_endpoints> {
    if (!dto.url || typeof dto.url !== 'string') {
      throw new BadRequestException('url is required and must be a string');
    }

    // SSRF validation before saving to prevent internal network scanning
    await this.ssrfValidator.validateUrl(dto.url);

    const failureThreshold =
      dto.failureThreshold ?? dto.failure_threshold ?? 5;
    if (
      typeof failureThreshold !== 'number' ||
      failureThreshold < 1 ||
      failureThreshold > 50
    ) {
      throw new BadRequestException(
        'failureThreshold must be an integer between 1 and 50',
      );
    }

    const targetEnvironments =
      dto.environments && dto.environments.length > 0
        ? dto.environments
        : [environment_type.PRODUCTION, environment_type.SANDBOX];

    for (const env of targetEnvironments) {
      if (!Object.values(environment_type).includes(env)) {
        throw new BadRequestException(
          `Invalid environment '${env}'. Allowed: PRODUCTION, SANDBOX`,
        );
      }
    }
    const uniqueEnvironments = Array.from(new Set(targetEnvironments));

    // Cryptographically secure HMAC signing secret
    const signingSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.webhook_endpoints.create({
        data: {
          tenant_id: tenantId,
          url: dto.url,
          description: dto.description ?? null,
          signing_secret: signingSecret,
          failure_threshold: failureThreshold,
          endpoint_environments: {
            create: uniqueEnvironments.map((env) => ({
              environment: env,
            })),
          },
        },
        include: {
          endpoint_environments: true,
        },
      });
    });
  }

  /**
   * Lists all webhook endpoints for the authenticated tenant.
   */
  async listEndpoints(tenantId: string): Promise<webhook_endpoints[]> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.webhook_endpoints.findMany({
        where: { tenant_id: tenantId },
        include: {
          endpoint_environments: true,
        },
        orderBy: { created_at: 'desc' },
      });
    });
  }

  /**
   * Retrieves an endpoint by ID, ensuring tenant isolation.
   */
  async getEndpointById(
    tenantId: string,
    id: string,
  ): Promise<webhook_endpoints> {
    const endpoint = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.webhook_endpoints.findFirst({
        where: { id, tenant_id: tenantId },
        include: {
          endpoint_environments: true,
        },
      });
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID '${id}' not found`);
    }

    return endpoint;
  }

  /**
   * Updates endpoint configuration (URL, description, active status, failure threshold).
   */
  async updateEndpoint(
    tenantId: string,
    id: string,
    dto: UpdateEndpointDto,
  ): Promise<webhook_endpoints> {
    // Ensures endpoint belongs to tenant
    await this.getEndpointById(tenantId, id);

    if (dto.url !== undefined) {
      if (!dto.url || typeof dto.url !== 'string') {
        throw new BadRequestException('url must be a non-empty string');
      }
      await this.ssrfValidator.validateUrl(dto.url);
    }

    const failureThreshold = dto.failureThreshold ?? dto.failure_threshold;
    if (
      failureThreshold !== undefined &&
      (typeof failureThreshold !== 'number' ||
        failureThreshold < 1 ||
        failureThreshold > 50)
    ) {
      throw new BadRequestException(
        'failureThreshold must be an integer between 1 and 50',
      );
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const updateData: Record<string, any> = {};
      if (dto.url !== undefined) updateData.url = dto.url;
      if (dto.description !== undefined) updateData.description = dto.description;
      const isActive = dto.isActive ?? dto.is_active;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (failureThreshold !== undefined) updateData.failure_threshold = failureThreshold;

      return tx.webhook_endpoints.update({
        where: { id },
        data: updateData,
        include: {
          endpoint_environments: true,
        },
      });
    });
  }

  /**
   * Soft deletes an endpoint by setting is_active to false.
   */
  async deleteEndpoint(
    tenantId: string,
    id: string,
  ): Promise<webhook_endpoints> {
    await this.getEndpointById(tenantId, id);

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.webhook_endpoints.update({
        where: { id },
        data: { is_active: false },
        include: {
          endpoint_environments: true,
        },
      });
    });
  }

  /**
   * Subscribes an endpoint to a topic adhering to 5NF decomposition across environments.
   */
  async subscribeTopic(
    tenantId: string,
    endpointId: string,
    dto: SubscribeTopicDto,
  ): Promise<endpoint_topic_subscriptions> {
    const topicId = dto.topicId ?? dto.topic_id;
    if (!topicId) {
      throw new BadRequestException('topicId is required');
    }

    if (
      !dto.environment ||
      !Object.values(environment_type).includes(dto.environment)
    ) {
      throw new BadRequestException(
        "environment must be either 'PRODUCTION' or 'SANDBOX'",
      );
    }

    // Verify endpoint belongs to tenant
    await this.getEndpointById(tenantId, endpointId);

    // Verify topic belongs to tenant
    const topic = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.event_topics.findFirst({
        where: { id: topicId, tenant_id: tenantId },
      });
    });

    if (!topic) {
      throw new NotFoundException(`Topic with ID '${topicId}' not found`);
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      // 1. Maintain topic_environments projection (5NF decomposition)
      await tx.topic_environments.upsert({
        where: {
          topic_id_environment: {
            topic_id: topicId,
            environment: dto.environment,
          },
        },
        create: {
          topic_id: topicId,
          environment: dto.environment,
        },
        update: {},
      });

      // 2. Maintain endpoint_environments projection (5NF decomposition)
      await tx.endpoint_environments.upsert({
        where: {
          endpoint_id_environment: {
            endpoint_id: endpointId,
            environment: dto.environment,
          },
        },
        create: {
          endpoint_id: endpointId,
          environment: dto.environment,
        },
        update: {},
      });

      // 3. Insert or maintain subscription relation
      return tx.endpoint_topic_subscriptions.upsert({
        where: {
          endpoint_id_topic_id: {
            endpoint_id: endpointId,
            topic_id: topicId,
          },
        },
        create: {
          endpoint_id: endpointId,
          topic_id: topicId,
        },
        update: {},
      });
    });
  }

  /**
   * Lists all active topic subscriptions for the given endpoint.
   */
  async listSubscriptions(
    tenantId: string,
    endpointId: string,
  ): Promise<endpoint_topic_subscriptions[]> {
    await this.getEndpointById(tenantId, endpointId);

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.endpoint_topic_subscriptions.findMany({
        where: {
          endpoint_id: endpointId,
          webhook_endpoints: {
            tenant_id: tenantId,
          },
        },
        include: {
          event_topics: true,
        },
        orderBy: { created_at: 'desc' },
      });
    });
  }

  /**
   * Unsubscribes an endpoint from a topic by deleting the subscription record.
   */
  async unsubscribeTopic(
    tenantId: string,
    endpointId: string,
    topicId: string,
  ): Promise<endpoint_topic_subscriptions> {
    await this.getEndpointById(tenantId, endpointId);

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const existing = await tx.endpoint_topic_subscriptions.findUnique({
        where: {
          endpoint_id_topic_id: {
            endpoint_id: endpointId,
            topic_id: topicId,
          },
        },
      });

      if (!existing) {
        throw new NotFoundException(
          `Subscription not found for endpoint '${endpointId}' and topic '${topicId}'`,
        );
      }

      return tx.endpoint_topic_subscriptions.delete({
        where: {
          endpoint_id_topic_id: {
            endpoint_id: endpointId,
            topic_id: topicId,
          },
        },
      });
    });
  }

  /**
   * Manually resets an endpoint circuit to CLOSED and consecutive_failures = 0.
   */
  async resetCircuit(
    tenantId: string,
    id: string,
  ): Promise<webhook_endpoints> {
    await this.getEndpointById(tenantId, id);

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.webhook_endpoints.update({
        where: { id },
        data: {
          circuit_status: circuit_state.CLOSED,
          consecutive_failures: 0,
          circuit_opened_at: null,
          updated_at: new Date(),
        },
        include: {
          endpoint_environments: true,
        },
      });
    });
  }
}
