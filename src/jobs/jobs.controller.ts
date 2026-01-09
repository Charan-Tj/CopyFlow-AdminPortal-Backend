import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { KioskAuthGuard } from '../common/guards/kiosk-auth.guard';

@Controller('kiosks/:pi_id/jobs')
@UseGuards(KioskAuthGuard)
export class JobsController {
    constructor(private readonly jobsService: JobsService) { }

    @Post()
    create(@Param('pi_id') kioskId: string, @Body() createJobDto: CreateJobDto) {
        return this.jobsService.createJob(kioskId, createJobDto);
    }
}
