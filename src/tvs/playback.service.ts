import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { ContenidosService } from '../contenidos/contenidos.service.js';
import { PlaylistsService } from '../playlists/playlists.service.js';
import { Tv } from './entities/tv.entity.js';
import {
  EstadoTv,
  EstadoReproduccion,
} from '../estados-tv/entities/estado-tv.entity.js';

export const PLAYBACK_COMMANDS = [
  'media.play',
  'media.show',
  'media.pause',
  'media.stop',
  'media.hide',
  'media.volume',
  'media.volumen',
  'media.repeat',
  'media.shuffle',
] as const;
export type PlaybackCommand = (typeof PLAYBACK_COMMANDS)[number];
export interface PlaybackData {
  tv_id: string;
  request_id?: string;
  auto_reproducir?: boolean;
  contenido_id?: string;
  playlist_id?: string;
  contenido_actual_id?: string;
  tipo?: 'VIDEO' | 'IMAGEN';
  volumen?: number;
  repetir?: boolean;
  aleatorio?: boolean;
}

@Injectable()
export class PlaybackService {
  private readonly secret: string;
  constructor(
    private readonly contenidos: ContenidosService,
    private readonly playlists: PlaylistsService,
    @InjectRepository(EstadoTv) private readonly states: Repository<EstadoTv>,
    config: ConfigService,
  ) {
    this.secret =
      config.get<string>('JWT_SECRET') ?? randomBytes(32).toString('hex');
  }

  validate(
    command: PlaybackCommand,
    raw: Record<string, unknown>,
  ): PlaybackData {
    const {
      tv_id,
      request_id,
      contenido_id,
      playlist_id,
      tipo,
      repetir,
      aleatorio,
    } = raw;
    const volumen = raw.volumen ?? raw.volume;
    if (typeof tv_id !== 'string' || !tv_id.trim())
      throw new BadRequestException('tv_id es obligatorio');
    if (
      request_id !== undefined &&
      (typeof request_id !== 'string' || !isUUID(request_id))
    )
      throw new BadRequestException('request_id debe ser un UUID');
    if (contenido_id !== undefined && playlist_id !== undefined)
      throw new BadRequestException(
        'Envía playlist_id o contenido_id, nunca ambos',
      );
    for (const id of [contenido_id, playlist_id])
      if (id !== undefined && (typeof id !== 'string' || !isUUID(id)))
        throw new BadRequestException(
          'Los IDs de contenido y playlist deben ser UUID',
        );
    if (command === 'media.show' && !contenido_id && !playlist_id)
      throw new BadRequestException(
        'contenido_id o playlist_id es obligatorio',
      );
    if (command === 'media.show' && playlist_id)
      throw new BadRequestException(
        'media.show requiere una imagen individual',
      );
    if (tipo !== undefined && tipo !== 'VIDEO' && tipo !== 'IMAGEN')
      throw new BadRequestException('tipo debe ser VIDEO o IMAGEN');
    if (command === 'media.repeat' && typeof repetir !== 'boolean')
      throw new BadRequestException('repetir debe ser true o false');
    if (command === 'media.shuffle' && typeof aleatorio !== 'boolean')
      throw new BadRequestException('aleatorio debe ser true o false');
    if (
      (command === 'media.volume' || command === 'media.volumen') &&
      (!Number.isInteger(volumen) ||
        (volumen as number) < 0 ||
        (volumen as number) > 100)
    )
      throw new BadRequestException('volumen debe ser un entero entre 0 y 100');
    if (
      raw.contenido_actual_id !== undefined &&
      (typeof raw.contenido_actual_id !== 'string' ||
        !isUUID(raw.contenido_actual_id))
    )
      throw new BadRequestException('contenido_actual_id inválido');
    if (
      raw.auto_reproducir !== undefined &&
      typeof raw.auto_reproducir !== 'boolean'
    )
      throw new BadRequestException('auto_reproducir debe ser booleano');
    return {
      tv_id,
      ...((command === 'media.play' || command === 'media.show') &&
      (contenido_id || playlist_id)
        ? { auto_reproducir: raw.auto_reproducir === true }
        : {}),
      ...(typeof raw.contenido_actual_id === 'string' && {
        contenido_actual_id: raw.contenido_actual_id,
      }),
      ...(typeof request_id === 'string' && { request_id }),
      ...(typeof contenido_id === 'string' && { contenido_id }),
      ...(typeof playlist_id === 'string' && { playlist_id }),
      ...(tipo !== undefined && { tipo }),
      ...((command === 'media.volume' || command === 'media.volumen') && {
        volumen: volumen as number,
      }),
      ...(command === 'media.repeat' && { repetir: repetir as boolean }),
      ...(command === 'media.shuffle' && { aleatorio: aleatorio as boolean }),
    };
  }

