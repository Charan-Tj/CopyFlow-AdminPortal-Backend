import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/r2/r2.service';
import * as fs from 'fs';
require('dotenv').config();

async function bootstrap() {
    console.log('Initializing NestJS application context...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const r2Storage = app.get(R2Service);

    try {
        console.log('Reading PDF file...');
        const buffer = fs.readFileSync('./bemr101.pdf');
        const filename = `test_upload_${Date.now()}.pdf`;

        console.log(`Uploading ${filename} to R2...`);
        const fileKey = await r2Storage.uploadFile(filename, buffer, 'application/pdf');
        console.log(`✅ Upload successful! File Key: ${fileKey}`);

        console.log(`Waiting 3 seconds before testing deletion...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`Deleting ${filename} from R2...`);
        await r2Storage.deleteFile(filename);
        console.log('✅ Delete successful! The file is removed from the storage bucket.');
    } catch (error) {
        console.error('❌ Error during testing:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
