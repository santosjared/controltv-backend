import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Contenido, TipoContenido } from './entities/contenido.entity.js';
import {
  EstadoTv,
  EstadoReproduccion,
} from '../estados-tv/entities/estado-tv.entity.js';
import type { MediaFile } from '../tvs/transfers.service.js';
import { CreateContenidoDto } from './dto/create-contenido.dto.js';
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
        contenido = await manager.findOneBy(Contenido, { id: contenidoId });
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
  findAll() {
    return this.repo.find();
  }
  async findOne(id: string) {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`Contenido ${id} no encontrado`);
    return item;
  }
  async update(id: string, dto: UpdateContenidoDto) {
    const item = await this.repo.preload({ id, ...dto });
    if (!item) throw new NotFoundException(`Contenido ${id} no encontrado`);
    return this.repo.save(item);
  }
  async remove(id: string) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
