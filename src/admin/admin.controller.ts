import { Controller, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('kiosks')
    @ApiOperation({ summary: 'List all registered Kiosks' })
    getKiosks() {
        return this.adminService.getAllKiosks();
    }

    @Get('jobs')
    @ApiOperation({ summary: 'List recent Print Jobs' })
    getJobs(
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('status') status?: string
    ) {
        return this.adminService.getAllJobs(Number(page) || 1, Number(limit) || 20, status);
    }

    @Get('audit-logs')
    @ApiOperation({ summary: 'List system Audit Logs' })
    getAuditLogs(
        @Query('page') page?: number,
        @Query('limit') limit?: number
    ) {
        return this.adminService.getAuditLogs(Number(page) || 1, Number(limit) || 50);
    }

    @Get('overview')
    @ApiOperation({ summary: 'Get Dashboard Overview Statistics' })
    getOverview() {
        return this.adminService.getOverviewStats();
    }

    @Patch('jobs/:job_id/expire')
    @ApiOperation({ summary: 'Force expire a print job' })
    expireJob(@Param('job_id') jobId: string) {
        return this.adminService.expireJob(jobId);
    }

    @Post('jobs/:job_id/resend-payment')
    @ApiOperation({ summary: 'Resend payment link for a job' })
    resendPayment(@Param('job_id') jobId: string) {
        return this.adminService.resendPayment(jobId);
    }

    @Get('sessions')
    @ApiOperation({ summary: 'Get active WhatsApp sessions' })
    getSessions() {
        return this.adminService.getSessions();
    }

    @Get('queue')
    @ApiOperation({ summary: 'Get current BullMQ print/whatsapp queue status' })
    getQueue() {
        return this.adminService.getQueueStatus();
    }
}
