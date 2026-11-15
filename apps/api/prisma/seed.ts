import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

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

  console.log(`Production API Key ready:`);
  console.log(`  Name: ${prodKeyRecord.name}`);
  console.log(`  Prefix: ${prodKeyRecord.key_prefix}`);
  console.log(`  Raw Secret: ${devProdKey}`);

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

  console.log(`Sandbox API Key ready:`);
  console.log(`  Name: ${testKeyRecord.name}`);
  console.log(`  Prefix: ${testKeyRecord.key_prefix}`);
  console.log(`  Raw Secret: ${devTestKey}`);

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
