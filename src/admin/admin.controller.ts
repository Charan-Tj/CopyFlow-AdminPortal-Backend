import { Controller, Get, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Admin')
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
}
