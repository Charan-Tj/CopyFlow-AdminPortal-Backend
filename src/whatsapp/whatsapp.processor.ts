import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { WhatsappService } from './whatsapp.service';
import { Logger } from '@nestjs/common';

@Processor('whatsapp-messages')
export class WhatsappProcessor {
    private readonly logger = new Logger(WhatsappProcessor.name);

    constructor(private readonly whatsappService: WhatsappService) { }

    @Process('process-incoming')
    async handleIncomingJob(job: Job) {
        this.logger.log(`Started processing WhatsApp job ${job.id} for sender ${job.data.sender}`);
        try {
            const { sender, message, mediaUrl, mediaContentType, interactiveData } = job.data;
            await this.whatsappService.handleIncomingMessage(sender, message, mediaUrl, mediaContentType, interactiveData);
            this.logger.log(`Successfully completed WhatsApp job ${job.id}`);
        } catch (error: any) {
            this.logger.error(`Failed to process WhatsApp job ${job.id}: ${error.message}`);
            throw error; // Let Bull handle retries
        }
    }
}
