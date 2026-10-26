import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { PlaylistsService } from './playlists.service.js';
import { Playlist } from './entities/playlist.entity.js';
import { PlaylistItem } from './entities/playlist-item.entity.js';
import {
  Contenido,
  TipoContenido,
} from '../contenidos/entities/contenido.entity.js';

function setup() {
  const playlist = {
    id: 'playlist',
    nombre: 'Sala',
    descripcion: null,
    items: [
      { id: 'a', contenido_id: 'video', orden: 0, duracion_segundos: 150 },
      { id: 'b', contenido_id: 'imagen', orden: 1, duracion_segundos: 12 },
    ],
  } as Playlist;
  const repo = {
    find: vi.fn(async () => [playlist]),
    findAndCount: vi.fn(async () => [[playlist], 11]),
    findOne: vi.fn(async () => playlist),
  };
  const itemRepository = {
    maximum: vi.fn(async () => 1),
    existsBy: vi.fn(async () => false),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const manager = {
    findOne: vi.fn(async () => playlist),
    find: vi.fn(async () => playlist.items),
    findOneBy: vi.fn(async () => ({ id: 'video', tipo: TipoContenido.VIDEO })),
    getRepository: vi.fn(() => itemRepository),
    update: vi.fn(async () => ({})),
  };
  const source = { transaction: vi.fn(async (work) => work(manager)) };
  const service = new PlaylistsService(
    repo as unknown as Repository<Playlist>,
    {} as Repository<PlaylistItem>,
    {} as Repository<Contenido>,
    source as unknown as DataSource,
  );
  return { service, repo, manager, itemRepository };
}

describe('PlaylistsService', () => {
  it('pagina playlists y busca por nombre/descripción con el total sin paginar', async () => {
    const { service, repo } = setup();
    const result = await service.findAll({
      page: 2,
      limit: 5,
      search: 'Sala%',
    });
    const options = repo.findAndCount.mock.calls[0] as unknown as [
      Record<string, any>,
    ];
    expect(options[0]).toMatchObject({ skip: 5, take: 5 });
    expect(options[0].relations).toBeUndefined();
    expect(options[0].order).toEqual({ created_at: 'DESC', id: 'ASC' });
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ relations: { items: true } }),
    );
    expect(options[0].where).toHaveLength(4);
    expect(options[0].where[0].nombre.value).toBe('%Sala\\%%');
    expect(result.total).toBe(11);
    expect(result.data[0]).toMatchObject({
      total_elementos: 2,
      duracion_total_segundos: 162,
    });
  });

  it('acepta videos y agrega al final por defecto', async () => {
    const { service, manager, itemRepository } = setup();
    await service.addImage('playlist', {
      contenido_id: 'video',
      duracion_segundos: 150,
    });
    expect(manager.findOneBy).toHaveBeenCalledWith(Contenido, {
      id: 'video',
      deleted: false,
    });
    expect(itemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ orden: 2 }),
    );
  });

  it('rechaza contenido eliminado o inexistente', async () => {
    const { service, manager, itemRepository } = setup();
    manager.findOneBy.mockResolvedValueOnce(null as never);
    await expect(
      service.addImage('playlist', {
        contenido_id: 'video',
        duracion_segundos: 150,
      }),
    ).rejects.toThrow('no encontrado');
    expect(itemRepository.save).not.toHaveBeenCalled();
  });

  it('usa diez segundos por defecto para una imagen y requiere duración real para videos', async () => {
    const { service, manager, itemRepository } = setup();
    manager.findOneBy.mockResolvedValueOnce({
      id: 'imagen',
      tipo: TipoContenido.IMAGEN,
    });
    await service.addImage('playlist', { contenido_id: 'imagen' });
    expect(itemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ duracion_segundos: 10 }),
    );
    itemRepository.save.mockClear();
    await expect(
      service.addImage('playlist', { contenido_id: 'video' }),
    ).rejects.toThrow('duración real');
    expect(itemRepository.save).not.toHaveBeenCalled();
  });

  it('intercambia posiciones usando posiciones temporales para evitar colisiones', async () => {
    const { service, manager } = setup();
    await service.reorder('playlist', ['b', 'a']);
    expect(manager.update.mock.calls.slice(0, 4)).toEqual([
      [PlaylistItem, { id: 'a' }, { orden: -1 }],
      [PlaylistItem, { id: 'b' }, { orden: -2 }],
      [PlaylistItem, { id: 'b' }, { orden: 0 }],
      [PlaylistItem, { id: 'a' }, { orden: 1 }],
    ]);
  });

  it.each([['a'], ['a', 'a'], ['a', 'externo']])(
    'rechaza órdenes incompletos, repetidos o ajenos: %j',
    async (...ids) => {
      const { service, manager } = setup();
      await expect(service.reorder('playlist', ids)).rejects.toThrow(
        'sin repetir',
      );
      expect(manager.update).not.toHaveBeenCalled();
    },
  );
});
