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
import { SalasService } from './salas.service.js';
import { CreateSalaDto } from './dto/create-sala.dto.js';
import { UpdateSalaDto } from './dto/update-sala.dto.js';
@Controller('salas')
export class SalasController {
  constructor(private readonly service: SalasService) {}
  @Post() create(@Body() dto: CreateSalaDto) {
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
    @Body() dto: UpdateSalaDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
