import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  BadRequestException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { TvsService } from './tvs.service.js';
import { EstadoConexionTv } from './entities/tv.entity.js';
import { TransfersService } from './transfers.service.js';
import { ContenidosService } from '../contenidos/contenidos.service.js';
import { TipoContenido } from '../contenidos/entities/contenido.entity.js';

export interface ConnectedDevice {
  tvId: string;
  ip: string;
  model: string;
  version_android: string;
}

interface RegisteredDevice extends ConnectedDevice {
  connectionId: string;
}

interface ActiveTvConnection {
  tvId: string;
  lastPongAt: number;
  status: EstadoConexionTv.CONECTADO | EstadoConexionTv.BAJA_SENAL;
}

interface TvMessagePayload {
  tv_id?: unknown;
  url?: unknown;
  evento?: string;
  message?: unknown;
  datos?: {
    tvId?: unknown;
    tv_id?: unknown;
    ip?: unknown;
    model?: unknown;
    version_android?: unknown;
  };
}

@WebSocketGateway({
  namespace: '/tvs',
  cors: { origin: '*' },
  pingInterval: 10_000,
  pingTimeout: 20_000,
})
export class TvsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(TvsGateway.name);
  private readonly pendingDevices = new Map<string, RegisteredDevice>();
  private readonly activeTvs = new Map<string, ActiveTvConnection>();
  private readonly heartbeatMonitor: NodeJS.Timeout;

  constructor(
    private readonly tvsService: TvsService,
    @Optional() private readonly transfers?: TransfersService,
    @Optional() private readonly contenidos?: ContenidosService,
  ) {
    this.heartbeatMonitor = setInterval(
      () => void this.checkHeartbeatHealth(),
      5_000,
    );
    this.heartbeatMonitor.unref();
  }

  @WebSocketServer()
  private readonly server: Namespace;

  async onModuleInit(): Promise<void> {
    await this.tvsService.markAllDisconnected();
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeatMonitor);
  }

  async handleConnection(client: Socket): Promise<void> {
    client.conn.on('packet', (packet) => {
      if (packet.type === 'pong') void this.recordPong(client.id);
    });
    client.emit('connection.ready', { connectionId: client.id });
    this.emitPendingDevices(client);
    await this.emitDeviceStatus(client);
    this.logger.log(`WebSocket conectado: ${client.id}`);
  }

  @SubscribeMessage('admin.message')
  async handleAdminMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { evento?: string } | null,
  ): Promise<void> {
    if (payload?.evento === 'devices.status.request') {
      this.emitPendingDevices(client);
      await this.emitDeviceStatus(client);
    }
  }

  @SubscribeMessage('tv.message')
  async handleTvMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: string | TvMessagePayload,
  ): Promise<void> {
    if (typeof payload === 'string') {
      console.log(payload);
      return;
    }

    if (!payload || typeof payload !== 'object') return;
    switch (payload.evento) {
      case 'media.lista': {
        const tvId = payload.tv_id;
        if (
          typeof tvId !== 'string' ||
          this.activeTvs.get(client.id)?.tvId !== tvId
        ) {
          this.emitError(
            client,
            'El socket debe identificarse como la TV indicada',
            'INVALID_TV',
          );
          return;
        }
        if (
          typeof payload.url !== 'string' ||
          !/^content:\/\/[^\s]+$/.test(payload.url) ||
          payload.url.length > 8192
        ) {
          this.emitError(
            client,
            'url debe ser una URI content:// válida',
            'INVALID_MEDIA_URL',
          );
          return;
        }
        try {
          if (!this.transfers || !this.contenidos)
            throw new Error('Servicio no disponible');
          const tv = await this.tvsService.findOne(tvId);
          const url = payload.url;
          const contenido = await this.transfers.complete(tvId, (id, file) =>
            this.contenidos!.registerDownloaded(id, tv.id, url, file),
          );
          const datos = {
            tv_id: tvId,
            contenido,
            estado:
              contenido.tipo === TipoContenido.VIDEO
                ? 'LISTO_PARA_REPRODUCIR'
                : 'MOSTRANDO',
          };
          this.server.emit('admin.message', { evento: 'media.lista', datos });
          client.emit('tv.message', { evento: 'media.confirmada', datos });
        } catch (error) {
          this.emitError(
            client,
            error instanceof Error
              ? error.message
              : 'No se pudo guardar el contenido',
            'MEDIA_CONFIRM_ERROR',
          );
        }
        return;
      }
      case 'tv.obtener': {
        const tvId = this.readTvId(payload);
        if (!tvId) {
          this.emitError(client, 'tvId es obligatorio', 'TV_ID_REQUIRED');
          return;
        }
        try {
          const tv = await this.tvsService.findOne(tvId);
          await this.trackRegisteredTv(client.id, tvId);
          client.emit('tv.message', { evento: 'tv.datos', datos: tv });
        } catch {
          client.emit('tv.message', {
            evento: 'tv.no_encontrada',
            datos: { tvId },
          });
        }
        return;
      }

      case 'tv.conectar': {
        const datos = payload.datos;
        if (
          typeof datos?.ip !== 'string' ||
          typeof datos.model !== 'string' ||
          typeof datos.version_android !== 'string'
        ) {
          this.emitError(
            client,
            'ip, model y version_android son obligatorios',
            'INVALID_DEVICE_DATA',
          );
          return;
        }

        const dto: ConnectTvDto = {
          ip: datos.ip,
          model: datos.model,
          version_android: datos.version_android,
          connectionId: client.id,
        };
        try {
          const result = await this.tvsService.connect(dto);
          await this.registerDevice(dto, result.tvId);
          client.emit('tv.message', {
            evento: 'tv.conectada',
            datos: { tvId: result.tvId },
          });
        } catch (error) {
          this.emitError(
            client,
            error instanceof Error
              ? error.message
              : 'No se pudo conectar la TV',
            'TV_CONNECT_ERROR',
          );
        }
        return;
      }

      case 'tv.heartbeat': {
        const tvId = this.readTvId(payload);
        if (!tvId) return;
        try {
          await this.tvsService.findOne(tvId);
          await this.trackRegisteredTv(client.id, tvId);
          client.emit('tv.message', {
            evento: 'tv.pong',
            datos: { tvId, timestamp: new Date().toISOString() },
          });
        } catch {
          client.emit('tv.message', {
            evento: 'tv.no_encontrada',
            datos: { tvId },
          });
        }
        return;
      }

      default:
        if (typeof payload.message === 'string') console.log(payload.message);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const device = this.pendingDevices.get(client.id);
    if (device) {
      this.pendingDevices.delete(client.id);
      this.tvsService.releaseTemporaryTvId(device.tvId);
      this.emitPendingDevices();
    }
    const activeTv = this.activeTvs.get(client.id);
    if (activeTv) {
      this.activeTvs.delete(client.id);
      await this.setTvConnectionStatus(
        activeTv.tvId,
        EstadoConexionTv.DESCONECTADO,
      );
    }
    this.logger.log(`WebSocket desconectado: ${client.id}`);
  }

  async registerDevice(dto: ConnectTvDto, tvId: string): Promise<void> {
    if (!this.server.sockets.has(dto.connectionId)) {
      throw new BadRequestException('La conexión WebSocket ya no está activa');
    }

    const previousDevice = this.pendingDevices.get(dto.connectionId);
    if (previousDevice) {
      this.tvsService.releaseTemporaryTvId(previousDevice.tvId);
    }
    const device: RegisteredDevice = {
      connectionId: dto.connectionId,
      tvId,
      ip: dto.ip,
      model: dto.model,
      version_android: dto.version_android,
    };
    this.pendingDevices.set(dto.connectionId, device);

    this.emitPendingDevices();
  }

  async confirmRegistration(tvId: string): Promise<void> {
    const entry = [...this.pendingDevices.entries()].find(
      ([, device]) => device.tvId === tvId,
    );
    if (!entry) {
      this.logger.warn(`No se encontró una conexión activa para ${tvId}`);
      return;
    }

    const [connectionId] = entry;
    this.pendingDevices.delete(connectionId);
    this.emitPendingDevices();

    this.activeTvs.set(connectionId, {
      tvId,
      lastPongAt: Date.now(),
      status: EstadoConexionTv.CONECTADO,
    });
    await this.setTvConnectionStatus(tvId, EstadoConexionTv.CONECTADO);

    const registration = {
      tvId,
      registered: true,
      message: 'TV registrada correctamente',
    };
    const socket = this.server.sockets.get(connectionId);
    socket?.emit('device.registered', registration);
    socket?.emit('tv.message', {
      evento: 'device.registered',
      datos: registration,
    });
    this.logger.log(`TV registrada y retirada de pendientes: ${tvId}`);
  }

  private readTvId(payload: TvMessagePayload): string | null {
    const candidate = payload.datos?.tvId ?? payload.datos?.tv_id;
    return typeof candidate === 'string' && candidate ? candidate : null;
  }

  notifyMedia(tvId: string, datos: unknown): void {
    for (const [connectionId, tv] of this.activeTvs) {
      if (tv.tvId === tvId)
        this.server.sockets
          .get(connectionId)
          ?.emit('tv.message', { evento: 'media.disponible', datos });
    }
  }

  private emitError(client: Socket, message: string, code: string): void {
    client.emit('tv.message', {
      evento: 'error',
      datos: { message, code },
    });
  }

  private async trackRegisteredTv(
    connectionId: string,
    tvId: string,
  ): Promise<void> {
    const current = this.activeTvs.get(connectionId);
    if (current?.tvId === tvId) {
      current.lastPongAt = Date.now();
      if (current.status === EstadoConexionTv.BAJA_SENAL) {
        current.status = EstadoConexionTv.CONECTADO;
        await this.setTvConnectionStatus(tvId, EstadoConexionTv.CONECTADO);
      }
      return;
    }

    this.activeTvs.set(connectionId, {
      tvId,
      lastPongAt: Date.now(),
      status: EstadoConexionTv.CONECTADO,
    });
    await this.setTvConnectionStatus(tvId, EstadoConexionTv.CONECTADO);
    for (const transfer of this.transfers?.pending(tvId) ?? []) {
      this.server.sockets
        .get(connectionId)
        ?.emit('tv.message', { evento: 'media.disponible', datos: transfer });
    }
  }

  private async recordPong(connectionId: string): Promise<void> {
    const activeTv = this.activeTvs.get(connectionId);
    if (!activeTv) return;
    activeTv.lastPongAt = Date.now();
    if (activeTv.status === EstadoConexionTv.BAJA_SENAL) {
      activeTv.status = EstadoConexionTv.CONECTADO;
      await this.setTvConnectionStatus(
        activeTv.tvId,
        EstadoConexionTv.CONECTADO,
      );
    }
  }

  private async checkHeartbeatHealth(): Promise<void> {
    const now = Date.now();
    for (const [connectionId, activeTv] of this.activeTvs) {
      const elapsed = now - activeTv.lastPongAt;
      if (elapsed > 30_000) {
        this.server.sockets.get(connectionId)?.disconnect(true);
      } else if (
        elapsed > 15_000 &&
        activeTv.status === EstadoConexionTv.CONECTADO
      ) {
        activeTv.status = EstadoConexionTv.BAJA_SENAL;
        await this.setTvConnectionStatus(
          activeTv.tvId,
          EstadoConexionTv.BAJA_SENAL,
        );
      }
    }
  }

  private async setTvConnectionStatus(
    tvId: string,
    estadoConexion: EstadoConexionTv,
  ): Promise<void> {
    await this.tvsService.updateConnectionStatus(tvId, estadoConexion);
    await this.emitDeviceStatus();
  }

  private async emitDeviceStatus(client?: Socket): Promise<void> {
    try {
      const tvs = await this.tvsService.findAll();
      (client ?? this.server).emit('admin.message', {
        evento: 'devices.status',
        datos: {
          enline: tvs
            .filter((tv) => tv.estado_conexion === EstadoConexionTv.CONECTADO)
            .map((tv) => ({ tv_id: tv.tv_id })),
          low_sengal: tvs
            .filter((tv) => tv.estado_conexion === EstadoConexionTv.BAJA_SENAL)
            .map((tv) => ({ tv_id: tv.tv_id })),
        },
      });
    } catch (error) {
      this.logger.error('No se pudo enviar el estado de dispositivos', error);
      client?.emit('admin.message', {
        evento: 'error',
        datos: {
          code: 'DEVICE_STATUS_ERROR',
          message: 'No se pudo obtener el estado de dispositivos',
        },
      });
    }
  }

  private emitPendingDevices(client?: Socket): void {
    (client ?? this.server).emit('admin.message', {
      evento: 'devices.pending',
      datos: { pendientes_registro: this.getPendingDevices() },
    });
  }

  private getPendingDevices(): ConnectedDevice[] {
    return [...this.pendingDevices.values()].map((device) =>
      this.toPublicDevice(device),
    );
  }

  private toPublicDevice(device: RegisteredDevice): ConnectedDevice {
    return {
      tvId: device.tvId,
      ip: device.ip,
      model: device.model,
      version_android: device.version_android,
    };
  }
}
