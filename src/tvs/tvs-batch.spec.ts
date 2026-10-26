import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { TvsGateway } from './tvs.gateway.js';
import type { TvsService } from './tvs.service.js';
import { PlaybackService } from './playback.service.js';
import type { ContenidosService } from '../contenidos/contenidos.service.js';
import type { PlaylistsService } from '../playlists/playlists.service.js';
import type { Repository } from 'typeorm';
import type { EstadoTv } from '../estados-tv/entities/estado-tv.entity.js';

const request_id = '64c9725a-8411-4516-9d45-189e2a66a016';
const otherRequest = '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f';

describe('Órdenes de grupo por admin.message', () => {
  let gateway: TvsGateway;
  const panelEmit = vi.fn();
  const broadcast = vi.fn();
  const tvEmit = vi.fn();
  const otherEmit = vi.fn();
  const confirm = vi.fn(async (_id, _command, data) => data);
  const prepare = vi.fn(async (_command, data) => data);
  const panel = {
    id: 'panel',
    emit: panelEmit,
    handshake: { auth: { token: 'token' } },
    join: vi.fn(),
  } as unknown as Socket;
  const tv = { id: 'socket-tv', emit: tvEmit } as unknown as Socket;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const validator = new PlaybackService(
      {} as ContenidosService,
      {} as PlaylistsService,
      {} as Repository<EstadoTv>,
      new ConfigService(),
    );
    gateway = new TvsGateway({
      findOne: vi.fn(async () => ({ id: 'db-tv' })),
      updateConnectionStatus: vi.fn(),
      findAll: vi.fn(async () => []),
    } as unknown as TvsService);
    Object.assign(gateway, {
      auth: {
        verify: () => ({ sub: 'admin', permissions: ['tvs.control'] }),
        ensureActiveUser: vi.fn(),
      },
      playback: {
        validate: validator.validate.bind(validator),
        prepare,
        confirm,
      },
      activeTvs: new Map([
        [tv.id, { tvId: 'TV-001' }],
        ['socket-other', { tvId: 'TV-003' }],
      ]),
      server: {
        emit: broadcast,
        to: () => ({ emit: broadcast }),
        sockets: new Map([
          [panel.id, panel],
          [tv.id, tv],
          ['socket-other', { emit: otherEmit }],
        ]),
      },
    });
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    vi.useRealTimers();
  });

  it('refleja el fin del video enviado desde su control local por una TV identificada', async () => {
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { tv_id: 'TV-001', origen: 'tv' },
    });
    expect(confirm).toHaveBeenCalledWith('db-tv', 'media.stop', {
      tv_id: 'TV-001',
    });
    expect(broadcast).toHaveBeenCalledWith('admin.message', {
      evento: 'media.stop',
      datos: { tv_id: 'TV-001' },
    });
    expect(tvEmit).not.toHaveBeenCalled();
  });

  it('no acepta un aviso de parada de un socket ajeno a la TV', async () => {
    await gateway.handleTvMessage(
      { id: 'impostor', emit: vi.fn() } as unknown as Socket,
      { evento: 'media.stop', datos: { tv_id: 'TV-001' } },
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('separa el grupo y produce resultados independientes después de confirmar', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.stop',
      datos: { request_id, tv_ids: ['TV-001', 'TV-002'] },
    });
    expect(tvEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.stop',
      datos: { request_id, tv_id: 'TV-001' },
    });
    expect(otherEmit).not.toHaveBeenCalled();
    expect(panelEmit).toHaveBeenCalledExactlyOnceWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-002',
        accion: 'media.stop',
        ok: false,
        code: 'TV_OFFLINE',
        message: expect.any(String),
      },
    });
    expect(confirm).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { request_id, tv_id: 'TV-001' },
    });
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.stop', ok: true },
    });
  });

  it('ignora media.lista antiguo sin transferencia y permite confirmar la reproducción nueva', async () => {
    const complete = vi.fn();
    const registerDownloaded = vi.fn();
    Object.assign(gateway, {
      transfers: { pending: vi.fn(() => []), complete },
      contenidos: { registerDownloaded },
    });
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await gateway.handleTvMessage(tv, {
      evento: 'media.lista',
      tv_id: 'TV-001',
      url: 'file:///storage/emulated/0/Movies/probando.mp4',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(registerDownloaded).not.toHaveBeenCalled();
    expect(panelEmit).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(tvEmit).toHaveBeenCalledTimes(1);
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('guarda controles locales de la TV y avisa al panel sin reenviar la orden a la TV', async () => {
    await gateway.handleAdminMessage(tv, {
      evento: 'media.pause',
      datos: { tv_id: 'TV-001', origen: 'tv' },
    });
    expect(confirm).toHaveBeenCalledWith('db-tv', 'media.pause', {
      tv_id: 'TV-001',
    });
    expect(broadcast).toHaveBeenCalledWith('admin.message', {
      evento: 'media.pause',
      datos: { tv_id: 'TV-001' },
    });
    expect(tvEmit).not.toHaveBeenCalled();
    expect(panelEmit).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'sincroniza Aleatorio local con el admin: %s',
    async (aleatorio) => {
      await gateway.handleAdminMessage(tv, {
        evento: 'media.shuffle',
        datos: { tv_id: 'TV-001', origen: 'tv', aleatorio },
      });
      expect(confirm).toHaveBeenCalledWith('db-tv', 'media.shuffle', {
        tv_id: 'TV-001',
        aleatorio,
      });
      expect(broadcast).toHaveBeenCalledWith('admin.message', {
        evento: 'media.shuffle',
        datos: { tv_id: 'TV-001', aleatorio },
      });
      expect(tvEmit).not.toHaveBeenCalled();
    },
  );

  it('procesa el acuse y el aviso automático simultáneos sin cancelar el envío', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await Promise.all([
      gateway.handleAdminMessage(tv, {
        evento: 'media.result',
        datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
      }),
      gateway.handleAdminMessage(tv, {
        evento: 'media.play',
        datos: {
          tv_id: 'TV-001',
          origen: 'tv',
          contenido_actual_id: otherRequest,
        },
      }),
    ]);
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(
      panelEmit.mock.calls.some(
        ([, message]) => message.datos?.code === 'CANCELLED',
      ),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('ignora el aviso automático anterior mientras se prepara una selección nueva', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.play',
      datos: {
        tv_id: 'TV-001',
        origen: 'tv',
        contenido_actual_id: otherRequest,
      },
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(panelEmit).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
  });

  it('permite consultar estado con tvs.view pero no enviar órdenes', async () => {
    (gateway as any).auth.verify = () => ({
      sub: 'viewer',
      permissions: ['tvs.view'],
    });
    await gateway.handleAdminMessage(panel, {
      evento: 'devices.status.request',
      datos: {},
    });
    expect(panel.join).toHaveBeenCalledWith('playback.admins');
    await gateway.handleAdminMessage(panel, {
      evento: 'media.stop',
      datos: { request_id, tv_ids: ['TV-001'] },
    });
    expect(tvEmit).not.toHaveBeenCalled();
    expect(panelEmit).toHaveBeenCalledWith(
      'admin.message',
      expect.objectContaining({
        evento: 'media.result',
        datos: expect.objectContaining({ ok: false, code: 'FORBIDDEN' }),
      }),
    );
  });

  it('rechaza cambios locales de un socket que intenta controlar otra TV', async () => {
    await gateway.handleTvMessage(tv, {
      evento: 'media.stop',
      datos: { tv_id: 'TV-003', origen: 'tv' },
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('un control local reemplaza la orden remota pendiente y su confirmación tardía no revierte el estado', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { tv_id: 'TV-001', origen: 'tv' },
    });
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.play',
        ok: false,
        code: 'CANCELLED',
        message: expect.any(String),
      },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: { tv_id: 'TV-001', request_id, accion: 'media.play', ok: true },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('db-tv', 'media.stop', {
      tv_id: 'TV-001',
    });
  });

  it('publica errores del reproductor local aun sin una orden remota pendiente', async () => {
    await gateway.handleAdminMessage(tv, {
      evento: 'media.error',
      datos: {
        tv_id: 'TV-001',
        origen: 'tv',
        code: 'PLAYBACK_FAILED',
        message: 'Archivo dañado',
      },
    });
    expect(broadcast).toHaveBeenCalledWith('admin.message', {
      evento: 'media.error',
      datos: {
        tv_id: 'TV-001',
        code: 'PLAYBACK_FAILED',
        message: 'Archivo dañado',
      },
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('devuelve tiempo de espera por la TV que no responde', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.pause',
      datos: { request_id, tv_ids: ['TV-001'] },
    });
    expect(panelEmit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.pause',
        ok: false,
        code: 'PLAYBACK_TIMEOUT',
        message: expect.any(String),
      },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.pause',
      datos: { request_id, tv_id: 'TV-001' },
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('permite terminar la descarga después de 30 segundos y confirmar reproducción', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(panelEmit).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
  });

  it('vence una descarga sin respuesta en 15 minutos', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(panelEmit).toHaveBeenCalledExactlyOnceWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.play',
        ok: false,
        code: 'PLAYBACK_TIMEOUT',
        message: expect.any(String),
      },
    });
  });

  it('renueva la espera con avance real y comunica progreso sin confirmar éxito', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    await vi.advanceTimersByTimeAsync(840_000);
    await gateway.handleAdminMessage(tv, {
      evento: 'media.progress',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.play',
        porcentaje: 40,
      },
    });
    expect(panelEmit).toHaveBeenCalledExactlyOnceWith('admin.message', {
      evento: 'media.progress',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.play',
        estado: 'DOWNLOADING',
        porcentaje: 40,
      },
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(panelEmit).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: { request_id, tv_id: 'TV-001', accion: 'media.play', ok: true },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('no renueva la espera con progreso repetido ni de otra petición', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.play',
      datos: { request_id, tv_ids: ['TV-001'], contenido_id: otherRequest },
    });
    const progress = {
      request_id,
      tv_id: 'TV-001',
      accion: 'media.play',
      porcentaje: 40,
    };
    await gateway.handleAdminMessage(tv, {
      evento: 'media.progress',
      datos: progress,
    });
    await vi.advanceTimersByTimeAsync(840_000);
    await gateway.handleAdminMessage(tv, {
      evento: 'media.progress',
      datos: progress,
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.progress',
      datos: { ...progress, request_id: otherRequest, porcentaje: 50 },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.play',
        ok: false,
        code: 'PLAYBACK_TIMEOUT',
        message: expect.any(String),
      },
    });
  });

  it('correlaciona órdenes iguales por request_id y no acepta confirmaciones sin él', async () => {
    for (const id of [request_id, otherRequest])
      await gateway.handleAdminMessage(panel, {
        evento: 'media.stop',
        datos: { request_id: id, tv_ids: ['TV-001'] },
      });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { tv_id: 'TV-001' },
    });
    expect(confirm).not.toHaveBeenCalled();
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { request_id: otherRequest, tv_id: 'TV-001' },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id: otherRequest,
        tv_id: 'TV-001',
        accion: 'media.stop',
        ok: true,
      },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.stop',
      datos: { request_id: otherRequest, tv_id: 'TV-001' },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('asocia el error de TV a su petición sin cancelar otras', async () => {
    for (const id of [request_id, otherRequest])
      await gateway.handleAdminMessage(panel, {
        evento: 'media.stop',
        datos: { request_id: id, tv_ids: ['TV-001'] },
      });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.error',
      datos: {
        request_id,
        tv_id: 'TV-001',
        code: 'DOWNLOAD_FAILED',
        message: 'Falló la descarga',
      },
    });
    expect(panelEmit).toHaveBeenLastCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.stop',
        ok: false,
        code: 'DOWNLOAD_FAILED',
        message: 'Falló la descarga',
      },
    });
    await gateway.handleAdminMessage(tv, {
      evento: 'media.result',
      datos: {
        request_id: otherRequest,
        tv_id: 'TV-001',
        accion: 'media.stop',
        ok: true,
      },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('responde TV_OFFLINE si la TV se desconecta antes de confirmar', async () => {
    await gateway.handleAdminMessage(panel, {
      evento: 'media.stop',
      datos: { request_id, tv_ids: ['TV-001'] },
    });
    await gateway.handleDisconnect(tv);
    expect(panelEmit).toHaveBeenCalledWith('admin.message', {
      evento: 'media.result',
      datos: {
        request_id,
        tv_id: 'TV-001',
        accion: 'media.stop',
        ok: false,
        code: 'TV_OFFLINE',
        message: expect.any(String),
      },
    });
  });

  it.each([
    { request_id, tv_ids: [] },
    { request_id, tv_ids: ['TV-001', 'TV-001'] },
    { request_id: 'invalid', tv_ids: ['TV-001'] },
    { request_id, tv_ids: ['TV-001'], tv_id: 'TV-003' },
  ])('rechaza grupos inválidos sin enviar órdenes: %j', async (datos) => {
    await gateway.handleAdminMessage(panel, { evento: 'media.stop', datos });
    expect(tvEmit).not.toHaveBeenCalled();
    expect(otherEmit).not.toHaveBeenCalled();
    expect(panelEmit).toHaveBeenCalledWith(
      'admin.message',
      expect.objectContaining({
        evento: 'media.error',
        datos: expect.objectContaining({ code: 'INVALID_COMMAND' }),
      }),
    );
  });
});
