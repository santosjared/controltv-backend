import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, In, Repository } from 'typeorm';
import { Playlist } from './entities/playlist.entity.js';
import { PlaylistItem } from './entities/playlist-item.entity.js';
import {
  Contenido,
  TipoContenido,
} from '../contenidos/entities/contenido.entity.js';
import { CreatePlaylistDto } from './dto/create-playlist.dto.js';
import { UpdatePlaylistDto } from './dto/update-playlist.dto.js';
import { PlaylistItemDto } from './dto/playlist-item.dto.js';
import { PaginationQueryDto } from '../auth/dto/pagination-query.dto.js';
import { buildSearchPatterns } from '../auth/search.utils.js';

@Injectable()
export class PlaylistsService {
  constructor(
    @InjectRepository(Playlist)
    private readonly playlists: Repository<Playlist>,
    @InjectRepository(PlaylistItem)
    private readonly items: Repository<PlaylistItem>,
    @InjectRepository(Contenido)
    private readonly contenidos: Repository<Contenido>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreatePlaylistDto) {
    const id = await this.dataSource.transaction(async (manager) => {
      const playlist = await manager.save(
        Playlist,
        manager.create(Playlist, {
          nombre: dto.nombre,
          descripcion: dto.descripcion ?? null,
        }),
      );
      if (dto.items && dto.imagenes)
        throw new BadRequestException('Envía items o imagenes, no ambos');
      const entries = dto.items ?? dto.imagenes ?? [];
      const orders = entries.map((item, index) => item.orden ?? index);
      if (new Set(orders).size !== orders.length)
        throw new BadRequestException(
          'El orden de los elementos no puede repetirse',
        );
      for (const [index, image] of entries.entries()) {
        const contenido = await this.requireImage(image.contenido_id, manager);
        await manager.save(PlaylistItem, {
          playlist_id: playlist.id,
          contenido_id: contenido.id,
          orden: image.orden ?? index,
          duracion_segundos: this.itemDuration(
            contenido,
            image.duracion_segundos,
          ),
        });
      }
      return playlist.id;
    });
    return this.findOne(id);
  }

  async findAll(
    { page, limit, search }: PaginationQueryDto = new PaginationQueryDto(),
  ) {
    const patterns = search ? buildSearchPatterns(search) : undefined;
    const [data, total] = await this.playlists.findAndCount({
      where: patterns
        ? [
            { nombre: ILike(patterns.search) },
            { nombre: ILike(patterns.similarSearch) },
            { descripcion: ILike(patterns.search) },
            { descripcion: ILike(patterns.similarSearch) },
          ]
        : undefined,
      order: { created_at: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    // Paginate parent rows before joining items: item order must never consume playlist slots.
    const loaded = data.length
      ? await this.playlists.find({
          where: { id: In(data.map((item) => item.id)) },
          relations: { items: true },
        })
      : [];
    const byId = new Map(loaded.map((item) => [item.id, item]));
    return {
      data: data.map((item) =>
        this.present(byId.get(item.id) ?? { ...item, items: [] }),
      ),
      total,
    };
  }

  async findOne(id: string) {
    const playlist = await this.playlists.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { orden: 'ASC' } },
    });
    if (!playlist) throw new NotFoundException(`Playlist ${id} no encontrada`);
    return this.present(playlist);
  }

  async update(id: string, dto: UpdatePlaylistDto) {
    const playlist = await this.findOne(id);
    if (dto.nombre !== undefined) playlist.nombre = dto.nombre;
    if (dto.descripcion !== undefined) playlist.descripcion = dto.descripcion;
    await this.playlists.update(id, {
      nombre: playlist.nombre,
      descripcion: playlist.descripcion,
    });
    return this.findOne(id);
  }

