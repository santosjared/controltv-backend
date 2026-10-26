import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { EstadoConexionTv, Tv } from './entities/tv.entity.js';
import { CreateTvDto } from './dto/create-tv.dto.js';
import { UpdateTvDto } from './dto/update-tv.dto.js';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { randomBytes } from 'node:crypto';
import { RegisterTvDto } from './dto/register-tv.dto.js';
import { Sala } from '../salas/entities/sala.entity.js';
import { EstadoTv, EstadoReproduccion } from '../estados-tv/entities/estado-tv.entity.js';
import { TvPaginationQueryDto } from './dto/tv-pagination-query.dto.js';
import { buildSearchPatterns } from '../auth/search.utils.js';
@Injectable()
export class TvsService {
  private readonly temporaryTvs = new Map<string, ConnectTvDto>();

  constructor(
    @InjectRepository(Tv) private readonly repo: Repository<Tv>,
    private readonly dataSource: DataSource,
  ) {}
  create(dto: CreateTvDto) {
    return this.register(dto);
  }

  async connect(dto: ConnectTvDto): Promise<{ tvId: string }> {
    void dto;

    let tvId: string;
    do {
      const value = randomBytes(6).toString('hex').toUpperCase();
      tvId = `TV-${value.slice(0, 8)}-${value.slice(8, 11)}`;
    } while (
      this.temporaryTvs.has(tvId) ||
      (await this.repo.existsBy({ tv_id: tvId }))
    );

    this.temporaryTvs.set(tvId, dto);

    return { tvId };
  }

  releaseTemporaryTvId(tvId: string): void {
    this.temporaryTvs.delete(tvId);
  }

  async updateConnectionStatus(
    tvId: string,
    status: EstadoConexionTv,
  ): Promise<void> {
    if (status === EstadoConexionTv.DESCONECTADO) {
      const tv = await this.repo.findOneBy({ tv_id: tvId });
      if (tv)
        await this.dataSource
          .getRepository(EstadoTv)
          .update(
            { tv_id: tv.id },
            {
              estado_reproduccion: EstadoReproduccion.STOPPED,
              posicion_segundos: 0,
            },
          );
    }
    await this.repo.update(
      { tv_id: tvId },
      { estado_conexion: status, ultimo_contacto: new Date() },
    );
  }

  async markAllDisconnected(): Promise<void> {
    await this.dataSource
      .getRepository(EstadoTv)
      .createQueryBuilder()
      .update()
      .set({ estado_reproduccion: EstadoReproduccion.STOPPED, posicion_segundos: 0 })
      .execute();
    await this.repo
      .createQueryBuilder()
      .update(Tv)
      .set({ estado_conexion: EstadoConexionTv.DESCONECTADO })
      .execute();
  }

  async register(dto: RegisterTvDto): Promise<Tv> {
    const pending = this.temporaryTvs.get(dto.tv_id);
    if (!pending) {
      throw new BadRequestException(
        `La TV ${dto.tv_id} no está pendiente de registro, expiró o se desconectó`,
      );
    }
    if (
      pending.ip !== dto.ip ||
      pending.model !== dto.model ||
      pending.version_android !== dto.version_android
    )
      throw new BadRequestException(
        'IP, modelo o versión Android no coinciden con el dispositivo pendiente',
      );

    const tv = await this.dataSource.transaction(async (manager) => {
      const tvRepository = manager.getRepository(Tv);
      const salaRepository = manager.getRepository(Sala);

      if (await tvRepository.existsBy({ tv_id: dto.tv_id })) {
        throw new ConflictException(`El tv_id ${dto.tv_id} ya está registrado`);
      }

      let sala = await salaRepository.findOneBy({
        nombre: dto.sala,
        ubicacion: dto.ubicacion,
      });

      if (!sala) {
        sala = await salaRepository.save(
          salaRepository.create({
            nombre: dto.sala,
            ubicacion: dto.ubicacion,
          }),
        );
      }

      return tvRepository.save(
        tvRepository.create({
          tv_id: dto.tv_id,
          sala_id: sala.id,
          nombre: dto.nombre ?? dto.model,
          model: dto.model,
          version_android: dto.version_android,
          ip: dto.ip,
          ultimo_contacto: new Date(),
        }),
      );
    });

    this.temporaryTvs.delete(dto.tv_id);
    return this.findOne(tv.tv_id);
  }

