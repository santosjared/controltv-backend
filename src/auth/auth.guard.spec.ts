import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import type { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';

function setup(
  type: 'http' | 'ws',
  authorization?: string,
  permissions = ['tvs.view'],
) {
  const request = { headers: { authorization } };
  const context = {
    getType: () => type,
    getHandler: () => () => undefined,
    getClass: () => AuthGuard,
    switchToHttp: vi.fn(() => ({ getRequest: () => request })),
  };
  const auth = {
    verify: vi.fn(() => ({ sub: 'user', permissions })),
    ensureActiveUser: vi.fn(async () => undefined),
  };
  const reflector = {
    getAllAndOverride: vi.fn((key) =>
      key === IS_PUBLIC_KEY ? false : ['tvs.view'],
    ),
  };
  const guard = new AuthGuard(
    reflector as unknown as Reflector,
    auth as unknown as AuthService,
  );
  return {
    guard,
    context: context as unknown as ExecutionContext,
    switchToHttp: context.switchToHttp,
    auth,
    request,
  };
}

describe('AuthGuard por transporte', () => {
  it('delega el WebSocket al gateway sin intentar leer una petición HTTP', async () => {
    const { guard, context, switchToHttp, auth } = setup('ws');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(switchToHttp).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it('mantiene el token obligatorio en HTTP', async () => {
    const { guard, context } = setup('http');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('valida el token, el usuario activo y los permisos en HTTP', async () => {
    const { guard, context, auth, request } = setup('http', 'Bearer token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.verify).toHaveBeenCalledWith('token');
    expect(auth.ensureActiveUser).toHaveBeenCalledWith('user');
    expect(request).toHaveProperty('user.sub', 'user');
  });

  it('sigue rechazando peticiones HTTP sin permiso', async () => {
    const { guard, context } = setup('http', 'Bearer token', []);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('Permisos vigentes de la sesión', () => {
  it('rechaza permisos revocados aunque el token todavía los contenga', async () => {
    const { guard, context, auth } = setup('http', 'Bearer token');
    auth.ensureActiveUser.mockResolvedValue({
      sub: 'user',
      permissions: [],
    } as never);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
