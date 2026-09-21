import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { TvsService } from './tvs.service.js';
import { Tv } from './entities/tv.entity.js';
import { EstadoTv } from '../estados-tv/entities/estado-tv.entity.js';

describe('TvsService edición y eliminación', () => {
  it('edita únicamente la TV y su sala identificada por sala_id', async () => {
    const tv = {
      id: '7dd11984-88da-4e75-a6d7-50fb773918ae',
      tv_id: 'TV-E4C95577-2A7',
      nombre: 'TV anterior',
      sala_id: '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f',
      sala: { nombre: 'Sala anterior', ubicacion: 'Primer piso' },
    } as Tv;
    const repo = {
      findOne: vi.fn(async () => tv),
    } as unknown as Repository<Tv>;
    const tvRepository = { save: vi.fn(async (value) => value) };
    const salaRepository = {
      findOneBy: vi.fn(async () => ({
        id: tv.sala_id,
        nombre: 'Sala anterior',
        ubicacion: 'Primer piso',
      })),
      save: vi.fn(async (value) => value),
    };
    const manager = {
      getRepository: vi.fn((entity) =>
        entity === Tv ? tvRepository : salaRepository,
      ),
    };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
    } as unknown as DataSource;
    const service = new TvsService(repo, dataSource);

    await service.update(tv.tv_id, {
      tv_id: tv.tv_id,
      nombre: 'TV - Partos',
      sala_id: tv.sala_id,
      sala: 'Partos',
      ubicacion: 'Planta baja',
    });

    expect(salaRepository.findOneBy).toHaveBeenCalledWith({ id: tv.sala_id });
    expect(salaRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Partos', ubicacion: 'Planta baja' }),
    );
    expect(tvRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'TV - Partos',
        sala_id: tv.sala_id,
      }),
    );
  });

  it('elimina estado y TV en una transacción', async () => {
    const tv = {
      id: '84d23cd1-f4a0-4439-98f7-bfd344ba3f7f',
      tv_id: 'TV-E4C95577-2A7',
    } as Tv;
    const repo = {
      findOne: vi.fn(async () => tv),
    } as unknown as Repository<Tv>;
    const manager = {
      delete: vi
        .fn()
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 1 }),
    };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
    } as unknown as DataSource;
    const service = new TvsService(repo, dataSource);

    await expect(service.remove('TV-E4C95577-2A7')).resolves.toEqual({
      id: tv.id,
      tv_id: tv.tv_id,
      deleted: true,
    });
    expect(manager.delete).toHaveBeenNthCalledWith(1, EstadoTv, {
      tv_id: tv.id,
    });
    expect(manager.delete).toHaveBeenNthCalledWith(2, Tv, { id: tv.id });
  });
});
