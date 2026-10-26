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
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
@Controller('salas')
export class SalasController {
  constructor(private readonly service: SalasService) {}
  @Post() @RequirePermissions('tvs.edit') create(@Body() dto: CreateSalaDto) {
    return this.service.create(dto);
  }
  @Get() @RequirePermissions('tvs.view') findAll() {
    return this.service.findAll();
  }
  @Get(':id') @RequirePermissions('tvs.view') findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(id);
  }
  @Patch(':id') @RequirePermissions('tvs.edit') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalaDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @RequirePermissions('tvs.edit') remove(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(id);
  }
}
