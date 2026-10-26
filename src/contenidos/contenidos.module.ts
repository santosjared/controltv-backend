import { ContenidosCleanupService } from './contenidos-cleanup.service.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contenido } from './entities/contenido.entity.js';
import { ContenidosController } from './contenidos.controller.js';
import { ContenidosService } from './contenidos.service.js';
@Module({
  imports: [TypeOrmModule.forFeature([Contenido])],
  controllers: [ContenidosController],
  providers: [ContenidosService, ContenidosCleanupService],
  exports: [ContenidosService],
})
export class ContenidosModule {}
