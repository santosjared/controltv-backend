import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { DEFAULT_PERMISSION_KEYS } from './default-permissions.js';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
  ) {}

  create(dto: CreatePermissionDto) {
    return this.permissions.save(this.permissions.create(dto));
  }

  findAll() {
    return this.permissions.find({
      where: { deleted: false },
      order: { clave: 'ASC' },
    });
  }

  async remove(id: string) {
    const permission = await this.permissions.findOneBy({
      id,
      deleted: false,
    });
    if (!permission) throw new NotFoundException(`Permiso ${id} no encontrado`);
    if (DEFAULT_PERMISSION_KEYS.has(permission.clave))
      throw new ForbiddenException(
        `El permiso base ${permission.clave} no puede eliminarse`,
      );
    permission.deleted = true;
    await this.permissions.save(permission);
    return { id, deleted: true };
  }
}
