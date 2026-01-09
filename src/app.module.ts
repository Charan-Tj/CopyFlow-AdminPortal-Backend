import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [PrismaModule, JobsModule, PaymentsModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
