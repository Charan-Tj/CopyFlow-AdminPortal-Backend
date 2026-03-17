import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import { PhonepeService } from '../payment/phonepe/phonepe.service';
import { CashfreeService } from '../payment/cashfree/cashfree.service';
import { PaymentService } from '../payment/payment.service';
import { SubmitPrintOrderDto } from './dto/submit-print-order.dto';

interface MulterFile {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
}
const pdfParse = require('pdf-parse');
import * as mammoth from 'mammoth';

interface UploadedFileResult {
    url: string;
    pages: number;
    name: string;
}

@Injectable()
export class WebFormService {
    private readonly logger = new Logger(WebFormService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly supabaseStorage: SupabaseStorageService,
        private readonly razorpayService: RazorpayService,
        private readonly phonepeService: PhonepeService,
        private readonly cashfreeService: CashfreeService,
        private readonly paymentService: PaymentService,
    ) {}

    async getJobStatus(jobId: string) {
        const job = await this.prisma.printJob.findUnique({
            where: { job_id: jobId },
            select: { status: true }
        });

        if (job) {
            return { paid: true, status: job.status };
        }

        // Check if it's still just a ChatSession
        const session = await this.prisma.chatSession.findFirst({
            where: { job_id: jobId }
        });

        if (session) {
            const sessionData = session.data as any;
            if (sessionData && (sessionData.step === 'PAID' || sessionData.step === 'PRINTED')) {
                return { paid: true, status: sessionData.step };
            }

            // Actively verify with Cashfree as fallback if webhook was missed/blocked
            const isCashfreePaid = await this.cashfreeService.checkOrderStatus(jobId);
            if (isCashfreePaid) {
                // Manually trigger the process that upgrades session to printJob
                this.logger.log(`Active check found Cashfree order ${jobId} PAID, processing...`);
                await this.paymentService.processPaymentAndTriggerPrint(jobId, {});
                return { paid: true, status: 'PAID' }; // It might be UPLOADED in the db, but it's paid
            }

            return { paid: false, status: 'AWAITING_PAYMENT' };
        }

        throw new NotFoundException(`Job ${jobId} not found`);
    }

    async getActiveNodes() {
        return this.prisma.node.findMany({
            where: { is_active: true },
            select: {
                node_code: true,
                name: true,
                college: true,
                city: true,
                address: true,
            },
            orderBy: { name: 'asc' },
        });
    }

    async getPricing() {
        const config = await this.prisma.pricingConfig.findFirst({
            where: { active: true },
            orderBy: { createdAt: 'desc' },
        });
        return {
            bw_price: config ? Number(config.bw_price) : 2.0,
            color_price: config ? Number(config.color_price) : 10.0,
        };
    }

