import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NodeModule } from '../node/node.module';
import { KioskApiController } from './kiosk-api.controller';
import { KioskApiService } from './kiosk-api.service';

@Module({
  imports: [PrismaModule, NodeModule],
  controllers: [KioskApiController],
  providers: [KioskApiService],
})
export class KioskApiModule {}
