import { Injectable, NotFoundException } from '@nestjs/common';
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
