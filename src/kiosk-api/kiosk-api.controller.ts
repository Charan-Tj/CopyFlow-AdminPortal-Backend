import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
