import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadoTv } from './entities/estado-tv.entity.js';
import { CreateEstadoTvDto } from './dto/create-estado-tv.dto.js';
import { UpdateEstadoTvDto } from './dto/update-estado-tv.dto.js';
@Injectable()
export class EstadosTvService {
  constructor(
    @InjectRepository(EstadoTv) private readonly repo: Repository<EstadoTv>,
  ) {}
  create(dto: CreateEstadoTvDto) {
    return this.repo.save(this.repo.create(dto));
  }
  findAll() {
    return this.repo.find({ relations: { tv: true, contenido: true } });
  }
  async findOne(tv_id: string) {
    const item = await this.repo.findOne({
      where: { tv_id },
      relations: { tv: true, contenido: true },
    });
    if (!item)
      throw new NotFoundException(`Estado de TV ${tv_id} no encontrado`);
    return item;
  }
  async update(tv_id: string, dto: UpdateEstadoTvDto) {
    const { tv_id: ignored, ...changes } = dto;
    void ignored;
    const item = await this.repo.preload({ tv_id, ...changes });
    if (!item)
      throw new NotFoundException(`Estado de TV ${tv_id} no encontrado`);
    return this.repo.save(item);
  }
  async remove(tv_id: string) {
    const item = await this.findOne(tv_id);
    await this.repo.remove(item);
  }
}
