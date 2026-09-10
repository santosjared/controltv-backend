import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { ContenidosService } from './contenidos.service.js';
import { Contenido, TipoContenido } from './entities/contenido.entity.js';
import {
  EstadoTv,
  EstadoReproduccion,
} from '../estados-tv/entities/estado-tv.entity.js';

describe('Contenido descargado por TV', () => {
  it.each([null, 'existing-content'])(
    'guarda usando el contenido asociado: %s',
    async (existingId) => {
      const manager = {
        findOneBy: vi.fn(async () =>
          existingId
            ? { contenido_id: existingId, volumen: 75, repetir: true }
            : null,
        ),
        save: vi.fn(async (_entity, data) => data),
      };
      const service = new ContenidosService(
        {} as Repository<Contenido>,
        {
          transaction: async (callback) => callback(manager),
        } as unknown as DataSource,
      );
      const result = await service.registerDownloaded(
        'transfer-id',
        'tv-db-id',
        'content://media/new',
        {
          path: '/temporary',
          originalname: 'new.png',
          mimetype: 'image/png',
          size: 123,
        },
      );
      const id = existingId ?? 'transfer-id';
      expect(manager.findOneBy).toHaveBeenCalledWith(EstadoTv, {
        tv_id: 'tv-db-id',
      });
      expect(manager.save).toHaveBeenCalledWith(Contenido, {
        id,
        nombre: 'new.png',
        tipo: TipoContenido.IMAGEN,
        url: 'content://media/new',
        tamano_bytes: '123',
      });
      expect(result.id).toBe(id);
      expect(manager.save).toHaveBeenCalledWith(
        EstadoTv,
        expect.objectContaining({
          tv_id: 'tv-db-id',
          contenido_id: id,
          posicion_segundos: 0,
          estado_reproduccion: EstadoReproduccion.PLAYING,
          ...(existingId ? { volumen: 75, repetir: true } : {}),
        }),
      );
    },
  );
});
