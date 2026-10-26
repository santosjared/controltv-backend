import { describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ContenidosService } from './contenidos.service.js';
import { Contenido, TipoContenido } from './entities/contenido.entity.js';
import { ContenidoPaginationQueryDto } from './dto/contenido-pagination-query.dto.js';

describe('Filtro de contenidos por type', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const metadata = {
    type: 'query' as const,
    metatype: ContenidoPaginationQueryDto,
  };

  it.each(['VIDEO', 'IMAGEN'])(
    'acepta %s y transforma la paginación',
    async (type) => {
      await expect(
        pipe.transform(
          { type, page: '2', limit: '5', search: ' sala ' },
          metadata,
        ),
      ).resolves.toMatchObject({ type, page: 2, limit: 5, search: 'sala' });
    },
  );

  it('rechaza tipos desconocidos', async () => {
    await expect(pipe.transform({ type: 'AUDIO' }, metadata)).rejects.toThrow();
  });

  it.each([undefined, TipoContenido.VIDEO, TipoContenido.IMAGEN])(
    'aplica el filtro antes de paginar y contar: %s',
    async (type) => {
      const builder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn(async () => [[], 12]),
      };
      const service = new ContenidosService(
        {
          createQueryBuilder: () => builder,
        } as unknown as Repository<Contenido>,
        {} as DataSource,
      );
      const result = await service.findAll({
        page: 2,
        limit: 5,
        type,
        search: 'sala',
      });
      if (type)
        expect(builder.andWhere).toHaveBeenCalledWith(
          'contenido.tipo = :type',
          { type },
        );
      else
        expect(builder.andWhere).not.toHaveBeenCalledWith(
          'contenido.tipo = :type',
          expect.anything(),
        );
      expect(builder.where).toHaveBeenCalledWith('contenido.deleted = false');
      expect(builder.skip).toHaveBeenCalledWith(5);
      expect(builder.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({ data: [], total: 12 });
    },
  );
});
