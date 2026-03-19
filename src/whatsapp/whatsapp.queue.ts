import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class WhatsappQueueService {
    private readonly logger = new Logger(WhatsappQueueService.name);
    private waiting: any[] = [];
    private active: any[] = [];
    private completed: any[] = [];
    private failed: any[] = [];
    private isProcessing = false;

    constructor(
        @Inject(forwardRef(() => WhatsappService))
        private readonly whatsappService: WhatsappService
    ) { }

    async add(name: string, data: any, opts?: any) {
        const job = {
            id: Date.now().toString() + Math.random().toString().slice(2, 6),
            name,
            data,
            timestamp: Date.now()
        };
        this.waiting.push(job);

        // Start processing asynchronously off the main event loop
        setTimeout(() => this.processNext(), 0);
        return job;
    }

    private async processNext() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.waiting.length > 0) {
            const job = this.waiting.shift();
            job.processedOn = Date.now();
            this.active.push(job);

            try {
                this.logger.log(`Processing WhatsApp job ${job.id} for sender ${job.data.sender}`);
                await this.whatsappService.handleIncomingMessage(
                    job.data.sender,
                    job.data.message,
                    job.data.mediaUrl,
                    job.data.mediaContentType,
                    job.data.interactiveData,
                    job.data.userName
                );
                job.finishedOn = Date.now();
                this.completed.unshift(job);
                this.logger.log(`Successfully completed WhatsApp job ${job.id}`);
            } catch (err: any) {
                this.logger.error(`Failed to process WhatsApp job ${job.id}: ${err.message}`);
                job.failedReason = err.message;
                job.finishedOn = Date.now();
                this.failed.unshift(job);
            } finally {
                this.active = this.active.filter(j => j !== job);

                // Keep recent history
                if (this.completed.length > 100) this.completed.pop();
                if (this.failed.length > 100) this.failed.pop();
            }
        }
        this.isProcessing = false;
    }

    async getWaitingCount() { return this.waiting.length; }
    async getActiveCount() { return this.active.length; }
    async getCompletedCount() { return this.completed.length; }
    async getFailedCount() { return this.failed.length; }

    async getJobs(types: string[]) {
        let jobs: any[] = [];
        if (types.includes('waiting')) jobs.push(...this.waiting);
        if (types.includes('active')) jobs.push(...this.active);
        if (types.includes('completed')) jobs.push(...this.completed);
        if (types.includes('failed')) jobs.push(...this.failed);
        return jobs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
    }
}
