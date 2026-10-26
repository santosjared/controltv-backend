import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PlaylistsService } from './playlists.service.js';
import { CreatePlaylistDto } from './dto/create-playlist.dto.js';
import { UpdatePlaylistDto } from './dto/update-playlist.dto.js';
import { PlaylistItemDto } from './dto/playlist-item.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { PaginationQueryDto } from '../auth/dto/pagination-query.dto.js';
import { ReorderPlaylistDto } from './dto/reorder-playlist.dto.js';

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Post() @RequirePermissions('playlists.manage') create(
    @Body() dto: CreatePlaylistDto,
  ) {
    return this.playlists.create(dto);
  }
  @Get() @RequirePermissions('playlists.view') findAll(
    @Query() query: PaginationQueryDto,
  ) {
    return this.playlists.findAll(query);
  }
  @Get(':id') @RequirePermissions('playlists.view') findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.playlists.findOne(id);
  }
  @Put(':id') @RequirePermissions('playlists.manage') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlists.update(id, dto);
  }
  @Post(':id/duplicar') @RequirePermissions('playlists.manage') duplicate(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.playlists.duplicate(id);
  }
  @Put(':id/orden') @RequirePermissions('playlists.manage') reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPlaylistDto,
  ) {
    return this.playlists.reorder(id, dto.item_ids);
  }
  @Post([':id/items', ':id/imagenes'])
  @RequirePermissions('playlists.manage')
  addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlaylistItemDto,
  ) {
    return this.playlists.addImage(id, dto);
  }
  @Delete([':id/items/:itemId', ':id/imagenes/:itemId'])
  @RequirePermissions('playlists.manage')
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.playlists.removeImage(id, itemId);
  }
  @Delete(':id') @RequirePermissions('playlists.manage') remove(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.playlists.remove(id);
  }
}
