import { Controller, Post, Param, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayService } from './razorpay/razorpay.service';
import { JobStatus } from '@prisma/client';

@Controller('jobs')
export class PaymentsController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly razorpayService: RazorpayService,
    ) { }

    @Post(':job_id/pay')
    async initiatePayment(@Param('job_id') jobId: string) {
        const job = await this.prisma.printJob.findUnique({
            where: { job_id: jobId },
        });

        if (!job) {
            throw new NotFoundException('Job not found');
        }

        if (job.status !== JobStatus.UPLOADED) {
            throw new BadRequestException('Job is not in a payable state');
        }

        try {
            // Create Razorpay Order
            const order = await this.razorpayService.createOrder(
                Number(job.payable_amount),
                'INR',
                `rcpt_${job.job_id.substring(0, 30)}`,
            );

            // Create Payment Record (or update if exists)
            await this.prisma.payment.upsert({
                where: { job_id: job.job_id },
                update: {
                    razorpay_order_id: order.id,
                    amount: job.payable_amount,
                    status: 'created',
                },
                create: {
                    job_id: job.job_id,
                    razorpay_order_id: order.id,
                    amount: job.payable_amount,
                    currency: 'INR',
                    status: 'created',
                },
            });

            return order;
        } catch (error) {
            // Log the error 
            console.error('Razorpay Error:', error);
            throw new InternalServerErrorException(error.message || 'Failed to create payment order');
        }
    }
}
