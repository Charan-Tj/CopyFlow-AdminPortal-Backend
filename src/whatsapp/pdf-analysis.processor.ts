import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { WhatsappService } from './whatsapp.service';

@Processor('pdf-analysis-queue')
export class PdfAnalysisProcessor {
    private readonly logger = new Logger(PdfAnalysisProcessor.name);

    constructor(
        private readonly whatsappService: WhatsappService
    ) {}

    @Process({ concurrency: 3 })
    async handleAnalysis(job: Job) {
        const { sender, mediaUrl, mediaContentType, fileNum } = job.data;
        this.logger.log(`Processing PDF analysis job ${job.id} for sender ${sender}...`);

        try {
            await this.whatsappService.processPdfInQueue(sender, mediaUrl, mediaContentType, fileNum);
            this.logger.log(`Successfully completed PDF analysis job ${job.id} for sender ${sender}`);
        } catch (error) {
            this.logger.error(`Failed to process PDF analysis job ${job.id}: ${error.message}`);
            // Inform user about failure
            try {
                await this.whatsappService.sendTextMessage(sender, `❌ Sorry, there was an issue analyzing exactly file ${fileNum}. Please try sending it again.`);
            } catch (err) {
                this.logger.error(`Failed to send error notification back to ${sender}`);
            }
            throw error; // Let Bull retry/fail job
        }
    }
}
