import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

    const salt = await bcrypt.genSalt();
    const password_hash = await bcrypt.hash('admin123', salt);

    await prisma.user.upsert({
        where: { email: 'admin@copyflow.com' },
        update: {},
        create: {
            email: 'admin@copyflow.com',
            password_hash,
            role: 'ADMIN',
        },
    });
    console.log('Seeded Admin User (admin@copyflow.com / admin123)');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
