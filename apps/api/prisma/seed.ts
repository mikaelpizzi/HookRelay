import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const TOPIC_SCHEMAS: Record<string, { description: string; schema: any }> = {
  'order.created': {
    description: 'Triggered when a customer creates a new purchase order',
    schema: {
      type: 'object',
      required: ['order_id', 'customer', 'amount'],
      properties: {
        order_id: { type: 'string' },
        customer: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            tier: { type: 'string' },
          },
        },
        amount: {
          type: 'object',
          required: ['total', 'currency'],
          properties: {
            total: { type: 'number', minimum: 0 },
            currency: { type: 'string' },
          },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
            },
          },
        },
      },
    },
  },
  'payment.completed': {
    description: 'External payment gateway confirmation settled successfully',
    schema: {
      type: 'object',
      required: ['payment_id', 'order_id', 'status'],
      properties: {
        payment_id: { type: 'string' },
        order_id: { type: 'string' },
        status: { type: 'string' },
        processor: { type: 'string' },
        transaction_ref: { type: 'string' },
        settled_at: { type: 'string' },
      },
    },
  },
  'user.registered': {
    description: 'New tenant user account created and verified',
    schema: {
      type: 'object',
      required: ['user_id', 'email'],
      properties: {
        user_id: { type: 'string' },
        email: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        organization_id: { type: 'string' },
      },
    },
  },
  'invoice.paid': {
    description: 'Invoice settled and reconciled by billing engine',
    schema: {
      type: 'object',
      required: ['invoice_id', 'amount', 'currency'],
      properties: {
        invoice_id: { type: 'string' },
        amount: { type: 'number', minimum: 1 },
        currency: { type: 'string', enum: ['USD', 'EUR', 'CLP'] },
      },
      additionalProperties: false,
    },
  },
};

