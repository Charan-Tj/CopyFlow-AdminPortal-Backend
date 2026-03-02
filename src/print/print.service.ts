import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PrintService {
    private readonly logger = new Logger(PrintService.name);

    /**
     * Service for sending confirmed print jobs to the Raspberry Pi CUPS Server
     */
    async sendJobToPrinter(jobData: any): Promise<boolean> {
        const cupsUrl = process.env.CUPS_SERVER_URL;

        if (!cupsUrl) {
            this.logger.error('CUPS_SERVER_URL environment variable is missing.');
            return false;
        }

        try {
            this.logger.log(`Sending confirmed print job to CUPS server via HTTP at ${cupsUrl}`);

            const response = await fetch(`${cupsUrl}/print`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jobData),
            });

            if (!response.ok) {
                throw new Error(`Failed with HTTP status: ${response.status}`);
            }

            this.logger.log('Successfully sent job to remote printer server');
            return true;
        } catch (error) {
            this.logger.error(`Failed to send print job to CUPS: ${error.message}`);
            return false;
        }
    }
}
