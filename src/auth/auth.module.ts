import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { UsersService } from './users.service.js';
import { RolesService } from './roles.service.js';
import { PermissionsService } from './permissions.service.js';
import { AuthController } from './auth.controller.js';
import { UsersController } from './users.controller.js';
import { RolesController } from './roles.controller.js';
import { PermissionsController } from './permissions.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Permission, RefreshToken])],
  controllers: [
    AuthController,
    UsersController,
    RolesController,
    PermissionsController,
  ],
  providers: [
    AuthService,
    UsersService,
    RolesService,
    PermissionsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