async function main() {
  console.log('--- Seeding HookRelay Database ---');

  // 1. Create or update Demo Corp tenant
  const tenant = await prisma.tenants.upsert({
    where: { slug: 'demo-corp' },
    update: {
      name: 'Demo Corp',
      is_active: true,
    },
    create: {
      name: 'Demo Corp',
      slug: 'demo-corp',
      is_active: true,
    },
  });

  console.log(`Tenant ready: ${tenant.name} (${tenant.id}, slug: ${tenant.slug})`);

  // 2. Production API Key
  const devProdKey =
    process.env.DEMO_PROD_API_KEY ||
    'hr_live_demo_corp_00000000000000000000000000000000';
  const prodHash = crypto.createHash('sha256').update(devProdKey).digest('hex');
  const prodPrefix = devProdKey.slice(0, 8);

  const prodKeyRecord = await prisma.api_keys.upsert({
    where: { key_hash: prodHash },
    update: {
      tenant_id: tenant.id,
      name: 'Demo Corp Production Key',
      environment: 'PRODUCTION',
      revoked_at: null,
    },
    create: {
      tenant_id: tenant.id,
      name: 'Demo Corp Production Key',
      key_prefix: prodPrefix,
      key_hash: prodHash,
      environment: 'PRODUCTION',
    },
  });

  console.log(`Production API Key ready: ${prodKeyRecord.name} (${prodKeyRecord.key_prefix}...)`);

  // 3. Sandbox API Key
  const devTestKey =
    process.env.DEMO_TEST_API_KEY ||
    'hr_test_demo_corp_00000000000000000000000000000000';
  const testHash = crypto.createHash('sha256').update(devTestKey).digest('hex');
  const testPrefix = devTestKey.slice(0, 8);

  const testKeyRecord = await prisma.api_keys.upsert({
    where: { key_hash: testHash },
    update: {
      tenant_id: tenant.id,
      name: 'Demo Corp Sandbox Key',
      environment: 'SANDBOX',
      revoked_at: null,
    },
    create: {
      tenant_id: tenant.id,
      name: 'Demo Corp Sandbox Key',
      key_prefix: testPrefix,
      key_hash: testHash,
      environment: 'SANDBOX',
    },
  });

  console.log(`Sandbox API Key ready: ${testKeyRecord.name} (${testKeyRecord.key_prefix}...)`);

  // 4. Remove residual test topics
  await prisma.event_topics.deleteMany({
    where: {
      tenant_id: tenant.id,
      name: { startsWith: 'security.prototype_pollution_' },
    },
  });

  // 5. Seed Event Topics
  const createdTopics: Record<string, string> = {};
  for (const [topicName, def] of Object.entries(TOPIC_SCHEMAS)) {
    const topic = await prisma.event_topics.upsert({
      where: {
        tenant_id_name: {
          tenant_id: tenant.id,
          name: topicName,
        },
      },
      update: {
        description: def.description,
        payload_schema: def.schema,
      },
      create: {
        tenant_id: tenant.id,
        name: topicName,
        description: def.description,
        payload_schema: def.schema,
      },
    });
    createdTopics[topicName] = topic.id;

    // Ensure topic environments (PRODUCTION and SANDBOX)
    await prisma.topic_environments.upsert({
      where: {
        topic_id_environment: {
          topic_id: topic.id,
          environment: 'PRODUCTION',
        },
      },
      update: {},
      create: {
        topic_id: topic.id,
        environment: 'PRODUCTION',
      },
    });

    await prisma.topic_environments.upsert({
      where: {
        topic_id_environment: {
          topic_id: topic.id,
          environment: 'SANDBOX',
        },
      },
      update: {},
      create: {
        topic_id: topic.id,
        environment: 'SANDBOX',
      },
    });

    console.log(`Event Topic ready: ${topic.name} (${topic.id}) in PRODUCTION and SANDBOX`);
  }

  // 6. Seed Demo Webhook Sink Endpoint (SANDBOX only to prevent SSRF confusion)
  const sinkUrl = 'http://127.0.0.1:3000/api/v1/demo/webhook-sink';
  let sinkEndpoint = await prisma.webhook_endpoints.findFirst({
    where: {
      tenant_id: tenant.id,
      url: sinkUrl,
    },
  });

  if (!sinkEndpoint) {
    sinkEndpoint = await prisma.webhook_endpoints.create({
      data: {
        tenant_id: tenant.id,
        url: sinkUrl,
        description: 'Internal Demo Sink (Sandbox)',
        signing_secret: 'whsec_demo_corporate_live_secret_key_32bytes',
        is_active: true,
        circuit_status: 'CLOSED',
        failure_threshold: 5,
      },
    });
  } else {
    sinkEndpoint = await prisma.webhook_endpoints.update({
      where: { id: sinkEndpoint.id },
      data: {
        description: 'Internal Demo Sink (Sandbox)',
        is_active: true,
        circuit_status: 'CLOSED',
        consecutive_failures: 0,
        circuit_opened_at: null,
      },
    });
  }

  // Ensure endpoint environment is strictly SANDBOX
  await prisma.endpoint_environments.deleteMany({
    where: { endpoint_id: sinkEndpoint.id },
  });

  await prisma.endpoint_environments.create({
    data: {
      endpoint_id: sinkEndpoint.id,
      environment: 'SANDBOX',
    },
  });

  console.log(`Demo Sink Endpoint ready: ${sinkEndpoint.url} (${sinkEndpoint.id}) in SANDBOX`);

  // 7. Subscribe Demo Sink Endpoint to all demo topics
  for (const [topicName, topicId] of Object.entries(createdTopics)) {
    await prisma.endpoint_topic_subscriptions.upsert({
      where: {
        endpoint_id_topic_id: {
          endpoint_id: sinkEndpoint.id,
          topic_id: topicId,
        },
      },
      update: {},
      create: {
        endpoint_id: sinkEndpoint.id,
        topic_id: topicId,
      },
    });
    console.log(`Subscribed endpoint to topic: ${topicName}`);
  }

  console.log('--- Seed Completed Successfully ---');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