  async addImage(id: string, dto: PlaylistItemDto) {
    await this.dataSource.transaction(async (manager) => {
      const playlist = await manager.findOne(Playlist, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!playlist)
        throw new NotFoundException(`Playlist ${id} no encontrada`);
      const contenido = await this.requireImage(dto.contenido_id, manager);
      const repository = manager.getRepository(PlaylistItem);
      const orden =
        dto.orden ??
        ((await repository.maximum('orden', { playlist_id: id })) ?? -1) + 1;
      if (await repository.existsBy({ playlist_id: id, orden }))
        throw new BadRequestException('Ya existe un elemento en ese orden');
      await repository.save(
        repository.create({
          playlist_id: id,
          contenido_id: dto.contenido_id,
          orden,
          duracion_segundos: this.itemDuration(
            contenido,
            dto.duracion_segundos,
          ),
        }),
      );
      await manager.update(Playlist, { id }, { updated_at: new Date() });
    });
    return this.findOne(id);
  }

  async removeImage(id: string, itemId: string) {
    await this.dataSource.transaction(async (manager) => {
      const playlist = await manager.findOne(Playlist, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!playlist)
        throw new NotFoundException(`Playlist ${id} no encontrada`);
      const result = await manager.delete(PlaylistItem, {
        id: itemId,
        playlist_id: id,
      });
      if (!result.affected)
        throw new NotFoundException('Elemento no encontrado en la playlist');
      await manager.update(Playlist, { id }, { updated_at: new Date() });
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    const playlist = await this.findOne(id);
    await this.playlists.remove(playlist);
    return { id, deleted: true };
  }

  async duplicate(id: string) {
    const playlist = await this.findOne(id);
    return this.create({
      nombre: `${playlist.nombre.slice(0, 142)} (copia)`,
      descripcion: playlist.descripcion ?? undefined,
      items: playlist.items.map((item) => ({
        contenido_id: item.contenido_id,
        orden: item.orden,
        duracion_segundos: item.duracion_segundos,
      })),
    });
  }

  async reorder(id: string, itemIds: string[]) {
    await this.dataSource.transaction(async (manager) => {
      const playlist = await manager.findOne(Playlist, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!playlist)
        throw new NotFoundException(`Playlist ${id} no encontrada`);
      const items = await manager.find(PlaylistItem, {
        where: { playlist_id: id },
      });
      if (
        itemIds.length !== items.length ||
        new Set(itemIds).size !== itemIds.length ||
        itemIds.some((itemId) => !items.some((item) => item.id === itemId))
      )
        throw new BadRequestException(
          'Incluye todos los IDs de elementos de la playlist, sin repetir',
        );
      // Dos fases para respetar la restricción única (playlist_id, orden).
      for (const [index, item] of items.entries())
        await manager.update(
          PlaylistItem,
          { id: item.id },
          { orden: -index - 1 },
        );
      for (const [index, itemId] of itemIds.entries())
        await manager.update(PlaylistItem, { id: itemId }, { orden: index });
      await manager.update(Playlist, { id }, { updated_at: new Date() });
    });
    return this.findOne(id);
  }

  private present(playlist: Playlist) {
    playlist.items.sort((a, b) => a.orden - b.orden);
    return Object.assign(playlist, {
      total_elementos: playlist.items.length,
      duracion_total_segundos: playlist.items.reduce(
        (total, item) => total + item.duracion_segundos,
        0,
      ),
    });
  }

  private itemDuration(contenido: Contenido, duration?: number): number {
    if (duration !== undefined) return duration;
    if (contenido.tipo === TipoContenido.IMAGEN) return 10;
    throw new BadRequestException(
      'Debes indicar la duración real del video en duracion_segundos',
    );
  }

  private async requireImage(
    id: string,
    manager: Pick<DataSource['manager'], 'findOneBy'> = this.dataSource.manager,
  ) {
    const contenido = await manager.findOneBy(Contenido, {
      id,
      deleted: false,
    });
    if (!contenido)
      throw new NotFoundException(`Contenido ${id} no encontrado`);
    if (![TipoContenido.IMAGEN, TipoContenido.VIDEO].includes(contenido.tipo))
      throw new BadRequestException(
        'La playlist sólo admite imágenes y videos',
      );
    return contenido;
  }
}
