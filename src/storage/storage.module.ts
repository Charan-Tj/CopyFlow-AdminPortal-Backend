import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';

@Module({
    providers: [SupabaseStorageService],
    exports: [SupabaseStorageService], // Make it available to other modules
})
export class StorageModule {}
