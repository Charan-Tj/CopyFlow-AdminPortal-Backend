import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseStorageService {
    private readonly logger = new Logger(SupabaseStorageService.name);
    private supabase: SupabaseClient;
    private bucketName: string;

    constructor() {
        require('dotenv').config();
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        this.bucketName = process.env.SUPABASE_BUCKET_NAME || 'copyflow-jobs';

        if (!supabaseUrl || !supabaseKey) {
            this.logger.warn('Supabase configuration missing in Environment Variables. (SUPABASE_URL=' + !!supabaseUrl + ', SUPABASE_SERVICE_ROLE_KEY=' + !!supabaseKey + ')');
        } else {
            this.supabase = createClient(supabaseUrl, supabaseKey);
        }
    }

    async uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
        if (!this.supabase) {
            this.logger.error('Cannot upload to Supabase: Client not initialized.');
            throw new Error('Supabase client not initialized');
        }

        try {
            const { data, error } = await this.supabase.storage
                .from(this.bucketName)
                .upload(filename, buffer, {
                    contentType: mimeType,
                    upsert: true,
                });

            if (error) {
                this.logger.error(`Supabase upload error: ${error.message}`);
                throw error;
            }

            const { data: publicUrlData } = this.supabase.storage
                .from(this.bucketName)
                .getPublicUrl(filename);

            this.logger.log(`Successfully uploaded file to Supabase: ${filename}`);
            return publicUrlData.publicUrl;
        } catch (err) {
            this.logger.error(`Failed to upload file to Supabase: ${err.message}`);
            throw err;
        }
    }

    async deleteFile(filename: string): Promise<void> {
        if (!this.supabase) {
            this.logger.error('Cannot delete from Supabase: Client not initialized.');
            return;
        }

        try {
            const { error } = await this.supabase.storage
                .from(this.bucketName)
                .remove([filename]);

            if (error) {
                this.logger.error(`Supabase delete error: ${error.message}`);
                throw error;
            }

            this.logger.log(`Successfully deleted file from Supabase: ${filename}`);
        } catch (err) {
            this.logger.error(`Failed to delete file from Supabase: ${err.message}`);
        }
    }
}
