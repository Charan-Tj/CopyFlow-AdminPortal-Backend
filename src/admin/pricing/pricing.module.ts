import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PricingController],
})
export class PricingModule { }
