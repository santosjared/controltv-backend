import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { EstadosTvService } from './estados-tv.service.js';
import { CreateEstadoTvDto } from './dto/create-estado-tv.dto.js';
import { UpdateEstadoTvDto } from './dto/update-estado-tv.dto.js';
@Controller('estados-tv')
export class EstadosTvController {
  constructor(private readonly service: EstadosTvService) {}
  @Post() create(@Body() dto: CreateEstadoTvDto) {
    return this.service.create(dto);
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':tvId') findOne(@Param('tvId', ParseUUIDPipe) tvId: string) {
    return this.service.findOne(tvId);
  }
  @Patch(':tvId') update(
    @Param('tvId', ParseUUIDPipe) tvId: string,
    @Body() dto: UpdateEstadoTvDto,
  ) {
    return this.service.update(tvId, dto);
  }
  @Delete(':tvId') remove(@Param('tvId', ParseUUIDPipe) tvId: string) {
    return this.service.remove(tvId);
  }
}
