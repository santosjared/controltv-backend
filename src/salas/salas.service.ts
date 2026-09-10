import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sala } from './entities/sala.entity.js';
import { CreateSalaDto } from './dto/create-sala.dto.js';
import { UpdateSalaDto } from './dto/update-sala.dto.js';
@Injectable()
export class SalasService {
  constructor(
    @InjectRepository(Sala) private readonly repo: Repository<Sala>,
  ) {}
  create(dto: CreateSalaDto) {
    return this.repo.save(this.repo.create(dto));
  }
  findAll() {
    return this.repo.find({ relations: { tvs: true } });
  }
  async findOne(id: string) {
    const item = await this.repo.findOne({
      where: { id },
      relations: { tvs: true },
    });
    if (!item) throw new NotFoundException(`Sala ${id} no encontrada`);
    return item;
  }
  async update(id: string, dto: UpdateSalaDto) {
    const item = await this.repo.preload({ id, ...dto });
    if (!item) throw new NotFoundException(`Sala ${id} no encontrada`);
    return this.repo.save(item);
  }
  async remove(id: string) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
