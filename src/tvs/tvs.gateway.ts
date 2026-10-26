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
  NotFoundException,
} from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { isUUID } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { TvsService } from './tvs.service.js';
import { EstadoConexionTv } from './entities/tv.entity.js';
import { TransfersService } from './transfers.service.js';
import { ContenidosService } from '../contenidos/contenidos.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PlaybackService, PLAYBACK_COMMANDS } from './playback.service.js';
import type { PlaybackCommand, PlaybackData } from './playback.service.js';

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
    tv_ids?: unknown;
    request_id?: unknown;
    accion?: unknown;
    ok?: unknown;
    porcentaje?: unknown;
    origen?: unknown;
    ip?: unknown;
    model?: unknown;
    version_android?: unknown;
    contenido_id?: unknown;
    volumen?: unknown;
    volume?: unknown;
    repetir?: unknown;
    playlist_id?: unknown;
    tipo?: unknown;
    aleatorio?: unknown;
    message?: unknown;
    code?: unknown;
    estado?: unknown;
    contenido?: { id?: unknown };
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
  private readonly downloadTimeoutMs: number;
  private readonly pendingPlayback = new Map<
    string,
    {
      data: PlaybackData;
      client: Socket;
      connectionId: string;
      timer: NodeJS.Timeout;
      command: PlaybackCommand;
      progress?: number;
    }
  >();

  constructor(
    private readonly tvsService: TvsService,
    @Optional() private readonly transfers?: TransfersService,
    @Optional() private readonly contenidos?: ContenidosService,
    @Optional() private readonly playback?: PlaybackService,
    @Optional() private readonly auth?: AuthService,
    @Optional() config?: ConfigService,
  ) {
    const timeout = Number(
      config?.get('PLAYBACK_DOWNLOAD_TIMEOUT_MS', 900_000) ?? 900_000,
    );
    this.downloadTimeoutMs =
      Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 86_400_000
        ? timeout
        : 900_000;
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
    for (const pending of this.pendingPlayback.values())
      clearTimeout(pending.timer);
    this.pendingPlayback.clear();
  }

  async handleConnection(client: Socket): Promise<void> {
    if (
      client.handshake?.auth?.token ||
      client.handshake?.auth?.access_token ||
      client.handshake?.headers?.authorization
    ) {
      try {
        await this.authorizeAdmin(client, true);
      } catch {
        /* Las TVs no necesitan credenciales de administrador. */
      }
    }
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
    @MessageBody() raw: TvMessagePayload | string | null,
  ): Promise<void> {
    const payload = this.parsePayload(raw);
    if (!payload) return;
    if (this.activeTvs.has(client.id) || payload.evento?.startsWith('tv.')) {
      await this.handleTvMessage(client, payload);
      return;
    }
    if (PLAYBACK_COMMANDS.includes(payload.evento as PlaybackCommand)) {
      if (payload.datos?.tv_ids !== undefined) {
        await this.handleMediaBatch(
          client,
          payload,
          payload.evento as PlaybackCommand,
        );
        return;
      }
      await this.handleMediaCommand(
        client,
        payload,
        payload.evento as PlaybackCommand,
      );
      return;
    }
    switch (payload.evento) {
      case 'devices.status.request':
        try {
          await this.authorizeAdmin(client, true);
        } catch {
          this.playbackError(client, null, 'Acceso denegado', 'FORBIDDEN');
          return;
        }
        this.emitPendingDevices(client);
        await this.emitDeviceStatus(client);
        return;
    }
  }

  @SubscribeMessage('tv.message')
  async handleTvMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: string | TvMessagePayload,
  ): Promise<void> {
    const payload = this.parsePayload(raw);
    if (!payload) return;
    switch (payload.evento) {
      case 'media.play':
      case 'media.pause':
      case 'media.stop':
      case 'media.volume':
      case 'media.volumen':
      case 'media.repeat':
      case 'media.shuffle':
      case 'media.show':
      case 'media.hide':
        await this.handleTvMediaStatus(client, payload, payload.evento);
        return;
      case 'media.error':
        this.handleTvPlaybackError(client, payload);
        return;
      case 'media.progress':
        this.handleTvPlaybackProgress(client, payload);
        return;
      case 'media.result': {
        const action = payload.datos?.accion;
        if (!PLAYBACK_COMMANDS.includes(action as PlaybackCommand)) return;
        if (payload.datos?.ok === true)
          await this.handleTvMediaStatus(
            client,
            payload,
            action as PlaybackCommand,
          );
        else if (payload.datos?.ok === false)
          this.handleTvPlaybackError(client, payload);
        return;
      }

      case 'media.lista': {
        const tvId = this.readTvId(payload) ?? payload.tv_id;
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
        if (payload.datos?.estado === 'LISTO_PARA_REPRODUCIR') {
          try {
            const id = payload.datos.contenido?.id;
            if (typeof id !== 'string' || !this.contenidos)
              throw new BadRequestException('contenido.id es obligatorio');
            const contenido = await this.contenidos.findOne(id);
            this.server.to('playback.admins').emit('admin.message', {
              evento: 'media.lista',
              datos: {
                tv_id: tvId,
                estado: 'LISTO_PARA_REPRODUCIR',
                contenido,
              },
            });
          } catch (error) {
            this.emitMediaListError(
              client,
              tvId,
              error instanceof Error
                ? error.message
                : 'No se pudo preparar el contenido',
              'DOWNLOAD_FAILED',
            );
          }
          return;
        }
        if (
          typeof payload.url !== 'string' ||
          !/^(?:content|file):\/\/[^\s]+$/.test(payload.url) ||
          payload.url.length > 8192
        ) {
          this.emitMediaListError(
            client,
            tvId,
            'url debe ser una URI content:// o file:// válida',
            'INVALID_MEDIA_URL',
          );
          return;
        }
        try {
          if (!this.transfers || !this.contenidos)
            throw new Error('Servicio no disponible');
          // Clientes anteriores anuncian media.lista también tras una descarga
          // de reproducción. Ese aviso no confirma una transferencia HTTP antigua.
          if (!this.transfers.pending(tvId).length) return;
          const tv = await this.tvsService.findOne(tvId);
          const url = payload.url;
          const contenido = await this.transfers.complete(tvId, (id, file) =>
            this.contenidos!.registerDownloaded(id, tv.id, url, file),
          );
          const datos = {
            tv_id: tvId,
            contenido,
          };
          this.server.emit('admin.message', { evento: 'media.lista', datos });
          client.emit('tv.message', { evento: 'media.confirmada', datos });
        } catch (error) {
          this.emitMediaListError(
            client,
            tvId,
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
    for (const [key, pending] of this.pendingPlayback) {
      if (pending.connectionId !== client.id) continue;
      clearTimeout(pending.timer);
      this.pendingPlayback.delete(key);
      this.playbackFailure(
        pending.client,
        pending.data.tv_id,
        pending.command,
        pending.data.request_id,
        'La TV se desconectó antes de confirmar',
        'TV_OFFLINE',
      );
    }
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

  private parsePayload(value: unknown): TvMessagePayload | null {
    try {
      const parsed: unknown =
        typeof value === 'string' ? JSON.parse(value) : value;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
      const payload = parsed as TvMessagePayload;
      if (typeof payload.evento !== 'string') return null;
      if (
        payload.datos !== undefined &&
        (!payload.datos ||
          typeof payload.datos !== 'object' ||
          Array.isArray(payload.datos))
      )
        return null;
      return payload;
    } catch {
      return null;
    }
  }

  private async authorizeAdmin(client: Socket, viewOnly = false): Promise<void> {
    if (!this.auth) throw new Error('Autenticación no disponible');
    const authorization = client.handshake?.headers?.authorization;
    const token: unknown =
      client.handshake?.auth?.token ??
      client.handshake?.auth?.access_token ??
      (authorization?.startsWith('Bearer ')
        ? authorization.slice(7)
        : undefined);
    if (typeof token !== 'string') throw new Error('Token Bearer obligatorio');
    const claims = this.auth.verify(token.replace(/^Bearer /, ''));
    const user = await this.auth.ensureActiveUser(claims.sub) ?? claims;
    if (
      !user.permissions.includes('*') &&
      !user.permissions.includes('tvs.control') &&
      !(viewOnly && user.permissions.includes('tvs.view'))
    )
      throw new Error('No tiene permiso tvs.control');
    await client.join('playback.admins');
    client.data ??= {};
    client.data.playbackUserId = user.sub;
    for (const pending of this.pendingPlayback.values()) {
      if (pending.client.data?.playbackUserId === user.sub)
        pending.client = client;
    }
  }

  private playbackError(
    client: Socket,
    tvId: string | null,
    message: string,
    code: string,
  ): void {
    client.emit('admin.message', {
      evento: 'media.error',
      datos: { ...(tvId && { tv_id: tvId }), message, code },
    });
  }

  private playbackKey(
    tvId: string,
    command: PlaybackCommand,
    requestId?: string,
  ): string {
    return JSON.stringify([tvId, command, requestId ?? null]);
  }

  private playbackFailure(
    client: Socket,
    tvId: string | null,
    command: PlaybackCommand,
    requestId: string | undefined,
    message: string,
    code: string,
  ): void {
    if (!requestId || !tvId) {
      this.playbackError(client, tvId, message, code);
      return;
    }
    client.emit('admin.message', {
      evento: 'media.result',
      datos: {
        request_id: requestId,
        tv_id: tvId,
        accion: command,
        ok: false,
        code,
        message,
      },
    });
  }

  private async handleMediaBatch(
    client: Socket,
    payload: TvMessagePayload,
    command: PlaybackCommand,
  ): Promise<void> {
    const ids = payload.datos?.tv_ids;
    const requestId = payload.datos?.request_id;
    if (
      typeof requestId !== 'string' ||
      !isUUID(requestId) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some(
        (id) =>
          typeof id !== 'string' ||
          !id.trim() ||
          id.length > 100 ||
          id !== id.trim(),
      ) ||
      new Set(ids).size !== ids.length ||
      payload.datos?.tv_id !== undefined ||
      payload.datos?.tvId !== undefined
    ) {
      this.playbackError(
        client,
        null,
        'Se requiere request_id UUID y tv_ids con 1 a 100 códigos únicos, sin tv_id',
        'INVALID_COMMAND',
      );
      return;
    }
    try {
      await this.authorizeAdmin(client);
    } catch {
      for (const id of ids as string[])
        this.playbackFailure(
          client,
          id,
          command,
          requestId,
          'No tiene permiso para enviar la orden',
          'FORBIDDEN',
        );
      return;
    }
    const { tv_ids: _ids, ...data } = payload.datos!;
    await Promise.all(
      (ids as string[]).map((id) =>
        this.handleMediaCommand(
          client,
          { evento: command, datos: { ...data, tv_id: id } },
          command,
          true,
        ),
      ),
    );
  }

  private async handleMediaCommand(
    client: Socket,
    payload: TvMessagePayload,
    command: PlaybackCommand,
    authorized = false,
  ): Promise<void> {
    const tvId = this.readTvId(payload);
    const requestId =
      typeof payload.datos?.request_id === 'string'
        ? payload.datos.request_id
        : undefined;
    const fail = (message: string, code: string) =>
      this.playbackFailure(client, tvId, command, requestId, message, code);
    try {
      if (!authorized) await this.authorizeAdmin(client);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : 'Acceso denegado',
        'FORBIDDEN',
      );
      return;
    }
    try {
      if (!this.playback)
        throw new Error('Servicio de reproducción no disponible');
      const data = this.playback.validate(command, {
        ...payload.datos,
        tv_id: tvId,
      });
      const target = [...this.activeTvs.entries()].find(
        ([, tv]) => tv.tvId === data.tv_id,
      );
      const socket = target ? this.server.sockets.get(target[0]) : undefined;
      if (!socket) {
        fail('La TV no está conectada', 'TV_OFFLINE');
        return;
      }
      const key = this.playbackKey(data.tv_id, command, data.request_id);
      if (this.pendingPlayback.has(key)) {
        fail('Hay una orden pendiente de confirmación', 'COMMAND_PENDING');
        return;
      }
      const tv = await this.tvsService.findOne(data.tv_id);
      const prepared = await this.playback.prepare(command, data, tv.id);
      // Se comprueba otra vez después de resolver los archivos y la playlist.
      if (this.server.sockets.get(target![0]) !== socket) {
        fail('La TV se desconectó', 'TV_OFFLINE');
        return;
      }
      if (this.pendingPlayback.has(key)) {
        fail('Hay una orden pendiente de confirmación', 'COMMAND_PENDING');
        return;
      }
      const timer = setTimeout(
        () => {
          const waiting = this.pendingPlayback.get(key);
          this.pendingPlayback.delete(key);
          this.playbackFailure(
            waiting?.client ?? client,
            data.tv_id,
            command,
            data.request_id,
            'La TV no confirmó la orden',
            'PLAYBACK_TIMEOUT',
          );
        },
        command === 'media.play' || command === 'media.show'
          ? this.downloadTimeoutMs
          : 30_000,
      ).unref();
      this.pendingPlayback.set(key, {
        data,
        client,
        connectionId: target![0],
        timer,
        command,
      });
      socket.emit('admin.message', { evento: command, datos: prepared });
    } catch (error) {
      const missing = error instanceof NotFoundException;
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo preparar la reproducción';
      const code = missing
        ? message.startsWith('Playlist ')
          ? 'PLAYLIST_NOT_FOUND'
          : message.startsWith('Contenido ')
            ? 'CONTENT_NOT_FOUND'
            : 'DOWNLOAD_FAILED'
        : error instanceof BadRequestException
          ? 'INVALID_COMMAND'
          : 'PLAYBACK_FAILED';
      fail(message, code);
    }
  }

  private readonly tvStatusQueue = new Map<string, Promise<void>>();

  private async handleTvMediaStatus(client: Socket, payload: TvMessagePayload, command: PlaybackCommand): Promise<void> {
    const previous = this.tvStatusQueue.get(client.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.processTvMediaStatus(client, payload, command));
    this.tvStatusQueue.set(client.id, next);
    try { await next; } finally {
      if (this.tvStatusQueue.get(client.id) === next) this.tvStatusQueue.delete(client.id);
    }
  }

  private async processTvMediaStatus(
    client: Socket,
    payload: TvMessagePayload,
    command: PlaybackCommand,
  ): Promise<void> {
    const tvId = this.readTvId(payload);
    if (!tvId || this.activeTvs.get(client.id)?.tvId !== tvId) {
      this.playbackError(
        client,
        tvId,
        'El socket debe identificarse como la TV indicada',
        'INVALID_TV',
      );
      return;
    }
    const requestId =
      typeof payload.datos?.request_id === 'string'
        ? payload.datos.request_id
        : undefined;
    const key = this.playbackKey(tvId, command, requestId);
    const pending = this.pendingPlayback.get(key);
    if (
      !pending &&
      requestId === undefined &&
      payload.datos?.origen === 'tv' &&
      payload.evento !== 'media.result'
    ) {
      try {
        if (!this.playback)
          throw new Error('Servicio de reproducción no disponible');
        const data = this.playback.validate(command, {
          ...payload.datos,
          tv_id: tvId,
        });
        const transport = ['media.play', 'media.show', 'media.pause', 'media.stop', 'media.hide'];
        const automaticContentStatus = command === 'media.play' && typeof data.contenido_actual_id === 'string';
        // A delayed status from the previous item must not interrupt a new selection.
        if (automaticContentStatus && [...this.pendingPlayback.values()].some(item => item.connectionId === client.id && transport.includes(item.command))) return;
        for (const [pendingKey, previous] of this.pendingPlayback) {
          if (automaticContentStatus || previous.connectionId !== client.id || (previous.command !== command && !(transport.includes(command) && transport.includes(previous.command)))) continue;
          clearTimeout(previous.timer);
          this.pendingPlayback.delete(pendingKey);
          this.playbackFailure(previous.client, tvId, previous.command, previous.data.request_id, 'La TV cambió la reproducción desde su control local', 'CANCELLED');
        }
        const tv = await this.tvsService.findOne(tvId);
        const datos = await this.playback.confirm(tv.id, command, data);
        this.server
          .to('playback.admins')
          .emit('admin.message', { evento: command, datos });
      } catch (error) {
        this.playbackError(
          client,
          tvId,
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el estado local',
          'MEDIA_STATUS_ERROR',
        );
      }
      return;
    }
    if (!pending || pending.connectionId !== client.id) return;
    try {
      if (!this.playback)
        throw new Error('Servicio de reproducción no disponible');
      const data = this.playback.validate(command, {
        ...pending.data,
        ...payload.datos,
        tv_id: tvId,
      });
      for (const field of [
        'playlist_id',
        'contenido_id',
        'volumen',
        'repetir',
        'aleatorio',
      ] as const)
        if (data[field] !== pending.data[field])
          throw new BadRequestException(
            'La confirmación no corresponde a la orden pendiente',
          );
      const tv = await this.tvsService.findOne(tvId);
      if (this.pendingPlayback.get(key) !== pending) return;
      clearTimeout(pending.timer);
      this.pendingPlayback.delete(key);
      const datos = await this.playback.confirm(tv.id, command, data);
      this.server
        .to('playback.admins')
        .emit('admin.message', { evento: command, datos });
      if (pending.data.request_id)
        pending.client.emit('admin.message', {
          evento: 'media.result',
          datos: {
            request_id: pending.data.request_id,
            tv_id: tvId,
            accion: command,
            ok: true,
          },
        });
    } catch (error) {
      clearTimeout(pending.timer);
      this.pendingPlayback.delete(key);
      this.playbackFailure(
        pending.client,
        tvId,
        command,
        pending.data.request_id,
        error instanceof Error
          ? error.message
          : 'No se pudo confirmar la reproducción',
        'PLAYBACK_FAILED',
      );
    }
  }

  private handleTvPlaybackProgress(
    client: Socket,
    payload: TvMessagePayload,
  ): void {
    const tvId = this.readTvId(payload);
    if (!tvId || this.activeTvs.get(client.id)?.tvId !== tvId) return;
    const action = payload.datos?.accion;
    if (action !== 'media.play' && action !== 'media.show') return;
    const requestId = payload.datos?.request_id;
    if (requestId !== undefined && typeof requestId !== 'string') return;
    const pending = this.pendingPlayback.get(
      this.playbackKey(tvId, action, requestId),
    );
    const percent = payload.datos?.porcentaje;
    if (
      !pending ||
      pending.connectionId !== client.id ||
      typeof percent !== 'number' ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100 ||
      (pending.progress !== undefined && percent <= pending.progress)
    )
      return;
    pending.progress = percent;
    pending.timer.refresh();
    pending.client.emit('admin.message', {
      evento: 'media.progress',
      datos: {
        ...(requestId && { request_id: requestId }),
        tv_id: tvId,
        accion: action,
        estado: 'DOWNLOADING',
        porcentaje: percent,
      },
    });
  }

  private handleTvPlaybackError(
    client: Socket,
    payload: TvMessagePayload,
  ): void {
    const tvId = this.readTvId(payload);
    if (!tvId || this.activeTvs.get(client.id)?.tvId !== tvId) return;
    const requestId = payload.datos?.request_id;
    const action = payload.datos?.accion;
    const message =
      typeof payload.datos?.message === 'string'
        ? payload.datos.message.slice(0, 1000)
        : 'La TV no pudo aplicar la orden';
    const code = [
      'DOWNLOAD_FAILED',
      'CONTENT_NOT_FOUND',
      'PLAYLIST_NOT_FOUND',
      'PLAYBACK_FAILED',
      'CANCELLED',
    ].includes(String(payload.datos?.code))
      ? String(payload.datos?.code)
      : 'PLAYBACK_FAILED';
    let matched = false;
    for (const [key, pending] of this.pendingPlayback) {
      if (pending.connectionId !== client.id) continue;
      if (
        pending.data.request_id !== requestId ||
        (action !== undefined && action !== pending.command)
      )
        continue;
      clearTimeout(pending.timer);
      this.pendingPlayback.delete(key);
      this.playbackFailure(
        pending.client,
        tvId,
        pending.command,
        pending.data.request_id,
        message,
        code,
      );
      matched = true;
    }
    if (!matched && payload.datos?.origen !== 'tv') return;
    this.server.to('playback.admins').emit('admin.message', {
      evento: 'media.error',
      datos: {
        tv_id: tvId,
        ...(typeof requestId === 'string' && { request_id: requestId }),
        code,
        message,
      },
    });
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

  private emitMediaListError(
    client: Socket,
    tvId: string,
    message: string,
    code: string,
  ): void {
    this.emitError(client, message, code);
    this.server.emit('admin.message', {
      evento: 'media.lista.error',
      datos: { tv_id: tvId, message, code },
    });
    this.server.emit('admin.message', {
      evento: 'error',
      datos: { tv_id: tvId, message, code },
    });
  }

  private emitAdminError(client: Socket, message: string, code: string): void {
    client.emit('admin.message', {
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
    if (estadoConexion === EstadoConexionTv.DESCONECTADO) this.server.to?.("playback.admins").emit("admin.message", { evento: "media.stop", datos: { tv_id: tvId, estado_reproduccion: "STOPPED" } });
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
      if (client?.rooms?.has('playback.admins')) {
        for (const tv of tvs) {
          const state = tv.estado;
          if (!state) continue;
          const evento =
            state.estado_reproduccion === 'PLAYING'
              ? 'media.play'
              : state.estado_reproduccion === 'PAUSED'
                ? 'media.pause'
                : 'media.stop';
          const playlist = state.playlist_id ? await this.playback?.playlistName(state.playlist_id) : undefined;
          client.emit('admin.message', {
            evento,
            datos: {
              tv_id: tv.tv_id,
              ...(playlist ? { playlist_nombre: playlist } : {}),
              ...(state.playlist_id
                ? { playlist_id: state.playlist_id }
                : state.contenido_id
                  ? {
                      contenido_id: state.contenido_id,
                      tipo: state.contenido?.tipo,
                    }
                  : {}),
              ...(state.contenido ? { contenido_actual: { id: state.contenido.id, nombre: state.contenido.nombre, tipo: state.contenido.tipo } } : {}),
              volumen: state.volumen,
              repetir: state.repetir,
              aleatorio: state.aleatorio,
            },
          });
        }
      }
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
