import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { RequirePermissions } from './decorators/permissions.decorator.js';

@Controller('permisos')
@RequirePermissions('roles.manage')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}
  @Get() findAll() {
    return this.permissions.findAll();
  }
  @Post() create(@Body() dto: CreatePermissionDto) {
    return this.permissions.create(dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissions.remove(id);
  }
}
