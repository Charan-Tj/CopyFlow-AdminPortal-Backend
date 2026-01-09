import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { PricingService } from './pricing/pricing.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TokensService } from './tokens/tokens.service';
import { TokensController } from './tokens/tokens.controller';

@Module({
  imports: [PrismaModule],
  controllers: [JobsController, TokensController],
  providers: [JobsService, PricingService, TokensService],
})
export class JobsModule { }