  async prepare(command: PlaybackCommand, data: PlaybackData, tvId?: string) {
    if (command !== 'media.play' && command !== 'media.show') return data;
    const state = tvId ? await this.states.findOneBy({ tv_id: tvId }) : null;
    if (!data.contenido_id && !data.playlist_id) {
      if (!state?.contenido_id && !state?.playlist_id)
        throw new BadRequestException(
          'La TV no tiene reproducción para reanudar',
        );
      return data;
    }
    const options = {
      repetir: state?.repetir ?? false,
      aleatorio: state?.aleatorio ?? false,
    };
    if (data.playlist_id) {
      const playlist = await this.playlists.findOne(data.playlist_id);
      if (!playlist.items.length)
        throw new BadRequestException('La playlist está vacía');
      const items = await Promise.all(
        playlist.items.map(async (item) => ({
          id: item.id,
          contenido_id: item.contenido_id,
          orden: item.orden,
          // El reproductor detecta la duración del video; las imágenes usan su tiempo guardado.
          duracion_segundos:
            item.contenido.tipo === 'IMAGEN'
              ? (item.duracion_segundos ?? 10)
              : null,
          contenido: await this.resolveContent(item.contenido_id, data.tv_id),
        })),
      );
      return {
        ...data,
        ...options,
        playlist: { id: playlist.id, nombre: playlist.nombre, items },
      };
    }
    const contenido = await this.resolveContent(data.contenido_id!, data.tv_id);
    if (
      (command === 'media.show' && contenido.tipo !== 'IMAGEN') ||
      (data.tipo && data.tipo !== contenido.tipo)
    )
      throw new BadRequestException(
        'El tipo no corresponde al contenido seleccionado',
      );
    return { ...data, ...options, tipo: contenido.tipo, contenido };
  }

  private async resolveContent(id: string, tvId: string) {
    const content = await this.contenidos.findOne(id);
    if (content.url === `/contenidos/${id}/archivo`) {
      await this.contenidos.getFile(id);
      const expires = Date.now() + 24 * 60 * 60 * 1000;
      const token = this.signature(tvId, id, expires);
      return {
        ...content,
        url: `/tvs/${encodeURIComponent(tvId)}/reproduccion/${id}/archivo?expires=${expires}&token=${token}`,
      };
    }
    return content;
  }

  private signature(tvId: string, id: string, expires: number) {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([tvId, id, expires]))
      .digest('hex');
  }

  async getFile(tvId: string, id: string, expiresRaw: unknown, token: unknown) {
    const expires = typeof expiresRaw === 'string' ? Number(expiresRaw) : NaN;
    if (
      !Number.isSafeInteger(expires) ||
      expires <= Date.now() ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token)
    )
      throw new NotFoundException('Enlace de reproducción inválido o expirado');
    if (
      !timingSafeEqual(
        Buffer.from(token, 'hex'),
        Buffer.from(this.signature(tvId, id, expires), 'hex'),
      )
    )
      throw new NotFoundException('Enlace de reproducción inválido o expirado');
    return this.contenidos.getFile(id);
  }

  async playlistName(id: string) {
    return (await this.playlists.findOne(id).catch(() => null))?.nombre;
  }

  async confirm(tvId: string, command: PlaybackCommand, data: PlaybackData) {
    return this.states.manager.transaction(async (manager) => {
      const tv = await manager.findOne(Tv, {
        where: { id: tvId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tv) throw new NotFoundException('TV no encontrada');
      const repository = manager.getRepository(EstadoTv);
      const previous = await repository.findOneBy({ tv_id: tvId });
      const state = repository.create(previous ?? { tv_id: tvId });
      if (command === 'media.play' || command === 'media.show') {
        if (data.playlist_id || data.contenido_id) {
          state.playlist_id = data.playlist_id ?? null;
          state.contenido_id = data.contenido_id ?? null;
          state.posicion_segundos = 0;
        }
        state.estado_reproduccion =
          data.auto_reproducir === false
            ? EstadoReproduccion.STOPPED
            : EstadoReproduccion.PLAYING;
      }
      if (command === 'media.stop' || command === 'media.hide') {
        state.estado_reproduccion = EstadoReproduccion.STOPPED;
        state.posicion_segundos = 0;
      }
      if (command === 'media.pause')
        state.estado_reproduccion = EstadoReproduccion.PAUSED;
      if (data.volumen !== undefined) state.volumen = data.volumen;
      if (data.repetir !== undefined) state.repetir = data.repetir;
      if (data.aleatorio !== undefined) state.aleatorio = data.aleatorio;
      if (data.contenido_actual_id) {
        if (state.playlist_id) {
          const playlist = await this.playlists.findOne(state.playlist_id);
          if (
            !playlist.items.some(
              (item) => item.contenido_id === data.contenido_actual_id,
            )
          )
            throw new BadRequestException(
              'El contenido no pertenece a la playlist activa',
            );
        } else if (state.contenido_id !== data.contenido_actual_id)
          throw new BadRequestException(
            'El contenido no corresponde a la reproducción activa',
          );
        state.contenido_id = data.contenido_actual_id;
      }
      const playlist = state.playlist_id
        ? await this.playlists.findOne(state.playlist_id).catch(() => null)
        : null;
      const contenido = state.contenido_id
        ? await this.contenidos.findOne(state.contenido_id).catch(() => null)
        : null;
      await repository.save(state);
      return {
        ...data,
        ...(playlist ? { playlist_nombre: playlist.nombre } : {}),
        ...(contenido
          ? {
              contenido_actual: {
                id: contenido.id,
                nombre: contenido.nombre,
                tipo: contenido.tipo,
              },
            }
          : {}),
        ...(state.playlist_id
          ? { playlist_id: state.playlist_id }
          : state.contenido_id
            ? { contenido_id: state.contenido_id }
            : {}),
        estado_reproduccion: state.estado_reproduccion,
        volumen: state.volumen,
        repetir: state.repetir,
        aleatorio: state.aleatorio,
      };
    });
  }
}
