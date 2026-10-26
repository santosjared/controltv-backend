import { escapeSearchText } from './search.utils.js';
import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, IsNull, Repository } from 'typeorm';
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { User } from './entities/user.entity.js';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { LoginDto } from './dto/login.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { BootstrapDto } from './dto/bootstrap.dto.js';
import type { AuthUser } from './auth.types.js';
import { EstadoUsuario } from './entities/user.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { DEFAULT_PERMISSIONS } from './default-permissions.js';

const scrypt = promisify(scryptCallback);
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly secret: string;
  private readonly expiresInSeconds: number;
  private readonly refreshExpiresInSeconds: number;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    config: ConfigService,
  ) {
    this.secret = config.get('JWT_SECRET', 'dev-change-this-secret');
    this.expiresInSeconds = Number(config.get('JWT_EXPIRES_SECONDS', 28_800));
    this.refreshExpiresInSeconds = Number(
      config.get('REFRESH_TOKEN_EXPIRES_SECONDS', 2_592_000),
    );
  }

  async onModuleInit(): Promise<void> {
    const permissions = await this.seedPermissions();
    const superAdmin = await this.roles.findOne({
      where: { nombre: 'SUPER_ADMIN', deleted: false },
    });
    if (superAdmin)
      await this.roles.save({ ...superAdmin, permisos: permissions });
  }

  async bootstrap(dto: BootstrapDto) {
    if (await this.users.exists())
      throw new ConflictException('El administrador inicial ya fue creado');

    const seededPermissions = await this.seedPermissions();
    let role = await this.roles.findOne({
      where: { nombre: 'SUPER_ADMIN', deleted: false },
    });
    role = await this.roles.save(
      role
        ? { ...role, permisos: seededPermissions }
        : this.roles.create({
            nombre: 'SUPER_ADMIN',
            descripcion: 'Administrador inicial',
            permisos: seededPermissions,
          }),
    );
    return this.createUser({
      ...dto,
      role_id: role.id,
      estado: EstadoUsuario.ACTIVO,
    });
  }

  async login(dto: LoginDto) {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect(
        'role.permisos',
        'permission',
        'permission.deleted = false',
      )
      .where('LOWER(user.usuario) = LOWER(:usuario)', {
        usuario: dto.usuario.trim(),
      })
      .andWhere('user.deleted = false')
      .andWhere('role.deleted = false')
      .getOne();
    if (
      !user ||
      user.estado !== EstadoUsuario.ACTIVO ||
      !(await this.verifyPassword(dto.password, user.password_hash))
    )
      throw new UnauthorizedException('Credenciales inválidas');

    const authUser = this.toAuthUser(user);
    user.ultimo_acceso = new Date();
    await this.users.save(user);
    return {
      ...(await this.issueTokens(user, authUser)),
      usuario: this.present(user),
    };
  }

  async refresh(rawToken: string) {
    const token = await this.refreshTokens.findOne({
      where: {
        token_hash: this.hashRefreshToken(rawToken),
        revoked_at: IsNull(),
      },
      relations: { user: { roles: { permisos: true } } },
    });
    if (
      !token ||
      token.expires_at.getTime() <= Date.now() ||
      token.user.deleted ||
      token.user.estado !== EstadoUsuario.ACTIVO ||
      !token.user.roles.some((role) => !role.deleted)
    )
      throw new UnauthorizedException('Refresh token inválido o expirado');

    const revoked = await this.refreshTokens.update(
      { id: token.id, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
    if (!revoked.affected)
      throw new UnauthorizedException('Refresh token ya utilizado');
    return {
      ...(await this.issueTokens(token.user)),
      usuario: this.present(token.user),
    };
  }

  async logout(rawToken: string) {
    await this.refreshTokens.update(
      { token_hash: this.hashRefreshToken(rawToken), revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
    return { logged_out: true };
  }

  verify(token: string): AuthUser {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Token inválido');
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = this.signature(unsigned);
    const actualBuffer = Buffer.from(parts[2]);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    )
      throw new UnauthorizedException('Token inválido');
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as AuthUser;
      if (!payload.sub || !payload.exp || payload.exp <= Date.now() / 1000)
        throw new Error('expired');
      return payload;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  async ensureActiveUser(id: string): Promise<AuthUser> {
    const user = await this.users.findOne({
      where: { id, estado: EstadoUsuario.ACTIVO, deleted: false },
    });
    if (!user || !user.roles.some((role) => !role.deleted))
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    return this.toAuthUser(user);
  }

  async sessionProfile(id: string) {
    const user = await this.users.findOne({
      where: { id, deleted: false, estado: EstadoUsuario.ACTIVO },
    });
    if (!user) throw new UnauthorizedException('Usuario inactivo o eliminado');
    return this.present(user);
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }

  async createUser(dto: CreateUserDto) {
    const usuario = dto.usuario.trim();
    if (
      await this.users.existsBy({ usuario: ILike(escapeSearchText(usuario)) })
    )
      throw new ConflictException(`El usuario ${usuario} ya está registrado`);
    if (await this.users.existsBy({ cedula_identidad: dto.cedula_identidad }))
      throw new ConflictException('La cédula ya está registrada');
    const role = await this.roles.findOne({
      where: { id: dto.role_id, deleted: false },
    });
    if (!role) throw new ConflictException('El rol no existe');
    const user = await this.users.save(
      this.users.create({
        nombre_completo: dto.nombre_completo,
        cedula_identidad: dto.cedula_identidad,
        usuario,
        password_hash: await this.hashPassword(dto.password),
        estado: dto.estado ?? EstadoUsuario.ACTIVO,
        ultimo_acceso: null,
        roles: [role],
      }),
    );
    return this.present(user);
  }

  present(user: User) {
    return {
      id: user.id,
      nombre_completo: user.nombre_completo,
      cedula_identidad: user.cedula_identidad,
      usuario: user.usuario,
      estado: user.estado,
      deleted: user.deleted,
      ultimo_acceso: user.ultimo_acceso,
      rol: user.roles?.find((role) => !role.deleted) ?? null,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  private async verifyPassword(password: string, stored: string) {
    const [algorithm, salt, hash] = stored?.split('$') ?? [];
    if (algorithm !== 'scrypt' || !salt || !hash) return false;
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private toAuthUser(user: User): AuthUser {
    const activeRoles = user.roles?.filter((role) => !role.deleted) ?? [];
    const roles = activeRoles.map((role) => role.nombre);
    const assignedPermissions = [
      ...new Set(
        activeRoles.flatMap((role) =>
          role.permisos
            .filter((permission) => !permission.deleted)
            .map((permission) => permission.clave),
        ),
      ),
    ];
    const permissions = roles.includes('SUPER_ADMIN')
      ? [...new Set(['*', ...assignedPermissions])]
      : assignedPermissions;
    return {
      sub: user.id,
      usuario: user.usuario,
      roles,
      permissions,
      exp: Math.floor(Date.now() / 1000) + this.expiresInSeconds,
    };
  }

  private sign(payload: AuthUser): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    return `${unsigned}.${this.signature(unsigned)}`;
  }

  private signature(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private async issueTokens(user: User, authUser = this.toAuthUser(user)) {
    const rawRefreshToken = randomBytes(48).toString('base64url');
    await this.refreshTokens.save(
      this.refreshTokens.create({
        user_id: user.id,
        token_hash: this.hashRefreshToken(rawRefreshToken),
        expires_at: new Date(Date.now() + this.refreshExpiresInSeconds * 1000),
        revoked_at: null,
      }),
    );
    return {
      access_token: this.sign(authUser),
      refresh_token: rawRefreshToken,
      token_type: 'Bearer',
      expires_in: this.expiresInSeconds,
      refresh_expires_in: this.refreshExpiresInSeconds,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async seedPermissions(): Promise<Permission[]> {
    const permissions: Permission[] = [];
    for (const [clave, nombre, modulo] of DEFAULT_PERMISSIONS) {
      const current = await this.permissions.findOneBy({
        clave,
        deleted: false,
      });
      const permission = await this.permissions.save(
        current
          ? { ...current, nombre, modulo, descripcion: nombre }
          : this.permissions.create({
              clave,
              nombre,
              modulo,
              descripcion: nombre,
            }),
      );
      permissions.push(permission);
    }
    return permissions;
  }
}
