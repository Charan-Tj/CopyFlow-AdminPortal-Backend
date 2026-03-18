import { PrismaClient } from '@prisma/client';

/**
 * Direct database script to mark TEST01 kiosk as ready
 * 
 * This updates the last_heartbeat timestamp directly in the database
 * Making TEST01 appear as if it just sent a heartbeat signal
 * 
 * Usage:
 *   npx ts-node scripts/mark-test01-ready.ts
 */

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('📍 Marking TEST01 kiosk as ready...\n');

    // Find TEST01 node
    const node = await prisma.node.findUnique({
      where: { node_code: 'TEST01' },
      include: { kiosks: true }
    });

    if (!node) {
      console.error('❌ TEST01 node not found!');
      console.log('💡 Run: npm run seed');
      process.exit(1);
    }

    console.log(`✅ Found TEST01 node (ID: ${node.id})`);

    // Find or create kiosk for TEST01
    let kiosk = node.kiosks[0];

    if (!kiosk) {
      console.log('📦 Creating kiosk for TEST01...');
      kiosk = await prisma.kiosk.create({
        data: {
          pi_id: `PI_TEST_1_${Date.now()}`,
          node_id: node.id,
          secret: 'secret123',
          paper_level: 'HIGH',
          last_heartbeat: new Date()
        }
      });
      console.log(`✅ Kiosk created: ${kiosk.pi_id}`);
    } else {
      console.log(`✅ Found existing kiosk: ${kiosk.pi_id}`);
    }

    // Update heartbeat timestamp to now
    const updated = await prisma.kiosk.update({
      where: { pi_id: kiosk.pi_id },
      data: {
        last_heartbeat: new Date(),
        paper_level: 'HIGH'
      }
    });

    console.log('\n🎉 Success! TEST01 is now ready for payment!\n');
    console.log('📊 Kiosk Status:');
    console.log(`   PI ID: ${updated.pi_id}`);
    console.log(`   Last Heartbeat: ${updated.last_heartbeat.toISOString()}`);
    console.log(`   Paper Level: ${updated.paper_level}`);
    console.log('\n✨ You can now complete payment for TEST01!\n');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
