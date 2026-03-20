import { Controller, Get, Post, Patch, Param, Query, UseGuards, Body, Request } from '@nestjs/common';
import { AdminService } from './admin.service';
import { NodeService } from '../node/node.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminController {
    constructor(
        private readonly adminService: AdminService,
        private readonly nodeService: NodeService
    ) { }

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

    // ====== NODE SYSTEM ENDPOINTS ====== //

    @Get('nodes')
    @ApiOperation({ summary: 'List all registered Nodes' })
    getNodes() {
        return this.adminService.getAllNodes();
    }

    @Get('nodes/:id')
    @ApiOperation({ summary: 'Get details for a specific Node' })
    getNode(@Param('id') id: string) {
        return this.adminService.getNode(id);
    }

    @Post('nodes')
    @ApiOperation({ summary: 'Register a new Node' })
    createNode(@Body() body: any) {
        return this.adminService.createNode(body);
    }

    @Patch('nodes/:id/toggle')
    @ApiOperation({ summary: 'Toggle Node active status' })
    toggleNode(@Param('id') id: string) {
        return this.adminService.toggleNode(id);
    }

    @Post('nodes/:id/credentials')
    @ApiOperation({ summary: 'Create operator credentials for a node' })
    createNodeCredentials(@Param('id') id: string, @Body() body: any) {
        return this.adminService.createNodeCredentials(id, body.email, body.password);
    }

    @Patch('nodes/:id/credentials/reset')
    @ApiOperation({ summary: 'Reset operator password for a node credential' })
    resetNodeCredentialPassword(@Param('id') id: string, @Body() body: any, @Request() req: any) {
        return this.adminService.resetNodeCredentialPassword(id, body.email, body.password);
    }

    @Get('nodes/:id/qr')
    @ApiOperation({ summary: 'Generate WhatsApp QR code for a node' })
    getNodeQr(@Param('id') id: string) {
        return this.adminService.generateNodeQr(id);
    }

    @Post('nodes/:id/registration-code')
    @ApiOperation({ summary: 'Generate one-time registration code for node' })
    generateRegistrationCode(@Param('id') id: string, @Request() req: any) {
        const adminEmail = req.user?.email || req.user?.sub || 'admin';
        return this.nodeService.generateRegistrationCode(id, adminEmail);
    }
}
