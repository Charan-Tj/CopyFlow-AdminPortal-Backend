import { Controller, Post, Get, Body, Param, UseGuards, UnauthorizedException, Request, Patch } from '@nestjs/common';
import { NodeService } from './node.service';
import { NodeAuthGuard } from '../common/guards/node-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';

@ApiTags('Node')
@ApiBearerAuth()
@Controller('node')
export class NodeController {
    constructor(private readonly nodeService: NodeService) { }

    @Post('auth/login')
    @ApiOperation({ summary: 'Node Operator Login' })
    @ApiBody({ schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } } })
    async login(@Body() body: any) {
        if (!body.email || !body.password) {
            throw new UnauthorizedException('Email and password required');
        }
        return this.nodeService.login(body.email, body.password);
    }

    // ---- Self-Registration (public — no guard) ----

    @Post('register/validate')
    @ApiOperation({ summary: 'Validate a one-time registration code (preview only, does not consume it)' })
    @ApiBody({ schema: { type: 'object', properties: { registration_code: { type: 'string' } }, required: ['registration_code'] } })
    async validateRegistrationCode(@Body() body: any) {
        return this.nodeService.validateRegistrationCode(body.registration_code);
    }

    @Post('register')
    @ApiOperation({ summary: 'Register node using one-time code' })
    @ApiBody({ schema: { type: 'object', properties: { registration_code: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' } }, required: ['registration_code', 'email', 'password'] } })
    async registerNode(@Body() body: any) {
        return this.nodeService.registerNode(body.registration_code, body.email, body.password);
    }

    @UseGuards(NodeAuthGuard)
    @Post('heartbeat')
    @ApiOperation({ summary: 'Send kiosk heartbeat and printer status' })
    @ApiBody({ schema: { type: 'object', properties: { paper_level: { type: 'string' }, printers: { type: 'array' } } } })
    async heartbeat(@Request() req: any, @Body() body: any) {
        const nodeId = req.node.nodeId;
        const { paper_level = 'HIGH', printers = [] } = body;
        return this.nodeService.updateHeartbeat(nodeId, paper_level, printers);
    }

    @UseGuards(NodeAuthGuard)
    @Get('jobs')
    @ApiOperation({ summary: 'Get pending print jobs for the node' })
    async getJobs(@Request() req: any) {
        const nodeId = req.node.nodeId;
        return this.nodeService.getPendingJobs(nodeId);
    }

    @UseGuards(NodeAuthGuard)
    @Post('jobs/:job_id/acknowledge')
    @ApiOperation({ summary: 'Acknowledge job printed successfully' })
    async acknowledgeJob(@Request() req: any, @Param('job_id') jobId: string) {
        const nodeId = req.node.nodeId;
        return this.nodeService.acknowledgeJob(nodeId, jobId);
    }

    @UseGuards(NodeAuthGuard)
    @Patch('jobs/:job_id/claim')
    @ApiOperation({ summary: 'Claim a print job for processing' })
    async claimJob(@Request() req: any, @Param('job_id') jobId: string) {
        const nodeId = req.node.nodeId;
        return this.nodeService.claimJob(nodeId, jobId);
    }

    @UseGuards(NodeAuthGuard)
    @Post('jobs/:job_id/fail')
    @ApiOperation({ summary: 'Report a print job as failed' })
    @ApiBody({ schema: { type: 'object', properties: { reason: { type: 'string' }, error_code: { type: 'string' } } } })
    async failJob(@Request() req: any, @Param('job_id') jobId: string, @Body() body: any) {
        const nodeId = req.node.nodeId;
        return this.nodeService.failJob(nodeId, jobId, body.reason, body.error_code);
    }
}
