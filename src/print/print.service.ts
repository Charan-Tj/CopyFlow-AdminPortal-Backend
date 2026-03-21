import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { NodeGateway } from '../node/node.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../r2/r2.service';

@Injectable()
export class PrintService {
    private readonly logger = new Logger(PrintService.name);
    private activeJobs = new Map<string, string>(); // jobId -> sender

    constructor(
        @Inject(forwardRef(() => NodeGateway))
        private readonly nodeGateway: NodeGateway,
        private readonly prisma: PrismaService,
        private readonly r2Storage: R2Service
    ) {
        require('dotenv').config();
    }

    private normalizeFileEntries(fileUrls: any, fallbackCopies: number): Array<{ url: string; copies: number }> {
        if (!Array.isArray(fileUrls)) {
            return [];
        }

        return fileUrls
            .map((item: any) => {
                if (typeof item === 'string') {
                    const url = item.trim();
                    if (!url) {
                        return null;
                    }
                    return { url, copies: fallbackCopies };
                }

                if (item && typeof item === 'object') {
                    const url = String(item.url || '').trim();
                    if (!url) {
                        return null;
                    }

                    const rawCopies = Number(item.copies ?? fallbackCopies);
                    return {
                        url,
                        copies: Number.isFinite(rawCopies) && rawCopies > 0 ? rawCopies : fallbackCopies
                    };
                }

                return null;
            })
            .filter((entry): entry is { url: string; copies: number } => Boolean(entry));
    }

    async sendJobToPrinter(jobData: any): Promise<boolean> {
        try {
            this.logger.log(`Storing confirmed print job to database with status PAID: ${jobData.jobId}`);

            if (jobData.jobId && jobData.sender) {
                this.activeJobs.set(jobData.jobId, jobData.sender);
            }

            // Create job record in database instead of just finding it, since WhatsApp flow doesn't create it beforehand.
            const isColor = jobData.color === true || String(jobData.color).toLowerCase() === 'true';
            const isDuplex = jobData.sides === 'double';
            const basePrice = isColor ? 10 : 2;
            const duplexSurcharge = isDuplex ? (isColor ? 10 : 1) : 0;
            const pricePerPage = basePrice + duplexSurcharge;
            const safePages = Number.isFinite(Number(jobData.pages)) && Number(jobData.pages) > 0 ? Number(jobData.pages) : 1;
            const universalCopies = Number(jobData.copies || 1);
            const safeUniversalCopies = Number.isFinite(universalCopies) && universalCopies > 0 ? universalCopies : 1;
            const providedPrice = Number(jobData.price);
            const totalAmount = Number.isFinite(providedPrice) && providedPrice > 0
                ? providedPrice
                : safePages * safeUniversalCopies * pricePerPage;
            const normalizedFileEntries = this.normalizeFileEntries(jobData.fileUrls, safeUniversalCopies);
            const primaryFileUrl = jobData.fileUrl || normalizedFileEntries[0]?.url || null;
            const fileMeta = Array.isArray(jobData.files) ? jobData.files.find((entry: any) => entry && typeof entry === 'object') : null;
            const documentName = String(jobData.documentName || fileMeta?.name || 'Document').trim() || 'Document';
            const rawUserName = String(jobData.userName || jobData.customerName || jobData.sender || 'Unknown').trim() || 'Unknown';
            const userName = rawUserName.replace(/^(web|whatsapp|telegram):/i, '');

            // Generate a random Kiosk ID for DB requirement if not provided
            let dummyKioskId = `kiosk_${jobData.nodeId}_1`;
            if (!jobData.nodeId) {
                this.logger.error(`nodeId is missing in jobData for jobId: ${jobData.jobId}`);
                return false;
            }

            const existingJob = await this.prisma.printJob.findUnique({
                where: { job_id: jobData.jobId },
                select: { job_id: true, node_id: true }
            });

            if (existingJob) {
                this.logger.log(`Print job already exists for jobId=${jobData.jobId}; skipping duplicate create.`);
                return true;
            }

            // Ensure kiosk exists
            let kiosk = await this.prisma.kiosk.findUnique({
                where: { pi_id: dummyKioskId }
            });

            if (!kiosk) {
                kiosk = await this.prisma.kiosk.create({
                    data: {
                        pi_id: dummyKioskId,
                        node_id: jobData.nodeId,
                        secret: 'auto_generated',
                        paper_level: 'HIGH'
                    }
                });
            }

            const jobRecord = await this.prisma.printJob.create({
                data: {
                    job_id: jobData.jobId,
                    node_id: jobData.nodeId,
                    kiosk_id: dummyKioskId,
                    phone_number: jobData.sender,  // keep platform prefix for routing
                    copies: safeUniversalCopies,
                    sides: jobData.sides || 'single',
                    file_urls:
                        normalizedFileEntries.length > 0
                            ? normalizedFileEntries
                            : (primaryFileUrl ? [{ url: primaryFileUrl, copies: safeUniversalCopies }] : undefined),
                    page_count: safePages,
                    color_mode: isColor ? 'COLOR' : 'BW',
                    status: 'PAID',
                    payable_amount: totalAmount,
                    user_name: userName,
                    document_name: documentName,
                    assigned_printer: jobData.printerName || null,
                }
            });

            const signedUrls = await this.generateSignedFileUrls(
                Array.isArray(jobRecord.file_urls)
                    ? (jobRecord.file_urls as any[])
                    : []
            );
            const signedUrl = signedUrls[0]?.url || '';

            this.nodeGateway.emitToNode(jobRecord.node_id, 'new-job', {
                jobId: jobRecord.job_id,
                fileUrl: signedUrl,
                fileUrls: signedUrls,
                copies: jobRecord.copies,
                color: jobRecord.color_mode === 'COLOR',
                sides: jobRecord.sides,
                pages: jobRecord.page_count
            });

            this.logger.log(`Successfully emitted 'new-job' WebSocket event to node_${jobRecord.node_id}`);
            return true;
        } catch (error: any) {
            if (error?.code === 'P2002') {
                this.logger.warn(`Duplicate print job create ignored for jobId=${jobData.jobId}`);
                return true;
            }
            this.logger.error(`Failed to push job to node: ${error.message}`);
            return false;
        }
    }

    async generateSignedFileUrl(fileUrl: string): Promise<string> {
        if (!fileUrl) return '';
        // E.g., fileUrl might be https://...supabase.co/storage/v1/object/public/copyflow-jobs/upload_xxx.pdf
        const urlParts = fileUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        // Use Supabase Storage to get signed URL
        const publicUrl = await this.r2Storage.getSignedUrl(filename); return publicUrl;
            
            

        /* if (error) {
            this.logger.error(`Error creating signed URL: ${error.message}`);
            return fileUrl; // fallback
        }

        */
    }

    async generateSignedFileUrls(fileUrls: any[]): Promise<Array<{ url: string; copies: number }>> {
        if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
            return [];
        }

        const normalized = this.normalizeFileEntries(fileUrls, 1);
        const signed = await Promise.all(normalized.map(async (entry) => ({
            url: await this.generateSignedFileUrl(entry.url),
            copies: entry.copies
        })));

        return signed.filter((entry) => typeof entry.url === 'string' && entry.url.length > 0);
    }

    getSenderForJob(jobId: string): string | undefined {
        return this.activeJobs.get(jobId);
    }
}
