import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class NodeAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const client = context.switchToWs().getClient();
        const req = request || client; // Support both HTTP and WebSockets

        let token = this.extractTokenFromHeader(req);

        // For WebSockets
        if (!token && client && client.handshake && client.handshake.auth) {
            token = client.handshake.auth.token;
        }

        if (!token) {
            throw new UnauthorizedException('No token provided');
        }

        try {
            const payload = await this.jwtService.verifyAsync(token, {
                secret: process.env.JWT_SECRET || 'secretKey',
            });

            if (payload.role !== 'OPERATOR') {
                throw new UnauthorizedException('Invalid role');
            }

            req['node'] = payload;
        } catch {
            throw new UnauthorizedException('Invalid token');
        }
        return true;
    }

    private extractTokenFromHeader(request: any): string | undefined {
        const [type, token] = request.headers?.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}
