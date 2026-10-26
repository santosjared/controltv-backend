import { afterAll, describe, expect, it, vi } from 'vitest';
import { readdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource, Repository } from 'typeorm';
import type { Contenido } from './entities/contenido.entity.js';

vi.mock('./media-storage.js', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    CONTENT_DIR: mkdtempSync(join(tmpdir(), 'content-quota-')),
    CONTENT_STAGING_DIR: mkdtempSync(join(tmpdir(), 'content-stage-')),
  };
});
import { CONTENT_DIR, CONTENT_STAGING_DIR } from './media-storage.js';
import { ContenidosService } from './contenidos.service.js';

afterAll(async () => {
  await rm(CONTENT_DIR, { recursive: true, force: true });
  await rm(CONTENT_STAGING_DIR, { recursive: true, force: true });
});

describe('Limite real del almacenamiento', () => {
  it('rechaza el septimo, limpia la carga rechazada y libera cupo al eliminar', async () => {
    for (let i = 0; i < 6; i++)
      await writeFile(join(CONTENT_DIR, `existing-${i}`), 'image');
    const manager = {
      query: vi.fn(),
      create: vi.fn((_entity, item) => ({ id: 'new', ...item })),
      save: vi.fn(async (_entity, item) => item),
    };
    const repo = {
      findOne: vi
        .fn()
        .mockResolvedValue({
          id: 'old',
          archivo: 'existing-0',
          deleted: false,
        }),
      save: vi.fn(),
    };
    const source = {
      transaction: async (fn: (m: typeof manager) => unknown) => fn(manager),
    };
    const service = new ContenidosService(
      repo as unknown as Repository<Contenido>,
      source as unknown as DataSource,
    );
    const file = {
      path: join(CONTENT_STAGING_DIR, 'new'),
      filename: 'new',
      originalname: 'image.png',
      mimetype: 'image/png',
      size: 5,
    };
    await writeFile(file.path, 'image');
    await expect(service.upload([file])).rejects.toThrow(
      'Solo puedes almacenar 6 archivos',
    );
    expect((await readdir(CONTENT_DIR)).length).toBe(6);
    await expect(access(file.path)).rejects.toThrow();
    expect(manager.save).not.toHaveBeenCalled();
    await service.remove('old');
    expect((await readdir(CONTENT_DIR)).length).toBe(5);
    await writeFile(file.path, 'image');
    expect(await service.upload([file])).toHaveLength(1);
    expect((await readdir(CONTENT_DIR)).length).toBe(6);
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      [7462106],
    );
  });
});
