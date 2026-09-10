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
import { ContenidosService } from './contenidos.service.js';
import { CreateContenidoDto } from './dto/create-contenido.dto.js';
import { UpdateContenidoDto } from './dto/update-contenido.dto.js';
@Controller('contenidos')
export class ContenidosController {
  constructor(private readonly service: ContenidosService) {}
  @Post() create(@Body() dto: CreateContenidoDto) {
    return this.service.create(dto);
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContenidoDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
