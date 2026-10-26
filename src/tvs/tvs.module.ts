import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tv } from './entities/tv.entity.js';
import { TvsController } from './tvs.controller.js';
import { TvsService } from './tvs.service.js';
import { TvsGateway } from './tvs.gateway.js';
import { TransfersService } from './transfers.service.js';
import { TransfersController } from './transfers.controller.js';
import { ContenidosModule } from '../contenidos/contenidos.module.js';
import { PlaylistsModule } from '../playlists/playlists.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EstadoTv } from '../estados-tv/entities/estado-tv.entity.js';
import { PlaybackService } from './playback.service.js';
import { PlaybackController } from './playback.controller.js';
@Module({
  imports: [
    TypeOrmModule.forFeature([Tv, EstadoTv]),
    ContenidosModule,
    PlaylistsModule,
    AuthModule,
  ],
  controllers: [TvsController, TransfersController, PlaybackController],
  providers: [TvsService, TvsGateway, TransfersService, PlaybackService],
})
export class TvsModule {}
