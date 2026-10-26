import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { TvsGateway } from './tvs.gateway.js';
import { TvsService } from './tvs.service.js';
import { EstadoConexionTv, Tv } from './entities/tv.entity.js';

describe('Canal de administración', () => {
  let gateway: TvsGateway;
  let tvs: Tv[];
  const emit = vi.fn();
  const clientEmit = vi.fn();
  const client = {
    id: 'socket-1',
    conn: { on: vi.fn() },
    emit: clientEmit,
    handshake: { auth: { token: 'test-token' }, headers: {} },
    join: vi.fn(async () => undefined),
  } as unknown as Socket;

  beforeEach(() => {
    vi.clearAllMocks();
    tvs = [
      { tv_id: 'online', estado_conexion: EstadoConexionTv.CONECTADO },
      { tv_id: 'offline', estado_conexion: EstadoConexionTv.DESCONECTADO },
      { tv_id: 'weak', estado_conexion: EstadoConexionTv.BAJA_SENAL },
    ] as Tv[];
    gateway = new TvsGateway({
      findAll: vi.fn(async () => tvs),
      releaseTemporaryTvId: vi.fn(),
      updateConnectionStatus: vi.fn(async (id, status) => {
        tvs.find((tv) => tv.tv_id === id)!.estado_conexion = status;
      }),
    } as unknown as TvsService);
    Object.assign(gateway, {
      server: { emit, sockets: new Map([[client.id, client]]) },
      auth: {
        verify: vi.fn(() => ({ sub: 'admin', permissions: ['tvs.control'] })),
        ensureActiveUser: vi.fn(),
      },
    });
  });

  afterEach(() => gateway.onModuleDestroy());

  it('rechaza órdenes sin autenticación y no las envía a la TV', async () => {
    const prepare = vi.fn();
    Object.assign(gateway, {
      playback: { prepare },
      auth: {
        verify: vi.fn(() => {
          throw new Error('Token expirado');
        }),
      },
    });
    await gateway.handleAdminMessage(client, {
      evento: 'media.stop',
      datos: { tv_id: 'online' },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(clientEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.error',
      datos: { tv_id: 'online', code: 'FORBIDDEN', message: 'Token expirado' },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('devuelve TV_OFFLINE y no prepara archivos para una TV desconectada', async () => {
    const prepare = vi.fn();
    Object.assign(gateway, {
      playback: {
        validate: (_command: unknown, data: unknown) => data,
        prepare,
      },
    });
    await gateway.handleAdminMessage(client, {
      evento: 'media.stop',
      datos: { tv_id: 'offline' },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(clientEmit).toHaveBeenCalledWith(
      'admin.message',
      expect.objectContaining({
        evento: 'media.error',
        datos: expect.objectContaining({
          tv_id: 'offline',
          code: 'TV_OFFLINE',
        }),
      }),
    );
  });

  it('ignora JSON malformado sin ejecutar órdenes', async () => {
    await gateway.handleAdminMessage(client, '{broken');
    await gateway.handleTvMessage(client, '{broken');
    expect(clientEmit).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('procesa media.lista del TV identificado y avisa al administrador después de guardar', async () => {
    const contenido = {
      id: 'content-1',
      nombre: 'movie.mp4',
      tipo: 'VIDEO',
      tamano_bytes: '5',
      url: 'content://media/1',
    };
    const registerDownloaded = vi.fn(async () => contenido);
    const file = { originalname: 'movie.mp4', size: 5, mimetype: 'video/mp4' };
    const complete = vi.fn(async (_tvId, persist) =>
      persist('content-1', file),
    );
    Object.assign(gateway, {
      activeTvs: new Map([[client.id, { tvId: 'online' }]]),
      transfers: {
        complete,
        pending: vi.fn(() => [{ transferId: 'content-1' }]),
      },
      contenidos: { registerDownloaded },
      tvsService: {
        findOne: vi.fn(async () => ({ id: 'db-tv-id', tv_id: 'online' })),
      },
    });
    await gateway.handleTvMessage(client, {
      evento: 'media.lista',
      tv_id: 'other',
      url: 'content://media/1',
    });
    expect(complete).not.toHaveBeenCalled();
    await gateway.handleTvMessage(client, {
      evento: 'media.lista',
      tv_id: 'online',
      url: 'content://media/1',
    });
    expect(registerDownloaded).toHaveBeenCalledWith(
      'content-1',
      'db-tv-id',
      contenido.url,
      file,
    );
    expect(emit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.lista',
      datos: { tv_id: 'online', contenido },
    });
    await gateway.handleTvMessage(client, {
      evento: 'media.lista',
      tv_id: 'online',
      url: 'file:///storage/emulated/0/movie.mp4',
    });
    expect(registerDownloaded).toHaveBeenCalledWith(
      'content-1',
      'db-tv-id',
      'file:///storage/emulated/0/movie.mp4',
      file,
    );
    emit.mockClear();
    registerDownloaded.mockRejectedValueOnce(new Error('DB offline'));
    await gateway.handleTvMessage(client, {
      evento: 'media.lista',
      tv_id: 'online',
      url: 'content://media/1',
    });
    expect(emit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.lista.error',
      datos: {
        tv_id: 'online',
        message: 'DB offline',
        code: 'MEDIA_CONFIRM_ERROR',
      },
    });
    expect(emit).toHaveBeenCalledWith('admin.message', {
      evento: 'error',
      datos: {
        tv_id: 'online',
        message: 'DB offline',
        code: 'MEDIA_CONFIRM_ERROR',
      },
    });
  });

  it('notifica una transferencia solo a los sockets del TV destino', () => {
    Object.assign(gateway, {
      activeTvs: new Map([
        [client.id, { tvId: 'online' }],
        ['other-socket', { tvId: 'other-tv' }],
      ]),
    });
    gateway.notifyMedia('other-tv', { transferId: 'transfer-1' });
    expect(clientEmit).not.toHaveBeenCalled();
    gateway.notifyMedia('online', { transferId: 'transfer-1' });
    expect(clientEmit).toHaveBeenCalledWith('tv.message', {
      evento: 'media.disponible',
      datos: { transferId: 'transfer-1' },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('envía repeat por admin.message y espera la confirmación real de la TV', async () => {
    const tvEmit = vi.fn();
    const tvClient = { id: 'tv-socket', emit: tvEmit } as unknown as Socket;
    const data = {
      tv_id: 'TV-E4C95577-2A7',
      contenido_id: '64c9725a-8411-4516-9d45-189e2a66a016',
      repetir: true,
    };
    const confirm = vi.fn(async () => data);
    Object.assign(gateway, {
      activeTvs: new Map([[tvClient.id, { tvId: data.tv_id }]]),
      server: {
        emit,
        to: () => ({ emit }),
        sockets: new Map([
          [client.id, client],
          [tvClient.id, tvClient],
        ]),
      },
      playback: {
        validate: vi.fn((_command, raw) => raw),
        prepare: vi.fn(async (_command, raw) => raw),
        confirm,
      },
      tvsService: { findOne: vi.fn(async () => ({ id: 'db-tv-id' })) },
    });
    await gateway.handleAdminMessage(
      client,
      JSON.stringify({ evento: 'media.repeat', datos: data }),
    );
    expect(tvEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.repeat',
      datos: data,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    // Otro socket no puede confirmar por la TV ni provocar una difusión.
    await gateway.handleTvMessage(client, {
      evento: 'media.repeat',
      datos: data,
    });
    expect(confirm).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tvClient, {
      evento: 'media.repeat',
      datos: data,
    });
    expect(confirm).toHaveBeenCalledWith('db-tv-id', 'media.repeat', data);
    expect(emit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.repeat',
      datos: data,
    });
    expect(tvEmit).toHaveBeenCalledTimes(1);
    await gateway.handleAdminMessage(tvClient, {
      evento: 'media.repeat',
      datos: data,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('envía el estado inicial y permite solicitarlo por el mismo canal', async () => {
    await gateway.handleConnection(client);
    const expected = {
      evento: 'devices.status',
      datos: {
        enline: [{ tv_id: 'online' }],
        low_sengal: [{ tv_id: 'weak' }],
      },
    };
    expect(clientEmit).toHaveBeenLastCalledWith('admin.message', expected);
    expect(clientEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'devices.pending',
      datos: { pendientes_registro: [] },
    });
    await gateway.handleAdminMessage(client, {
      evento: 'devices.status.request',
    });
    expect(clientEmit).toHaveBeenLastCalledWith('admin.message', expected);
  });

  it('restaura reproducción y opciones del panel al reconectar sin enviar órdenes a la TV', async () => {
    tvs[0].estado = {
      estado_reproduccion: 'PAUSED',
      contenido_id: null,
      playlist_id: '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f',
      volumen: 35,
      repetir: true,
      aleatorio: false,
    } as Tv['estado'];
    const panelEmit = vi.fn();
    const panel = {
      ...client,
      rooms: new Set(['playback.admins']),
      emit: panelEmit,
    } as unknown as Socket;
    await gateway.handleConnection(panel);
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.pause',
      datos: {
        tv_id: 'online',
        playlist_id: '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f',
        volumen: 35,
        repetir: true,
        aleatorio: false,
      },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('publica pendientes, registro y desconexión sin eventos anteriores', async () => {
    const device = {
      tvId: 'new-tv',
      ip: '127.0.0.1',
      model: 'TV',
      version_android: '14',
    };
    await gateway.registerDevice(
      { ...device, connectionId: client.id },
      device.tvId,
    );
    expect(emit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'devices.pending',
      datos: { pendientes_registro: [device] },
    });
    expect(emit).toHaveBeenCalledTimes(1);

    tvs.push({
      tv_id: device.tvId,
      estado_conexion: EstadoConexionTv.DESCONECTADO,
    } as Tv);
    await gateway.confirmRegistration(device.tvId);
    expect(emit).toHaveBeenCalledWith('admin.message', {
      evento: 'devices.pending',
      datos: { pendientes_registro: [] },
    });
    expect(emit.mock.lastCall?.[1].datos.enline).toContainEqual({
      tv_id: device.tvId,
    });
    await gateway.handleDisconnect(client);
    expect(emit.mock.lastCall?.[1].datos).toEqual({
      enline: [{ tv_id: 'online' }],
      low_sengal: [{ tv_id: 'weak' }],
    });
    expect(
      emit.mock.calls.every(([channel]) => channel === 'admin.message'),
    ).toBe(true);
  });

  it('retira de pendientes a los dispositivos que se desconectan antes del registro', async () => {
    await gateway.registerDevice(
      {
        connectionId: client.id,
        ip: '127.0.0.1',
        model: 'TV',
        version_android: '14',
      },
      'pending',
    );
    await gateway.handleDisconnect(client);
    expect(emit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'devices.pending',
      datos: { pendientes_registro: [] },
    });
  });
});
