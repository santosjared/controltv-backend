import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sala } from './entities/sala.entity.js';
import { SalasController } from './salas.controller.js';
import { SalasService } from './salas.service.js';
@Module({
  imports: [TypeOrmModule.forFeature([Sala])],
  controllers: [SalasController],
  providers: [SalasService],
})
export class SalasModule {}
