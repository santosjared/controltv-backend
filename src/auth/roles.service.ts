import {
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, ILike, Not, Repository } from 'typeorm';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { PaginationQueryDto } from './dto/pagination-query.dto.js';
import { buildSearchPatterns, escapeSearchText } from './search.utils.js';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
  ) {}

  async create(dto: CreateRoleDto) {
    if (
      await this.roles.existsBy({
        nombre: ILike(escapeSearchText(dto.nombre.trim())),
        deleted: false,
      })
    )
      throw new ConflictException('El nombre del rol ya está registrado');
    const permissions = await this.resolvePermissions(dto.permission_ids);
    return this.roles.save(
      this.roles.create({ ...dto, permisos: permissions }),
    );
  }

  options() {
    return this.roles.find({
      where: { deleted: false },
      select: { id: true, nombre: true },
      loadEagerRelations: false,
      order: { nombre: 'ASC' },
    });
  }

  async findAll({ page, limit, search }: PaginationQueryDto) {
    const query = this.roles
      .createQueryBuilder('role')
      .leftJoinAndSelect(
        'role.permisos',
        'permission',
        'permission.deleted = false',
      )
      .where('role.deleted = false')
      .orderBy('role.nombre', 'ASC');

    if (search) {
      const patterns = buildSearchPatterns(search);
      query.andWhere(
        new Brackets((where) => {
          where
            .where('role.nombre ILIKE :search', patterns)
            .orWhere('role.nombre ILIKE :similarSearch', patterns)
            .orWhere('role.descripcion ILIKE :search', patterns)
            .orWhere('role.descripcion ILIKE :similarSearch', patterns);
        }),
      );
    }

    const [data, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total };
  }

  async findOne(id: string) {
    const role = await this.roles
      .createQueryBuilder('role')
      .leftJoinAndSelect(
        'role.permisos',
        'permission',
        'permission.deleted = false',
      )
      .where('role.id = :id', { id })
      .andWhere('role.deleted = false')
      .getOne();
    if (!role) throw new NotFoundException(`Rol ${id} no encontrado`);
    return role;
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.findOne(id);
    if (role.nombre === 'SUPER_ADMIN')
      throw new ForbiddenException('El rol SUPER_ADMIN no puede modificarse');
    if (dto.permission_ids)
      role.permisos = await this.resolvePermissions(dto.permission_ids);
    if (
      dto.nombre !== undefined &&
      (await this.roles.existsBy({
        id: Not(id),
        nombre: ILike(escapeSearchText(dto.nombre.trim())),
        deleted: false,
      }))
    )
      throw new ConflictException('El nombre del rol ya está registrado');
    if (dto.nombre !== undefined) role.nombre = dto.nombre;
    if (dto.descripcion !== undefined) role.descripcion = dto.descripcion;
    return this.roles.save(role);
  }

  async remove(id: string) {
    const role = await this.findOne(id);
    if (role.nombre === 'SUPER_ADMIN')
      throw new ForbiddenException('El rol SUPER_ADMIN no puede eliminarse');
    role.deleted = true;
    await this.roles.save(role);
    return { id, deleted: true };
  }

  private async resolvePermissions(ids: string[]) {
    const permissions = ids.length
      ? await this.permissions
          .createQueryBuilder('permission')
          .where('permission.id IN (:...ids)', { ids })
          .andWhere('permission.deleted = false')
          .getMany()
      : [];
    if (permissions.length !== ids.length)
      throw new NotFoundException('Uno o más permisos no existen');
    return permissions;
  }
}
