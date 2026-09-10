import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EstadoConexionTv, Tv } from './entities/tv.entity.js';
import { CreateTvDto } from './dto/create-tv.dto.js';
import { UpdateTvDto } from './dto/update-tv.dto.js';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { randomBytes } from 'node:crypto';
import { RegisterTvDto } from './dto/register-tv.dto.js';
import { Sala } from '../salas/entities/sala.entity.js';
@Injectable()
export class TvsService {
  private readonly temporaryTvIds = new Set<string>();

  constructor(
    @InjectRepository(Tv) private readonly repo: Repository<Tv>,
    private readonly dataSource: DataSource,
  ) {}
  create(dto: CreateTvDto) {
    return this.repo.save(
      this.repo.create({
        ...dto,
        ultimo_contacto: dto.ultimo_contacto
          ? new Date(dto.ultimo_contacto)
          : null,
      }),
    );
  }

  async connect(dto: ConnectTvDto): Promise<{ tvId: string }> {
    void dto;

    let tvId: string;
    do {
      const value = randomBytes(6).toString('hex').toUpperCase();
      tvId = `TV-${value.slice(0, 8)}-${value.slice(8, 11)}`;
    } while (
      this.temporaryTvIds.has(tvId) ||
      (await this.repo.existsBy({ tv_id: tvId }))
    );

    this.temporaryTvIds.add(tvId);

    return { tvId };
  }

  releaseTemporaryTvId(tvId: string): void {
    this.temporaryTvIds.delete(tvId);
  }

  async updateConnectionStatus(
    tvId: string,
    status: EstadoConexionTv,
  ): Promise<void> {
    await this.repo.update(
      { tv_id: tvId },
      { estado_conexion: status, ultimo_contacto: new Date() },
    );
  }

  async markAllDisconnected(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(Tv)
      .set({ estado_conexion: EstadoConexionTv.DESCONECTADO })
      .execute();
  }

  async register(dto: RegisterTvDto): Promise<Tv> {
    if (!this.temporaryTvIds.has(dto.tv_id)) {
      throw new BadRequestException(
        'El tv_id no es temporal, expiró o el dispositivo se desconectó',
      );
    }

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

    this.temporaryTvIds.delete(dto.tv_id);
    return this.findOne(tv.tv_id);
  }
  findAll() {
    return this.repo.find({
      relations: {
        sala: true,
        estado: { contenido: true },
      },
    });
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
    const data = {
      ...dto,
      ultimo_contacto: dto.ultimo_contacto
        ? new Date(dto.ultimo_contacto)
        : undefined,
    };
    const item = await this.repo.preload({ id, ...data });
    if (!item) throw new NotFoundException(`TV ${id} no encontrada`);
    return this.repo.save(item);
  }
  async remove(id: string) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
