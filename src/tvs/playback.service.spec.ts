import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PlaybackService } from './playback.service.js';
import type { ContenidosService } from '../contenidos/contenidos.service.js';
import type { PlaylistsService } from '../playlists/playlists.service.js';
import type { EstadoTv } from '../estados-tv/entities/estado-tv.entity.js';

const contentId = '64c9725a-8411-4516-9d45-189e2a66a016';
const playlistId = '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f';
const tv_id = 'TV-ABC';
function setup() {
  const contents = {
    findOne: vi.fn(async (id) => ({
      id,
      tipo: 'VIDEO',
      url: `/contenidos/${id}/archivo`,
    })),
    getFile: vi.fn(async () => ({ path: '/file', nombre: 'file.mp4' })),
  };
  const playlists = {
    findOne: vi.fn(async () => ({
      id: playlistId,
      nombre: 'Sala',
      items: [
        {
          id: 'item-video',
          contenido_id: contentId,
          orden: 0,
          duracion_segundos: 150,
          contenido: { tipo: 'VIDEO' },
        },
        {
          id: 'item-image',
          contenido_id: playlistId,
          orden: 1,
          duracion_segundos: 12,
          contenido: { tipo: 'IMAGEN' },
        },
      ],
    })),
  };
  const states = {
    findOneBy: vi.fn(async () => ({
      tv_id: 'db-tv',
      repetir: true,
      aleatorio: true,
      volumen: 50,
    })),
    create: vi.fn((data) => ({ ...data })),
    save: vi.fn(async (data) => data),
  };
  const service = new PlaybackService(
    contents as unknown as ContenidosService,
    playlists as unknown as PlaylistsService,
    {
      ...states,
      manager: {
        transaction: async (work: (manager: unknown) => unknown) =>
          work({
            findOne: async () => ({ id: 'db-tv' }),
            getRepository: () => states,
          }),
      },
    } as unknown as Repository<EstadoTv>,
    new ConfigService({ JWT_SECRET: 'test-secret' }),
  );
  return { service, contents, playlists, states };
}

describe('Contrato de reproducción', () => {
  it('rechaza ambos contextos y UUID inválidos', () => {
    const { service } = setup();
    expect(() =>
      service.validate('media.play', {
        tv_id,
        contenido_id: contentId,
        playlist_id: playlistId,
      }),
    ).toThrow('nunca ambos');
    expect(() =>
      service.validate('media.play', { tv_id, contenido_id: 'invalid' }),
    ).toThrow('UUID');
  });
  it('acepta stop sin selección y booleanos false explícitos', () => {
    const { service } = setup();
    expect(service.validate('media.stop', { tv_id })).toEqual({ tv_id });
    expect(
      service.validate('media.shuffle', { tv_id, aleatorio: false }),
    ).toEqual({ tv_id, aleatorio: false });
    expect(service.validate('media.repeat', { tv_id, repetir: false })).toEqual(
      { tv_id, repetir: false },
    );
    expect(() =>
      service.validate('media.shuffle', { tv_id, aleatorio: 'true' }),
    ).toThrow();
    expect(() =>
      service.validate('media.repeat', { tv_id, repetir: 1 }),
    ).toThrow();
    expect(() =>
      service.validate('media.volume', { tv_id, volumen: '50' }),
    ).toThrow();
  });
  it('resuelve la playlist en orden, conserva tiempos de imágenes y usa duración detectada para videos', async () => {
    const { service, contents, states } = setup();
    contents.findOne.mockImplementation(async (id) => ({
      id,
      tipo: id === contentId ? 'VIDEO' : 'IMAGEN',
      url: `/contenidos/${id}/archivo`,
    }));
    const prepared = await service.prepare(
      'media.play',
      { tv_id, playlist_id: playlistId },
      'db-tv',
    );
    expect(prepared).toMatchObject({
      repetir: true,
      aleatorio: true,
      playlist: {
        items: [
          { orden: 0, duracion_segundos: null },
          { orden: 1, duracion_segundos: 12 },
        ],
      },
    });
    expect(states.save).not.toHaveBeenCalled();
  });
  it('genera enlaces firmados para la TV y rechaza su uso para otra TV', async () => {
    const { service, contents } = setup();
    const prepared = await service.prepare('media.play', {
      tv_id,
      contenido_id: contentId,
    });
    const url = new URL(
      (prepared as { contenido: { url: string } }).contenido.url,
      'http://backend',
    );
    const expires = url.searchParams.get('expires');
    const token = url.searchParams.get('token');
    await expect(
      service.getFile(tv_id, contentId, expires, token),
    ).resolves.toMatchObject({ nombre: 'file.mp4' });
    await expect(
      service.getFile('TV-OTHER', contentId, expires, token),
    ).rejects.toThrow('inválido');
    await expect(service.getFile(tv_id, contentId, '1', token)).rejects.toThrow(
      'expirado',
    );
    expect(contents.getFile).toHaveBeenCalledTimes(2);
  });
  it('no prepara reproducción si el archivo fue limpiado', async () => {
    const { service, contents } = setup();
    contents.getFile.mockRejectedValueOnce(new Error('Archivo no disponible'));
    await expect(
      service.prepare('media.play', { tv_id, contenido_id: contentId }),
    ).rejects.toThrow('no disponible');
  });
  it('guarda opciones solo al confirmar y no altera el orden de la playlist', async () => {
    const { service, states, playlists } = setup();
    await service.confirm('db-tv', 'media.shuffle', {
      tv_id,
      aleatorio: false,
    });
    expect(states.save).toHaveBeenCalledWith(
      expect.objectContaining({ aleatorio: false, repetir: true }),
    );
    expect(playlists.findOne).not.toHaveBeenCalled();
  });
});

