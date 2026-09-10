import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EstadoTv } from './entities/estado-tv.entity.js';
import { EstadosTvController } from './estados-tv.controller.js';
import { EstadosTvService } from './estados-tv.service.js';
@Module({
  imports: [TypeOrmModule.forFeature([EstadoTv])],
  controllers: [EstadosTvController],
  providers: [EstadosTvService],
})
export class EstadosTvModule {}