    async submitOrder(
        files: MulterFile[],
        dto: SubmitPrintOrderDto,
    ) {
        if (!files || files.length === 0) {
            throw new BadRequestException('At least one file is required');
        }

        // Resolve shop node
        let node: any;
        if (dto.node_code) {
            node = await this.prisma.node.findFirst({
                where: {
                    node_code: { equals: dto.node_code, mode: 'insensitive' },
                    is_active: true,
                },
                select: { id: true, node_code: true, name: true }
            });
            if (!node) {
                throw new NotFoundException(`Shop "${dto.node_code}" not found or inactive`);
            }
        } else {
            node = await this.prisma.node.findFirst({
                where: { is_active: true },
                orderBy: { created_at: 'asc' },
                select: { id: true, node_code: true, name: true }
            });
            if (!node) {
                throw new NotFoundException('No active print shops available');
            }
        }

        // Upload and analyse each file
        const uploadedFiles: UploadedFileResult[] = [];
        for (const file of files) {
            const result = await this.processAndUploadFile(file);
            uploadedFiles.push(result);
        }

        const totalPages = uploadedFiles.reduce((sum, f) => sum + f.pages, 0);

        // Calculate price from live pricing config
        const pricing = await this.getPricing();
        const pricePerPage = dto.color_mode === 'COLOR' ? pricing.color_price : pricing.bw_price;
        const totalPrice = totalPages * dto.copies * pricePerPage;

        // Unique reference ID for this order
        const referenceId = `web_${Date.now()}`;
        const sender = `web:${dto.phone_number}`;

        // Persist a ChatSession so the payment webhook can resolve the job
        const sessionData = {
            step: 'AWAITING_PAYMENT',
            nodeId: node.id,
            nodeCode: node.node_code,
            files: uploadedFiles,
            pages: totalPages,
            copies: dto.copies,
            color: dto.color_mode === 'COLOR',
            sides: dto.sides,
            price: totalPrice,
            jobId: referenceId,
            sender,
            platform: 'web',
            startedAt: Date.now(),
        };

        await this.prisma.chatSession.upsert({
            where: { sender },
            create: {
                sender,
                job_id: referenceId,
                node_id: node.id,
                data: sessionData as any,
            },
            update: {
                job_id: referenceId,
                node_id: node.id,
                data: sessionData as any,
            },
        });

        // Build payment links
        const colorLabel = dto.color_mode === 'COLOR' ? 'Color' : 'Black & White';
        const description = `CopyFlow Print (${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''}, ${dto.copies}x ${dto.sides} ${colorLabel})`;

        const razorpayObj = await this.razorpayService.createPaymentLink(
            totalPrice,
            referenceId,
            description,
            dto.phone_number,
        );
        const razorpayLink: string = razorpayObj.short_url;

        let phonepeLink: string | null = null;
        try {
            phonepeLink = await this.phonepeService.createPaymentLink(
                totalPrice,
                referenceId,
                dto.phone_number,
            );
        } catch (err) {
            this.logger.warn(`PhonePe link could not be generated: ${err.message}`);
        }

        let cashfreeLink: string | null = null;
        try {
            cashfreeLink = await this.cashfreeService.createPaymentLink(
                totalPrice,
                referenceId,
                dto.phone_number,
                description
            );
        } catch (err) {
            this.logger.warn(`Cashfree link could not be generated: ${err.message}`);
        }

        return {
            job_id: referenceId,
            total_pages: totalPages,
            file_count: uploadedFiles.length,
            copies: dto.copies,
            color_mode: dto.color_mode,
            sides: dto.sides,
            price: totalPrice,
            price_per_page: pricePerPage,
            razorpay_link: razorpayLink,
            phonepe_link: phonepeLink,
            cashfree_link: cashfreeLink,
            node_name: node.name,
            node_code: node.node_code,
            college: node.college,
            city: node.city,
        };
    }

    private async processAndUploadFile(file: MulterFile): Promise<UploadedFileResult> {
        const mime = file.mimetype.toLowerCase();
        const extension = this.mimeToExtension(mime);
        const fileName = `upload_${Date.now()}_${Math.floor(Math.random() * 10000)}.${extension}`;

        let supabaseUrl: string;
        try {
            supabaseUrl = await this.supabaseStorage.uploadFile(file.buffer, fileName, mime);
        } catch (err) {
            this.logger.error(`Failed to upload "${file.originalname}": ${err.message}`);
            throw new BadRequestException(`Could not upload file: ${file.originalname}`);
        }

        let pages = 1;
        try {
            if (mime.includes('pdf')) {
                const data = await pdfParse(file.buffer);
                pages = data.numpages || 1;
            } else if (mime.includes('word') || mime.includes('document')) {
                const result = await mammoth.extractRawText({ buffer: file.buffer });
                const wordCount = result.value.split(/\s+/).filter((w: string) => w.length > 0).length;
                pages = Math.max(1, Math.ceil(wordCount / 250));
            }
            // images = 1 page (default)
        } catch (err) {
            this.logger.warn(`Page count failed for "${file.originalname}", defaulting to 1: ${err.message}`);
            pages = 1;
        }

        return { url: supabaseUrl, pages, name: fileName };
    }

    private mimeToExtension(mime: string): string {
        if (mime.includes('pdf')) return 'pdf';
        if (mime.includes('word') || mime.includes('document')) return 'docx';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if (mime.includes('png')) return 'png';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('tiff')) return 'tiff';
        if (mime.includes('bmp')) return 'bmp';
        const parts = mime.split('/');
        return parts.length > 1 ? parts[1].split(';')[0] : 'bin';
    }
}
