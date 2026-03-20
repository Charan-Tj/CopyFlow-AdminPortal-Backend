import { Body, Controller, Get, Post, Query, Req, Res, NotFoundException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { KioskApiService } from './kiosk-api.service';

type LoginBody = {
  username?: string;
  email?: string;
  password?: string;
};

type ConnectionBody = {
  serverUrl?: string;
  agentId?: string;
  nodeEmail?: string;
  nodePassword?: string;
  defaultPrinterName?: string;
  pendingJobsPath?: string;
  eventsPath?: string;
  loginPath?: string;
};

@ApiTags('Kiosk Bridge')
@Controller('kiosk')
export class KioskApiController {
  constructor(private readonly kioskApiService: KioskApiService) {}

  @Get('health')
  @ApiOperation({ summary: 'Kiosk bridge health' })
  health() {
    return this.kioskApiService.health();
  }

  @Post('auth/login')
  @ApiOperation({ summary: 'Kiosk dashboard login' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } } } })
  login(@Body() body: LoginBody) {
    return this.kioskApiService.login(body);
  }

  @Get('auth/session')
  @ApiOperation({ summary: 'Get kiosk dashboard session' })
  session(@Req() req: any) {
    return this.kioskApiService.getSession(req);
  }

  @Post('auth/logout')
  @ApiOperation({ summary: 'Kiosk dashboard logout' })
  logout(@Req() req: any) {
    return this.kioskApiService.logout(req);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Kiosk dashboard snapshot' })
  dashboard(@Req() req: any) {
    return this.kioskApiService.getDashboard(req);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Kiosk dashboard logs' })
  logs(@Req() req: any) {
    return this.kioskApiService.getLogs(req);
  }

  @Get('connection')
  @ApiOperation({ summary: 'Kiosk bridge connection settings' })
  connection(@Req() req: any) {
    return this.kioskApiService.getConnection(req);
  }

  @Post('connection')
  @ApiOperation({ summary: 'Update kiosk bridge connection settings' })
  updateConnection(@Req() req: any, @Body() body: ConnectionBody) {
    return this.kioskApiService.updateConnection(req, body);
  }

  @Post('connection/test')
  @ApiOperation({ summary: 'Test kiosk bridge connection with node credentials' })
  testConnection(@Req() req: any) {
    return this.kioskApiService.testConnection(req);
  }

  @Get('download/info')
  @ApiOperation({ summary: 'Get download info for a specific node (for download page)' })
  @ApiQuery({ name: 'nodeId', required: true, description: 'Node ID' })
  async getDownloadInfo(@Query('nodeId') nodeId: string, @Req() req: any) {
    const token = req?.headers?.authorization?.split(' ')?.[1] || req?.headers?.['x-session-token'] || '';
    if (!token) {
      throw new NotFoundException('Authentication required');
    }
    const info = await this.kioskApiService.getDownloadInfo(nodeId);
    if (!info) {
      throw new NotFoundException(`Node ${nodeId} not found`);
    }
    return info;
  }

  @Get('download/env')
  @ApiOperation({ summary: 'Download the .env config file for a specific node (admin only)' })
  @ApiQuery({ name: 'nodeId', required: true, description: 'Node ID' })
  async downloadEnv(
    @Query('nodeId') nodeId: string,
    @Req() req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res() res: any,
  ) {
    const token = req?.headers?.authorization?.split(' ')?.[1] || req?.headers?.['x-session-token'] || '';
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const content = await this.kioskApiService.generateEnvFile(nodeId);
    if (!content) {
      res.status(404).json({ error: `Node ${nodeId} not found` });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=".env"');
    res.send(content);
  }

  // ── Public self-service endpoint for shopkeepers ──────────────────────────

  @Post('self-setup')
  @ApiOperation({ summary: 'Public: shopkeeper logs in and downloads their pre-filled .env' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
      },
    },
  })
  async selfSetup(
    @Body() body: { email?: string; password?: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res() res: any,
  ) {
    const email = String(body?.email || '').trim();
    const password = String(body?.password || '').trim();

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await this.kioskApiService.selfSetupEnv(email, password);
    if (!result.ok) {
      res.status(401).json({ error: result.error || 'Invalid credentials' });
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=".env"');
    res.send(result.envContent);
  }
}
