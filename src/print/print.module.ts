import { Module } from '@nestjs/common';
import { PrintService } from './print.service';

@Module({
    providers: [PrintService],
    exports: [PrintService], // Make PrintService available for other modules
})
export class PrintModule { }
