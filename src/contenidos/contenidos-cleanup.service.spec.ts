import { describe, expect, it, vi } from 'vitest';
import { boliviaMidnight } from './contenidos-cleanup.service.js';
import type { Repository } from 'typeorm';
import type { Contenido } from './entities/contenido.entity.js';
import { ContenidosService } from './contenidos.service.js';
import type { DataSource } from 'typeorm';

describe('Contenidos CRUD', () => {
  it('elimina cambiando el estado sin borrar el registro', async () => {
    const item = { id: 'id', deleted: false };
    const repo = {
      findOne: vi.fn().mockResolvedValue(item),
      save: vi.fn().mockResolvedValue(item),
    };
    const service = new ContenidosService(
      repo as unknown as Repository<Contenido>,
      {} as DataSource,
    );
    expect(await service.remove('id')).toEqual({ id: 'id', deleted: true });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'id' },
      select: { id: true, archivo: true, deleted: true },
    });
    expect(repo.save).toHaveBeenCalledWith({ id: 'id', deleted: true });
  });
  it('rechaza una carga sin archivos', async () => {
    const service = new ContenidosService(
      {} as Repository<Contenido>,
      {} as DataSource,
    );
    await expect(service.upload([])).rejects.toThrow('files es obligatorio');
  });
  it('pagina y excluye eliminados', async () => {
    const query = Object.fromEntries(
      ['where', 'orderBy', 'addOrderBy', 'skip', 'take'].map((key) => [
        key,
        vi.fn().mockReturnThis(),
      ]),
    );
    query.getManyAndCount = vi.fn().mockResolvedValue([[], 0]);
    const repo = { createQueryBuilder: vi.fn().mockReturnValue(query) };
    const service = new ContenidosService(
      repo as unknown as Repository<Contenido>,
      {} as DataSource,
    );
    expect(await service.findAll({ page: 2, limit: 5 })).toEqual({
      data: [],
      total: 0,
    });
    expect(query.where).toHaveBeenCalledWith('contenido.deleted = false');
    expect(query.skip).toHaveBeenCalledWith(5);
    expect(query.take).toHaveBeenCalledWith(5);
  });
});

describe('Horario de limpieza', () => {
  it('usa medianoche de Bolivia incluso cuando cambia el d�a UTC', () => {
    expect(
      new Date(
        boliviaMidnight(Date.parse('2026-10-23T03:59:59Z')),
      ).toISOString(),
    ).toBe('2026-10-22T04:00:00.000Z');
    expect(
      new Date(
        boliviaMidnight(Date.parse('2026-10-23T04:00:00Z')),
      ).toISOString(),
    ).toBe('2026-10-23T04:00:00.000Z');
  });
});

describe('Almacenamiento', () => {
  it('borra el archivo y permite eliminar aunque ya no exista', async () => {
    const { writeFile, access } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { CONTENT_DIR } = await import('./media-storage.js');
    const { randomUUID } = await import('node:crypto');
    const filename = randomUUID();
    const path = join(CONTENT_DIR, filename);
    await writeFile(path, 'test');
    const item = { id: 'id', archivo: filename, deleted: false };
    const repo = {
      findOne: vi.fn().mockResolvedValue(item),
      save: vi.fn().mockResolvedValue(item),
    };
    const service = new ContenidosService(
      repo as unknown as Repository<Contenido>,
      {} as DataSource,
    );
    expect(await service.remove('id')).toEqual({ id: 'id', deleted: true });
    await expect(access(path)).rejects.toThrow();
    expect(await service.remove('id')).toEqual({ id: 'id', deleted: true });
  });
});
