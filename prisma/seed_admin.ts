import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin@copyflow.com';
    const password = 'admin123'; // Weak for dev, but standard for prototype
    const hash = await bcrypt.hash(password, 10);

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (!existingUser) {
        await prisma.user.create({
            data: {
                email,
                password_hash: hash,
                role: 'ADMIN',
            },
        });
        console.log('Root Admin created.');
    } else {
        // Optional: Update password if needed, or just skip
        console.log('Root Admin already exists.');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
