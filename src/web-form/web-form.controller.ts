import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    UploadedFiles,
    UseInterceptors,
    HttpCode,
    HttpStatus,
    BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { WebFormService } from './web-form.service';
import { SubmitPrintOrderDto } from './dto/submit-print-order.dto';

const ALLOWED_MIMETYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/bmp',
];

@ApiTags('Web Form')
@Controller('web-form')
export class WebFormController {
    constructor(private readonly webFormService: WebFormService) {}

    /**
     * List all active print shops for the form dropdown.
     */
    @Get('nodes')
    @ApiOperation({ summary: 'List active print shops' })
    getNodes() {
        return this.webFormService.getActiveNodes();
    }

    /**
     * Return current per-page prices (B&W and colour).
     */
    @Get('pricing')
    @ApiOperation({ summary: 'Get current print pricing' })
    getPricing() {
        return this.webFormService.getPricing();
    }

    /**
     * Check the status of a payment/job.
     */
    @Get('status/:jobId')
    @ApiOperation({ summary: 'Check status of a print order payment' })
    async getStatus(@Param('jobId') jobId: string) {
        return this.webFormService.getJobStatus(jobId);
    }

    /**
     * Submit a print order from the website form.
     *
     * Body (multipart/form-data):
     *   - files        — one or more files (PDF / Word / image), field name "files"
     *   - phone_number — customer phone number
     *   - copies       — number of copies (1–99)
     *   - color_mode   — "BW" or "COLOR"
     *   - sides        — "single" or "double"
     *   - node_code    — (optional) shop code; auto-assigned when omitted
     *
     * Returns job summary + Razorpay (and optional PhonePe) payment links.
     */
    @Post('submit')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Submit print order from website form' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['files', 'phone_number', 'copies', 'color_mode', 'sides'],
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                    description: 'PDF / Word / image files to print (max 10)',
                },
                phone_number: { type: 'string', example: '+919876543210' },
                copies: { type: 'integer', minimum: 1, maximum: 99, example: 1 },
                color_mode: { type: 'string', enum: ['BW', 'COLOR'], example: 'BW' },
                sides: { type: 'string', enum: ['single', 'double'], example: 'single' },
                node_code: { type: 'string', example: 'TESTNODE1', description: 'Optional shop code' },
            },
        },
    })
    @UseInterceptors(
        FilesInterceptor('files', 10, {
            limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
            fileFilter: (_req, file, cb) => {
                if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(
                        new BadRequestException(
                            `Unsupported file type "${file.mimetype}". Allowed: PDF, Word, JPEG, PNG, GIF, WebP, TIFF, BMP`,
                        ),
                        false,
                    );
                }
            },
        }),
    )
    submit(
        @UploadedFiles() files: any[],
        @Body() dto: SubmitPrintOrderDto,
    ) {
        return this.webFormService.submitOrder(files, dto);
    }
}
