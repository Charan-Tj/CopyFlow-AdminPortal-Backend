import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const jobId = 'a703a61f-0883-4433-9c2c-641c8f03f442'; // Replace with actual
const orderId = 'order_test_123';

async function main() {
    await prisma.payment.create({
        data: {
            job_id: jobId,
            provider_order_id: orderId,
            amount: 10.00,
            currency: 'INR',
            status: 'created',
        },
    });
    console.log(`Seeded Payment for Job ${jobId} with Order ${orderId}`);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
