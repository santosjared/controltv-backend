import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tv } from './entities/tv.entity.js';
import { TvsController } from './tvs.controller.js';
import { TvsService } from './tvs.service.js';
import { TvsGateway } from './tvs.gateway.js';
import { TransfersService } from './transfers.service.js';
import { TransfersController } from './transfers.controller.js';
import { ContenidosModule } from '../contenidos/contenidos.module.js';
@Module({
  imports: [TypeOrmModule.forFeature([Tv]), ContenidosModule],
  controllers: [TvsController, TransfersController],
  providers: [TvsService, TvsGateway, TransfersService],
})
export class TvsModule {}
