import { PrismaClient } from '@prisma/client';

/**
 * Keep TEST01 kiosk active by updating its heartbeat timestamp
 * 
 * This script can be run via cron job or manually to ensure TEST01 stays ready during development
 * 
 * Usage:
 *   npx ts-node scripts/keep-test01-alive.ts
 * 
 * For cron (every 5 minutes):
    *   */

const prisma = new PrismaClient();

async function main() {
  try {
    const now = new Date();
    
    // Find TEST01 node
    const node = await prisma.node.findUnique({
      where: { node_code: 'TEST01' },
      include: { kiosks: true }
    });

    if (!node) {
      console.log('⚠️  TEST01 node not found. Run: npm run seed');
      return;
    }

    // Update all TEST01 kiosks' heartbeat
    let updated = 0;
    for (const kiosk of node.kiosks) {
      await prisma.kiosk.update({
        where: { pi_id: kiosk.pi_id },
        data: { last_heartbeat: now }
      });
      updated++;
    }

    if (updated === 0) {
      // No kiosks exist, create a default one
      await prisma.kiosk.create({
        data: {
          pi_id: `PI_TEST_1`,
          node_id: node.id,
          secret: 'test_secret',
          paper_level: 'HIGH',
          last_heartbeat: now
        }
      });
      updated = 1;
    }

    console.log(`✅ [${now.toISOString()}] TEST01 kept alive! (${updated} kiosk${updated > 1 ? 's' : ''} updated)`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
