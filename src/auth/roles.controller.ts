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
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { RequirePermissions } from './decorators/permissions.decorator.js';
import { PaginationQueryDto } from './dto/pagination-query.dto.js';

@Controller('roles')
@RequirePermissions('roles.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get('opciones') @RequirePermissions('users.manage') options() {
    return this.roles.options();
  }
  @Get() findAll(@Query() query: PaginationQueryDto) {
    return this.roles.findAll(query);
  }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(id);
  }
  @Post() create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }
  @Put(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(id);
  }
}
