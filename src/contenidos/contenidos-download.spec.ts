import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { Response } from 'express';
import { stat } from 'node:fs/promises';
import { ContenidosService } from './contenidos.service.js';
import { ContenidosController } from './contenidos.controller.js';
import type { Contenido } from './entities/contenido.entity.js';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  stat: vi.fn(),
}));

function serviceFor(archivo: string | null = 'stored-file') {
  const query = {
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn(async () => ({ archivo, nombre: 'video.mp4' })),
  };
  return new ContenidosService(
    {
      createQueryBuilder: () => query,
    } as unknown as Repository<Contenido>,
    {} as DataSource,
  );
}

describe('Descarga de contenidos', () => {
  it('devuelve 404 si el registro existe pero el archivo fue borrado', async () => {
    vi.mocked(stat).mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await expect(serviceFor().getFile('id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devuelve el archivo cuando existe', async () => {
    vi.mocked(stat).mockResolvedValueOnce({ isFile: () => true } as never);
    await expect(serviceFor().getFile('id')).resolves.toMatchObject({
      nombre: 'video.mp4',
    });
  });

  it('conserva los errores de permisos para no ocultarlos como archivos inexistentes', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.mocked(stat).mockRejectedValueOnce(error);
    await expect(serviceFor().getFile('id')).rejects.toBe(error);
  });

  it('maneja el borrado entre la comprobación y el envío con un 404', async () => {
    const service = {
      getFile: vi.fn(async () => ({ path: '/file', nombre: 'video.mp4' })),
    };
    const controller = new ContenidosController(
      service as unknown as ContenidosService,
    );
    const res = {
      headersSent: false,
      setHeader: vi.fn(),
      type: vi.fn(),
      download: vi.fn((_path, _nombre, callback) =>
        callback(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      ),
    };
    const next = vi.fn();
    await controller.download('id', res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });
});

describe('Cancelación normal de vista previa', () => {
  it.each(['ECONNABORTED', 'ECONNRESET'])(
    'no trata %s del cliente como error del servidor',
    async (code) => {
      const controller = new ContenidosController({
        getFile: async () => ({ path: '/file', nombre: 'video.mp4' }),
      } as unknown as ContenidosService);
      const res = {
        setHeader: vi.fn(),
      type: vi.fn(),
        download: vi.fn((_path, _name, callback) =>
          callback(Object.assign(new Error('Request aborted'), { code })),
        ),
      };
      const next = vi.fn();
      await controller.download('id', res as unknown as Response, next);
      expect(next).not.toHaveBeenCalled();
    },
  );
});
