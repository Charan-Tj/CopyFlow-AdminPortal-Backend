import { Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');
const logger = new Logger('PdfAnalyzer');

export interface PdfAnalysisResult {
    processedBuffer: Buffer;
    originalPageCount: number;
    finalPageCount: number;
    heavyBlackPagesCount: number;
    blankPageCount: number;
}

/**
 * Counts non-blank pages in a PDF.
 *
 * Strategy: pdf-parse renders each page through a custom page-done callback.
 * A page is considered blank if its extracted text (after stripping whitespace)
 * is empty. We tally the non-blank pages and return that as the billable count.
 *
 * Edge cases:
 * - Image-only PDFs (scanned docs): every page will look blank to the text
 *   extractor. In that case we fall back to the total page count so the user
 *   is never under-billed by accident.
 * - Parse errors: fall back to total page count.
 */
export async function countNonBlankPages(buffer: Buffer): Promise<{ total: number; nonBlank: number; blank: number }> {
    try {
        const pageLengths: number[] = [];

        const options = {
            // Called once per page with the text extracted from that page
            pagerender: (pageData: any) => {
                return pageData.getTextContent().then((textContent: any) => {
                    const text = textContent.items.map((item: any) => item.str).join('').trim();
                    pageLengths.push(text.length);
                    return text; // return value is ignored by pdf-parse
                });
            },
        };

        const data = await pdfParse(buffer, options);
        const total = data.numpages || 1;

        // If pagerender fired for every page, use it; otherwise fall back.
        if (pageLengths.length === 0) {
            // No page-level data available — treat all pages as non-blank.
            return { total, nonBlank: total, blank: 0 };
        }

        const blankCount = pageLengths.filter(len => len === 0).length;
        const nonBlankCount = total - blankCount;

        // Safety net: if every single page appears blank it's almost certainly
        // a scanned / image-only PDF. Don't charge 0 pages — charge full total.
        if (nonBlankCount === 0) {
            logger.warn(`PDF appears to be image-only (${total} pages, 0 text pages). Charging full page count.`);
            return { total, nonBlank: total, blank: 0 };
        }

        logger.log(`PDF analysis: ${total} total pages, ${nonBlankCount} non-blank, ${blankCount} blank (skipped).`);
        return { total, nonBlank: nonBlankCount, blank: blankCount };

    } catch (error) {
        logger.error(`PDF blank-page analysis failed: ${error.message}`);
        // On any error, fall back to pdf-parse basic parse
        try {
            const data = await pdfParse(buffer);
            const total = data.numpages || 1;
            return { total, nonBlank: total, blank: 0 };
        } catch {
            return { total: 1, nonBlank: 1, blank: 0 };
        }
    }
}

export class PdfAnalyzer {
    /**
     * Analyzes a PDF to:
     * 1. Count total vs non-blank (billable) pages
     * 2. Return the original buffer unchanged (no mutation)
     */
    static async analyzeAndClean(buffer: Buffer): Promise<PdfAnalysisResult> {
        const { total, nonBlank, blank } = await countNonBlankPages(buffer);
        return {
            processedBuffer: buffer,
            originalPageCount: total,
            finalPageCount: nonBlank,
            heavyBlackPagesCount: 0,
            blankPageCount: blank,
        };
    }
}
