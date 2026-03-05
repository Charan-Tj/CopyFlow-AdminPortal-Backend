import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { NodeAuthGuard } from '../common/guards/node-auth.guard';
import { NodeService } from './node.service';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ namespace: '/node', cors: { origin: '*' } })
export class NodeGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NodeGateway.name);

    constructor(
        private readonly nodeService: NodeService,
        private readonly jwtService: JwtService
    ) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token;
            if (!token) throw new Error('No token provided');

            const payload = await this.jwtService.verifyAsync(token, {
                secret: process.env.JWT_SECRET || 'secretKey',
            });

            if (payload.role !== 'OPERATOR') throw new Error('Invalid role');

            const nodeId = payload.nodeId;
            client.join(`node_${nodeId}`);
            client.data.nodeId = nodeId;

            this.logger.log(`Node client connected: ${nodeId} (${client.id})`);
        } catch (error) {
            this.logger.error(`Connection rejected: ${error.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        if (client.data.nodeId) {
            this.logger.log(`Node client disconnected: ${client.data.nodeId} (${client.id})`);
        }
    }

    @UseGuards(NodeAuthGuard)
    @SubscribeMessage('vitals')
    async handleVitals(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
        const nodeId = client.data.nodeId;
        const { paperlevel = 'HIGH', printers = [] } = data;
        await this.nodeService.updateHeartbeat(nodeId, paperlevel, printers);
    }

    @UseGuards(NodeAuthGuard)
    @SubscribeMessage('heartbeat')
    async handleHeartbeat(@ConnectedSocket() client: Socket) {
        const nodeId = client.data.nodeId;
        await this.nodeService.updateHeartbeat(nodeId, 'HIGH', []);
    }

    @UseGuards(NodeAuthGuard)
    @SubscribeMessage('job-complete')
    async handleJobComplete(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId: string }) {
        const nodeId = client.data.nodeId;
        await this.nodeService.acknowledgeJob(nodeId, data.jobId);
    }

    @UseGuards(NodeAuthGuard)
    @SubscribeMessage('job-failed')
    async handleJobFailed(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId: string, reason: string, errorCode?: string }) {
        const nodeId = client.data.nodeId;
        await this.nodeService.failJob(nodeId, data.jobId, data.reason, data.errorCode);
    }

    // Helper for backend to push events to specific node
    emitToNode(nodeId: string, event: string, payload: any) {
        this.server.to(`node_${nodeId}`).emit(event, payload);
    }
}