describe('Contenido actual dentro de playlist', () => {
  it('conserva la playlist y publica nombre/tipo del archivo que está reproduciendo', async () => {
    const { service, states, contents } = setup();
    states.findOneBy.mockResolvedValue({
      tv_id: 'db-tv',
      repetir: true,
      aleatorio: true,
      volumen: 50,
      playlist_id: playlistId,
    } as never);
    contents.findOne.mockResolvedValue({
      id: contentId,
      nombre: 'probando.mp4',
      tipo: 'VIDEO',
      url: '/archivo',
    } as never);
    const result = await service.confirm('db-tv', 'media.play', {
      tv_id,
      contenido_actual_id: contentId,
    });
    expect(result).toMatchObject({
      playlist_id: playlistId,
      contenido_actual: {
        id: contentId,
        nombre: 'probando.mp4',
        tipo: 'VIDEO',
      },
    });
    expect(states.save).toHaveBeenCalledWith(
      expect.objectContaining({
        playlist_id: playlistId,
        contenido_id: contentId,
      }),
    );
    expect(contents.getFile).not.toHaveBeenCalled();
  });
  it('rechaza un archivo ajeno a la playlist activa', async () => {
    const { service, states } = setup();
    states.findOneBy.mockResolvedValue({
      tv_id: 'db-tv',
      repetir: true,
      aleatorio: true,
      volumen: 50,
      playlist_id: playlistId,
    } as never);
    await expect(
      service.confirm('db-tv', 'media.play', {
        tv_id,
        contenido_actual_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).rejects.toThrow('no pertenece');
    expect(states.save).not.toHaveBeenCalled();
  });
});

describe('Preparación segura de contenido', () => {
  it('prepara sin autoplay por defecto y solo permite reproducción con aprobación explícita', async () => {
    const {service} = setup();
    const prepared = service.validate('media.play', {tv_id, contenido_id: contentId});
    expect(prepared.auto_reproducir).toBe(false);
    const state = await service.confirm('db-tv', 'media.play', prepared);
    expect(state.estado_reproduccion).toBe('STOPPED');
    const play = service.validate('media.play', {tv_id, contenido_id: contentId, auto_reproducir: true});
    expect((await service.confirm('db-tv', 'media.play', play)).estado_reproduccion).toBe('PLAYING');
  });
});
