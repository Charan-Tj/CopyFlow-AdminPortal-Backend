import { Module, forwardRef } from '@nestjs/common';
import { PrintService } from './print.service';
import { PrintController } from './print.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [forwardRef(() => WhatsappModule)],
    controllers: [PrintController],
    providers: [PrintService],
    exports: [PrintService], // Make PrintService available for other modules
})
export class PrintModule { }
