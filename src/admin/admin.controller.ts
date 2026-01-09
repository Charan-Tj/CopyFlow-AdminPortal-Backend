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
    getJobs(@Query('limit') limit?: string) {
        return this.adminService.getAllJobs(Number(limit) || 20);
    }

    @Get('audit-logs')
    @ApiOperation({ summary: 'List system Audit Logs' })
    getAuditLogs(@Query('limit') limit?: string) {
        return this.adminService.getAuditLogs(Number(limit) || 50);
    }
}
