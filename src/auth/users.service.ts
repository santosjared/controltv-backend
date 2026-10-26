import {
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, ILike, Not, Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { Role } from './entities/role.entity.js';
import { AuthService } from './auth.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { PaginationQueryDto } from './dto/pagination-query.dto.js';
import { EstadoUsuario } from './entities/user.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { buildSearchPatterns, escapeSearchText } from './search.utils.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly auth: AuthService,
  ) {}

  create(dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  async findAll({ page, limit, search }: PaginationQueryDto) {
    const query = this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role', 'role.deleted = false')
      .where('user.deleted = false')
      .orderBy('user.nombre_completo', 'ASC');

    if (search) {
      const patterns = buildSearchPatterns(search);
      query.andWhere(
        new Brackets((where) => {
          where
            .where('user.nombre_completo ILIKE :search', patterns)
            .orWhere('user.nombre_completo ILIKE :similarSearch', patterns)
            .orWhere('user.usuario ILIKE :search', patterns)
            .orWhere('user.usuario ILIKE :similarSearch', patterns)
            .orWhere('user.cedula_identidad ILIKE :search', patterns)
            .orWhere('user.cedula_identidad ILIKE :similarSearch', patterns)
            .orWhere('role.nombre ILIKE :search', patterns)
            .orWhere('role.nombre ILIKE :similarSearch', patterns);
        }),
      );
    }

    const [users, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: users.map((user) => this.auth.present(user)),
      total,
    };
  }

  async findOne(id: string) {
    return this.auth.present(await this.findEntity(id));
  }

  private async findEntity(id: string) {
    const user = await this.users.findOne({
      where: { id, deleted: false },
    });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.findEntity(id);
    if (
      dto.usuario !== undefined &&
      (await this.users.existsBy({
        id: Not(id),
        usuario: ILike(escapeSearchText(dto.usuario.trim())),
      }))
    )
      throw new ConflictException('El usuario ya está registrado');
    if (
      dto.cedula_identidad !== undefined &&
      (await this.users.existsBy({
        id: Not(id),
        cedula_identidad: dto.cedula_identidad,
      }))
    )
      throw new ConflictException('La cédula ya está registrada');
    const isSuperAdmin = this.isSuperAdmin(user);
    if (dto.role_id) {
      const role = await this.roles.findOne({
        where: { id: dto.role_id, deleted: false },
      });
      if (!role) throw new NotFoundException('El rol no existe');
      if (isSuperAdmin && role.nombre !== 'SUPER_ADMIN')
        throw new ForbiddenException(
          'No se puede cambiar el rol del usuario SUPER_ADMIN',
        );
      user.roles = [role];
    }
    if (dto.password)
      user.password_hash = await this.auth.hashPassword(dto.password);
    if (dto.nombre_completo !== undefined)
      user.nombre_completo = dto.nombre_completo;
    if (dto.cedula_identidad !== undefined)
      user.cedula_identidad = dto.cedula_identidad;
    if (dto.usuario !== undefined) user.usuario = dto.usuario.trim();
    if (
      isSuperAdmin &&
      dto.estado !== undefined &&
      dto.estado !== EstadoUsuario.ACTIVO
    )
      throw new ForbiddenException(
        'El usuario SUPER_ADMIN no puede ser inactivado',
      );
    if (dto.estado !== undefined) user.estado = dto.estado;
    return this.auth.present(await this.users.save(user));
  }

  async remove(id: string) {
    const user = await this.findEntity(id);
    if (this.isSuperAdmin(user))
      throw new ForbiddenException(
        'El usuario SUPER_ADMIN no puede ser eliminado',
      );
    await this.users.manager.transaction(async (manager) => {
      await manager.update(
        User,
        { id: user.id },
        { deleted: true, estado: EstadoUsuario.INACTIVO },
      );
      await manager
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revoked_at: new Date() })
        .where('user_id = :userId', { userId: user.id })
        .andWhere('revoked_at IS NULL')
        .execute();
    });
    return { id, deleted: true };
  }

  private isSuperAdmin(user: User): boolean {
    return user.roles.some((role) => role.nombre === 'SUPER_ADMIN');
  }
}
