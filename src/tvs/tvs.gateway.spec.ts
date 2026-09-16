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
    });
  });

  afterEach(() => gateway.onModuleDestroy());

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
      transfers: { complete },
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
