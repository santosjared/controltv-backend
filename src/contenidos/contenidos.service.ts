import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Contenido, TipoContenido } from './entities/contenido.entity.js';
import {
  EstadoTv,
  EstadoReproduccion,
} from '../estados-tv/entities/estado-tv.entity.js';
import type { MediaFile } from '../tvs/transfers.service.js';
import { CreateContenidoDto } from './dto/create-contenido.dto.js';
import { ContenidoPaginationQueryDto } from './dto/contenido-pagination-query.dto.js';
import { buildSearchPatterns } from '../auth/search.utils.js';
import { rm, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_DIR } from './media-storage.js';
import { UpdateContenidoDto } from './dto/update-contenido.dto.js';

export type MediaCommand =
  | 'media.play'
  | 'media.pause'
  | 'media.stop'
  | 'media.volume'
  | 'media.volumen'
  | 'media.repeat'
  | 'media.show'
  | 'media.hide';
@Injectable()
export class ContenidosService {
  constructor(
    @InjectRepository(Contenido) private readonly repo: Repository<Contenido>,
    private readonly dataSource: DataSource,
  ) {}
  async registerDownloaded(
    id: string,
    tvId: string,
    url: string,
    file: MediaFile,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const estado = await manager.findOneBy(EstadoTv, { tv_id: tvId });
      const tipo = file.mimetype.toLowerCase().startsWith('video/')
        ? TipoContenido.VIDEO
        : TipoContenido.IMAGEN;
      const contenido = await manager.save(Contenido, {
        id: estado?.contenido_id ?? id,
        nombre: file.originalname.slice(0, 150),
        tipo,
        url,
        tamano_bytes: String(file.size),
      });
      await manager.save(EstadoTv, {
        ...estado,
        tv_id: tvId,
        contenido_id: contenido.id,
        posicion_segundos: 0,
        estado_reproduccion:
          tipo === TipoContenido.VIDEO
            ? EstadoReproduccion.STOPPED
            : EstadoReproduccion.PLAYING,
      });
      return contenido;
    });
  }

  async playOnTv(tvId: string, contenidoId: string): Promise<EstadoTv> {
    return this.applyMediaCommand(tvId, 'media.play', contenidoId);
  }

  async applyMediaCommand(
    tvId: string,
    command: MediaCommand,
    contenidoId?: string,
    volumen?: number,
    repetir?: boolean,
  ): Promise<EstadoTv> {
    return this.dataSource.transaction(async (manager) => {
      const estado = await manager.findOneBy(EstadoTv, { tv_id: tvId });
      let contenido: Contenido | null = null;

      if (
        command === 'media.play' ||
        command === 'media.show' ||
        command === 'media.repeat'
      ) {
        if (!contenidoId)
          throw new BadRequestException('contenido_id es obligatorio');
        contenido = await manager.findOneBy(Contenido, {
          id: contenidoId,
          deleted: false,
        });
        if (!contenido)
          throw new NotFoundException(`Contenido ${contenidoId} no encontrado`);
        if (command === 'media.show' && contenido.tipo !== TipoContenido.IMAGEN)
          throw new BadRequestException(
            'media.show solo admite contenidos de tipo IMAGEN',
          );
      }

      if (
        (command === 'media.pause' ||
          command === 'media.stop' ||
          command === 'media.volume' ||
          command === 'media.volumen' ||
          command === 'media.hide' ||
          command === 'media.repeat') &&
        !estado
      ) {
        throw new NotFoundException(
          `La TV ${tvId} no tiene un estado de reproducción`,
        );
      }

      if (
        (command === 'media.volume' || command === 'media.volumen') &&
        (!Number.isInteger(volumen) || volumen! < 0 || volumen! > 100)
      )
        throw new BadRequestException('volumen debe estar entre 0 y 100');
      if (command === 'media.repeat' && typeof repetir !== 'boolean')
        throw new BadRequestException('repetir debe ser true o false');

      await manager.save(EstadoTv, {
        ...estado,
        tv_id: tvId,
        ...(contenido && { contenido_id: contenido.id }),
        ...((command === 'media.play' || command === 'media.show') && {
          estado_reproduccion: EstadoReproduccion.PLAYING,
          posicion_segundos: 0,
        }),
        ...(command === 'media.pause' && {
          estado_reproduccion: EstadoReproduccion.PAUSED,
        }),
        ...(command === 'media.stop' && {
          estado_reproduccion: EstadoReproduccion.STOPPED,
          posicion_segundos: 0,
        }),
        ...(command === 'media.hide' && {
          estado_reproduccion: EstadoReproduccion.STOPPED,
          posicion_segundos: 0,
        }),
        ...((command === 'media.volume' || command === 'media.volumen') && {
          volumen,
        }),
        ...(command === 'media.repeat' && { repetir }),
      });

      const updated = await manager.findOne(EstadoTv, {
        where: { tv_id: tvId },
        relations: { contenido: true },
      });
      if (!updated)
        throw new NotFoundException(`Estado de TV ${tvId} no encontrado`);
      return updated;
    });
  }
  create(dto: CreateContenidoDto) {
    return this.repo.save(this.repo.create(dto));
  }
  async upload(files: (MediaFile & { filename: string })[]) {
    if (!files?.length) throw new BadRequestException('files es obligatorio');
    const moved: string[] = [];
    try {
      if (
        files.length > 6 ||
        files.some(
          (file) =>
            !file.size ||
            file.size > 100 * 1024 * 1024 ||
            !/^(image|video)\/[a-z0-9.+-]+$/i.test(file.mimetype),
        )
      )
        throw new BadRequestException(
          'M�ximo 6 im�genes o videos, no vac�os, de hasta 100 MB cada uno',
        );
      return await this.dataSource.transaction(async (manager) => {
        // Serializa el cupo entre solicitudes e instancias del backend.
        await manager.query('SELECT pg_advisory_xact_lock($1)', [7462106]);
        const now = new Date();
        const stored = await readdir(CONTENT_DIR, { withFileTypes: true });
        const used = stored.filter((entry) => entry.isFile()).length;
        if (used + files.length > 6)
          throw new BadRequestException(
            `Solo puedes almacenar 6 archivos. Elimina uno o m�s antes de volver a subir. Espacios disponibles: ${Math.max(0, 6 - used)}.`,
          );
        const result: Contenido[] = [];
        for (const file of files) {
          const target = join(CONTENT_DIR, file.filename);
          await rename(file.path, target);
          moved.push(target);
          const item = manager.create(Contenido, {
            nombre: file.originalname.slice(0, 150),
            tipo: file.mimetype.toLowerCase().startsWith('video/')
              ? TipoContenido.VIDEO
              : TipoContenido.IMAGEN,
            tamano_bytes: String(file.size),
            archivo: file.filename,
            subido_at: now,
            url: '',
          });
          const saved = await manager.save(Contenido, item);
          saved.url = `/contenidos/${saved.id}/archivo`;
          result.push(await manager.save(Contenido, saved));
        }
        return result.map(({ archivo: _archivo, ...item }) => item);
      });
    } catch (error) {
      await Promise.all(
        [...files.map((file) => file.path), ...moved].map((path) =>
          rm(path, { force: true }),
        ),
      );
      throw error;
    }
  }
  async findAll(
    {
      page,
      limit,
      search,
      type,
    }: ContenidoPaginationQueryDto = new ContenidoPaginationQueryDto(),
  ) {
    const query = this.repo
      .createQueryBuilder('contenido')
      .where('contenido.deleted = false')
      .orderBy('contenido.nombre', 'ASC')
      .addOrderBy('contenido.id', 'ASC');
    if (type) query.andWhere('contenido.tipo = :type', { type });
    if (search) {
      const patterns = buildSearchPatterns(search);
      query.andWhere(
        new Brackets((where) => {
          where
            .where('contenido.nombre ILIKE :search', patterns)
            .orWhere('contenido.nombre ILIKE :similarSearch', patterns)
            .orWhere('contenido.tipo ILIKE :search', patterns)
            .orWhere('contenido.tipo ILIKE :similarSearch', patterns);
        }),
      );
    }
    const [data, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data, total };
  }
  async getFile(id: string) {
    const item = await this.repo
      .createQueryBuilder('contenido')
      .addSelect('contenido.archivo')
      .where('contenido.id = :id', { id })
      .andWhere('contenido.deleted = false')
      .getOne();
    if (!item?.archivo) throw new NotFoundException('Archivo no encontrado');
    const path = join(CONTENT_DIR, item.archivo);
    try {
      const file = await stat(path);
      if (!file.isFile())
        throw new NotFoundException(
          'El archivo ya no está disponible. Vuelve a subirlo en Contenido.',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException(
          'El archivo ya no está disponible. Vuelve a subirlo en Contenido.',
        );
      throw error;
    }
    return { path, nombre: item.nombre };
  }
  async findOne(id: string) {
    const item = await this.repo.findOneBy({ id, deleted: false });
    if (!item) throw new NotFoundException(`Contenido ${id} no encontrado`);
    return item;
  }
  async update(id: string, dto: UpdateContenidoDto) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    if (!item) throw new NotFoundException(`Contenido ${id} no encontrado`);
    return this.repo.save(item);
  }
  async remove(id: string) {
    const item = await this.repo.findOne({
      where: { id },
      select: { id: true, archivo: true, deleted: true },
    });
    if (!item) throw new NotFoundException(`Contenido ${id} no encontrado`);
    if (item.archivo)
      await rm(join(CONTENT_DIR, item.archivo), { force: true });
    item.deleted = true;
    await this.repo.save(item);
    return { id, deleted: true };
  }
}
