import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class PrintService {
    private readonly logger = new Logger(PrintService.name);

    private activeJobs = new Map<string, string>(); // jobId -> sender

    constructor() {
        require('dotenv').config();
    }

    /**
     * Service for sending confirmed print jobs to the Raspberry Pi CUPS Server
     */
    async sendJobToPrinter(jobData: any): Promise<boolean> {
        const cupsUrl = process.env.CUPS_SERVER_URL || 'http://localhost:6310';

        if (!cupsUrl) {
            this.logger.error('CUPS_SERVER_URL environment variable is missing.');
            return false;
        }

        try {
            this.logger.log(`Sending confirmed print job to CUPS server via HTTP at ${cupsUrl}`);

            if (jobData.jobId && jobData.sender) {
                this.activeJobs.set(jobData.jobId, jobData.sender);
            }

            const response = await axios.post(`${cupsUrl}/print`, jobData, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 5000 // Don't hang forever if printer is offline
            });

            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`Failed with HTTP status: ${response.status}`);
            }

            this.logger.log('Successfully sent job to remote printer server');
            return true;
        } catch (error) {
            this.logger.error(`Failed to send print job to CUPS: ${error.message}`);
            return false;
        }
    }

    getSenderForJob(jobId: string): string | undefined {
        return this.activeJobs.get(jobId);
    }
}
