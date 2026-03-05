import { Controller, Post, Body, HttpCode, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrintService } from './print.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Controller('print')
export class PrintController {
    private readonly logger = new Logger(PrintController.name);

    constructor(
        private readonly printService: PrintService,
        @Inject(forwardRef(() => WhatsappService))
        private readonly whatsappService: WhatsappService
    ) { }

    @Post('acknowledge')
    @HttpCode(200)
    async acknowledgePrint(@Body() body: { jobId: string; status: string }) {
        this.logger.log(`Received print acknowledgment for job: ${body.jobId}, status: ${body.status}`);

        if (body.status === 'completed') {
            const sender = this.printService.getSenderForJob(body.jobId);
            if (sender) {
                await this.whatsappService.tellStudentJobIsPrinting(sender);
            } else {
                this.logger.warn(`No sender found for jobId: ${body.jobId}`);
            }
        }

        return { success: true };
    }
}
