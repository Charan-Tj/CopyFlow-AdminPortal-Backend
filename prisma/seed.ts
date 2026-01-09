import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    await prisma.kiosk.upsert({
        where: { pi_id: 'PI_TEST_1' },
        update: {},
        create: {
            pi_id: 'PI_TEST_1',
            secret: 'secret123',
            location: 'Test Lab',
        },
    });
    console.log('Seeded PI_TEST_1');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
