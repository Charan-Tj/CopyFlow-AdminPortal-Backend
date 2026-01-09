import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const jobId = 'a703a61f-0883-4433-9c2c-641c8f03f442';

async function main() {
    const job = await prisma.printJob.findUnique({
        where: { job_id: jobId },
        include: { payment: true },
    });
    console.log(JSON.stringify(job, null, 2));
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
