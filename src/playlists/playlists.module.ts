import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Playlist } from './entities/playlist.entity.js';
import { PlaylistItem } from './entities/playlist-item.entity.js';
import { Contenido } from '../contenidos/entities/contenido.entity.js';
import { PlaylistsService } from './playlists.service.js';
import { PlaylistsController } from './playlists.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Playlist, PlaylistItem, Contenido])],
  providers: [PlaylistsService],
  controllers: [PlaylistsController],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
