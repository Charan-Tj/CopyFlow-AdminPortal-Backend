import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SupabaseStorageService } from '../src/storage/supabase-storage.service';
import * as fs from 'fs';
require('dotenv').config();

async function bootstrap() {
    console.log('Initializing NestJS application context...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const supabaseService = app.get(SupabaseStorageService);

    try {
        console.log('Reading PDF file...');
        const buffer = fs.readFileSync('./bemr101.pdf');
        const filename = `test_upload_${Date.now()}.pdf`;

        console.log(`Uploading ${filename} to Supabase...`);
        const publicUrl = await supabaseService.uploadFile(buffer, filename, 'application/pdf');
        console.log(`✅ Upload successful! Public URL: ${publicUrl}`);

        console.log(`Waiting 3 seconds before testing deletion...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`Deleting ${filename} from Supabase...`);
        await supabaseService.deleteFile(filename);
        console.log('✅ Delete successful! The file is removed from the storage bucket.');
    } catch (error) {
        console.error('❌ Error during testing:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