  findAll(): Promise<Tv[]>;
  findAll(query: TvPaginationQueryDto): Promise<{ data: Tv[]; total: number }>;
  async findAll(query?: TvPaginationQueryDto) {
    const builder = this.repo
      .createQueryBuilder('tv')
      .leftJoinAndSelect('tv.sala', 'sala')
      .leftJoinAndSelect('tv.estado', 'estado')
      .leftJoinAndSelect('estado.contenido', 'contenido')
      .orderBy('tv.nombre', 'ASC');

    if (!query) return builder.getMany();

    if (query.search) {
      const patterns = buildSearchPatterns(query.search);
      builder.andWhere(
        new Brackets((where) => {
          where
            .where('tv.tv_id ILIKE :search', patterns)
            .orWhere('tv.tv_id ILIKE :similarSearch', patterns)
            .orWhere('tv.nombre ILIKE :search', patterns)
            .orWhere('tv.nombre ILIKE :similarSearch', patterns)
            .orWhere('tv.model ILIKE :search', patterns)
            .orWhere('tv.model ILIKE :similarSearch', patterns)
            .orWhere('tv.version_android ILIKE :search', patterns)
            .orWhere('tv.ip ILIKE :search', patterns)
            .orWhere('sala.nombre ILIKE :search', patterns)
            .orWhere('sala.nombre ILIKE :similarSearch', patterns)
            .orWhere('sala.ubicacion ILIKE :search', patterns)
            .orWhere('sala.ubicacion ILIKE :similarSearch', patterns)
            .orWhere('tv.estado_conexion ILIKE :search', patterns);
        }),
      );
    }

    const [data, total] = await builder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { data, total };
  }

  async findOne(id: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );
    const item = await this.repo.findOne({
      where: isUuid ? { id } : { tv_id: id },
      relations: {
        sala: true,
        estado: { contenido: true },
      },
    });
    if (!item) throw new NotFoundException(`TV ${id} no encontrada`);
    return item;
  }
  async update(id: string, dto: UpdateTvDto) {
    const item = await this.findOne(id);
    if (dto.tv_id !== item.tv_id)
      throw new BadRequestException(
        `El tv_id del cuerpo debe corresponder a la TV ${item.tv_id}`,
      );

    const updated = await this.dataSource.transaction(async (manager) => {
      const tvRepository = manager.getRepository(Tv);
      const salaRepository = manager.getRepository(Sala);
      const sala = await salaRepository.findOneBy({ id: dto.sala_id });
      if (!sala)
        throw new NotFoundException(`Sala ${dto.sala_id} no encontrada`);

      await salaRepository.save({
        ...sala,
        nombre: dto.sala,
        ubicacion: dto.ubicacion,
      });
      return tvRepository.save({
        ...item,
        nombre: dto.nombre,
        sala_id: dto.sala_id,
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.version_android !== undefined && {
          version_android: dto.version_android,
        }),
        ...(dto.ip !== undefined && { ip: dto.ip }),
      });
    });
    return this.findOne(updated.id);
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    await this.dataSource.transaction(async (manager) => {
      // Refuerzo a nivel de aplicación además del ON DELETE CASCADE de la FK.
      await manager.delete(EstadoTv, { tv_id: item.id });
      const result = await manager.delete(Tv, { id: item.id });
      if (!result.affected)
        throw new NotFoundException(`TV ${id} no encontrada`);
    });
    this.temporaryTvs.delete(item.tv_id);
    return { id: item.id, tv_id: item.tv_id, deleted: true };
  }
}
