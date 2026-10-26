import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator.js';
import type { AuthUser } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // El gateway distingue TVs y administradores dentro del canal compartido.
    // Las órdenes de administrador verifican su token y permisos allí.
    if (context.getType() === 'ws') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Token Bearer obligatorio');
    const claims = this.auth.verify(authorization.slice(7));
    const user = (await this.auth.ensureActiveUser(claims.sub)) ?? claims;
    request.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      required?.length &&
      !user.permissions.includes('*') &&
      !required.every((permission) => user.permissions.includes(permission))
    )
      throw new ForbiddenException('No tiene permisos para esta operación');
    return true;
  }
}
