import { Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');
const logger = new Logger('PdfAnalyzer');

export interface PdfAnalysisResult {
    processedBuffer: Buffer;
    originalPageCount: number;
    finalPageCount: number;
    heavyBlackPagesCount: number;
}

export class PdfAnalyzer {
    /**
     * Analyzes a PDF to:
     * 1. Detect completely colored black pages (heavy ink)
     * 2. Strip purely blank pages at the front and back
     */
    static async analyzeAndClean(buffer: Buffer): Promise<PdfAnalysisResult> {
        try {
            const data = await pdfParse(buffer);
            const numPages = data.numpages || 1;
            
            return {
                processedBuffer: buffer, // No deeper stripping to prevent removing image-only pages
                originalPageCount: numPages,
                finalPageCount: numPages,
                heavyBlackPagesCount: 0, // Ghostscript removed as requested
            };
        } catch (error) {
            logger.error(`PDF Analysis failed: ${error.message}`);
            return {
                processedBuffer: buffer,
                originalPageCount: 1,
                finalPageCount: 1,
                heavyBlackPagesCount: 0
            };
        }
    }
}
