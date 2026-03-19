import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2Service {
    private readonly logger = new Logger(R2Service.name);
    private readonly s3Client: S3Client;
    private readonly bucketName = process.env.R2_BUCKET_NAME || 'copyflow-jobs';

    constructor() {
        this.s3Client = new S3Client({
            region: 'auto',
            endpoint: process.env.R2_ENDPOINT,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
            },
        });
    }

    async uploadFile(filename: string, fileBuffer: Buffer, mimeType: string): Promise<string> {
        this.logger.log(`Uploading file ${filename} to R2 bucket ${this.bucketName}...`);
        
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: filename,
                Body: fileBuffer,
                ContentType: mimeType,
            });

            await this.s3Client.send(command);

            this.logger.log(`File uploaded successfully to R2. Key: ${filename}`);
            
            // Return just the key to save in DB, per user requirement "key ko DB mein save karo"
            return filename;
        } catch (error) {
            this.logger.error(`Error uploading to R2: ${error.message}`);
            throw error;
        }
    }

    async getSignedUrl(filename: string, expiresIn: number = 3600): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: filename,
            });

            const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
            return signedUrl;
        } catch (error) {
            this.logger.error(`Error generating signed URL for ${filename}: ${error.message}`);
            throw error;
        }
    }

    async deleteFile(filename: string): Promise<void> {
        this.logger.log(`Deleting file ${filename} from R2 bucket ${this.bucketName}...`);
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: filename,
            });

            await this.s3Client.send(command);
            this.logger.log(`File deleted successfully from R2: ${filename}`);
        } catch (error) {
            this.logger.error(`Error deleting from R2: ${error.message}`);
            throw error;
        }
    }
}
