import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

// Opt-in: creates only its own schema and media folder, then removes both.
describe.skipIf(process.env.RUN_DB_INTEGRATION !== '1')(
  'Integración HTTP de todos los módulos',
  () => {
    const schema = `integration_${randomUUID().replaceAll('-', '')}`;
    const cacheRoot = resolve('node_modules/integration-audit-fixtures');
    const storage = join(cacheRoot, schema);
    let db: DataSource;
    let app: INestApplication;
    let token: string;
    let adminId: string;
    let user: any;
    let auth: any;
    let playback: any;
    let permissionRepo: any;
    let contentRepo: any;
    const username = 'integration_admin';
    const password = 'Integration-only-123!';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      'base64',
    );
    const api = () => request(app.getHttpServer());
    const bearer = () => `Bearer ${token}`;

    beforeAll(async () => {
      process.loadEnvFile('.env');
      process.env.CONTENT_UPLOAD_DIR = storage;
      const { User } = await import('../src/auth/entities/user.entity.js');
      const { Role } = await import('../src/auth/entities/role.entity.js');
      const { Permission } =
        await import('../src/auth/entities/permission.entity.js');
      const { RefreshToken } =
        await import('../src/auth/entities/refresh-token.entity.js');
      const { Tv } = await import('../src/tvs/entities/tv.entity.js');
      const { Sala } = await import('../src/salas/entities/sala.entity.js');
      const { Contenido } =
        await import('../src/contenidos/entities/contenido.entity.js');
      const { EstadoTv } =
        await import('../src/estados-tv/entities/estado-tv.entity.js');
      const { Playlist } =
        await import('../src/playlists/entities/playlist.entity.js');
      const { PlaylistItem } =
        await import('../src/playlists/entities/playlist-item.entity.js');
      db = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME ?? 'postgres',
        password: process.env.DB_PASSWORD ?? 'postgres',
        database: process.env.DB_DATABASE ?? 'tvcontrol',
        schema,
        entities: [
          User,
          Role,
          Permission,
          RefreshToken,
          Tv,
          Sala,
          Contenido,
          EstadoTv,
          Playlist,
          PlaylistItem,
        ],
        synchronize: false,
        logging: false,
      });
      await db.initialize();
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.synchronize();
      const { AuthService } = await import('../src/auth/auth.service.js');
      const { AuthGuard } = await import('../src/auth/auth.guard.js');
      const { UsersService } = await import('../src/auth/users.service.js');
      const { RolesService } = await import('../src/auth/roles.service.js');
      const { PermissionsService } =
        await import('../src/auth/permissions.service.js');
      const { TvsService } = await import('../src/tvs/tvs.service.js');
      const { TvsGateway } = await import('../src/tvs/tvs.gateway.js');
      const { ContenidosService } =
        await import('../src/contenidos/contenidos.service.js');
      const { PlaylistsService } =
        await import('../src/playlists/playlists.service.js');
      const { PlaybackService } =
        await import('../src/tvs/playback.service.js');
      const config = new ConfigService({ JWT_SECRET: randomUUID() });
      auth = new AuthService(
        db.getRepository(User),
        db.getRepository(Role),
        db.getRepository(Permission),
        db.getRepository(RefreshToken),
        config,
      );
      const roles = new RolesService(
        db.getRepository(Role),
        db.getRepository(Permission),
      );
      const users = new UsersService(
        db.getRepository(User),
        db.getRepository(Role),
        auth,
      );
      const contents = new ContenidosService(db.getRepository(Contenido), db);
      const playlists = new PlaylistsService(
        db.getRepository(Playlist),
        db.getRepository(PlaylistItem),
        db.getRepository(Contenido),
        db,
      );
      const tvs = new TvsService(db.getRepository(Tv), db);
      playback = new PlaybackService(
        contents,
        playlists,
        db.getRepository(EstadoTv),
        config,
      );
      permissionRepo = db.getRepository(Permission);
      contentRepo = db.getRepository(Contenido);
      const { AuthController } = await import('../src/auth/auth.controller.js');
      const { UsersController } =
        await import('../src/auth/users.controller.js');
      const { RolesController } =
        await import('../src/auth/roles.controller.js');
      const { PermissionsController } =
        await import('../src/auth/permissions.controller.js');
      const { TvsController } = await import('../src/tvs/tvs.controller.js');
      const { ContenidosController } =
        await import('../src/contenidos/contenidos.controller.js');
      const { PlaylistsController } =
        await import('../src/playlists/playlists.controller.js');
      const { PlaybackController } =
        await import('../src/tvs/playback.controller.js');
      const module = await Test.createTestingModule({
        controllers: [
          AuthController,
          UsersController,
          RolesController,
          PermissionsController,
          TvsController,
          ContenidosController,
          PlaylistsController,
          PlaybackController,
        ],
        providers: [
          { provide: AuthService, useValue: auth },
          { provide: UsersService, useValue: users },
          { provide: RolesService, useValue: roles },
          {
            provide: PermissionsService,
            useValue: new PermissionsService(permissionRepo),
          },
          { provide: TvsService, useValue: tvs },
          {
            provide: TvsGateway,
            useValue: {
              registerDevice: async () => {},
              confirmRegistration: async () => {},
            },
          },
          { provide: ContenidosService, useValue: contents },
          { provide: PlaylistsService, useValue: playlists },
          { provide: PlaybackService, useValue: playback },
        ],
      }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, transform: true }),
      );
      app.useGlobalGuards(new AuthGuard(app.get(Reflector), auth));
      await app.init();
      user = (
        await api()
          .post('/auth/bootstrap')
          .send({
            nombre_completo: 'Integration Admin',
            cedula_identidad: 'INTEGRATION-001',
            usuario: username,
            password,
          })
          .expect(201)
      ).body;
      adminId = user.id;
      const login = await api()
        .post('/auth/login')
        .send({ usuario: username, password })
        .expect(201);
      token = login.body.access_token;
      expect(token).toBeTypeOf('string');
    }, 60000);

    afterAll(async () => {
      await app?.close();
      if (db?.isInitialized) {
        if (!/^integration_[a-f0-9]{32}$/.test(schema))
          throw new Error('Unexpected test schema');
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
      for (const folder of [storage, `${storage}-pending`]) {
        if (
          !resolve(folder).startsWith(cacheRoot + '/') &&
          !resolve(folder).startsWith(cacheRoot + '\\')
        )
          throw new Error('Unexpected test storage');
        await rm(folder, { recursive: true, force: true });
      }
    }, 30000);

    it('login, sesión actual, renovación y logout revocado', async () => {
      await api()
        .post('/auth/login')
        .send({ usuario: username, password: 'incorrecta' })
        .expect(401);
      await api().get('/auth/me').expect(401);
      for (const endpoint of [
        '/usuarios',
        '/roles',
        '/roles/opciones',
        '/permisos',
        '/tvs',
        '/contenidos',
        '/playlists',
      ])
        await api().get(endpoint).expect(401);
      await api().post('/tvs/register').send({}).expect(401);
      const me = await api()
        .get('/auth/me')
        .set('Authorization', bearer())
        .expect(200);
      expect(me.body.perfil.id).toBe(adminId);
      expect(me.body.permissions).toContain('playlists.manage');
      const login = await api()
        .post('/auth/login')
        .send({ usuario: username.toUpperCase(), password })
        .expect(201);
      const refresh = await api()
        .post('/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(201);
      expect(refresh.body.usuario.id).toBe(adminId);
      await api()
        .post('/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(401);
      await api()
        .post('/auth/logout')
        .send({ refresh_token: refresh.body.refresh_token })
        .expect(201);
      await api()
        .post('/auth/refresh')
        .send({ refresh_token: refresh.body.refresh_token })
        .expect(401);
    });

    it('roles, permisos, usuarios, duplicados y revocación inmediata', async () => {
      const permission = await permissionRepo.findOneByOrFail({
        clave: 'users.manage',
      });
      const role = (
        await api()
          .post('/roles')
          .set('Authorization', bearer())
          .send({
            nombre: 'Operador integración',
            permission_ids: [permission.id],
          })
          .expect(201)
      ).body;
      await api()
        .post('/roles')
        .set('Authorization', bearer())
        .send({ nombre: 'OPERADOR INTEGRACIÓN', permission_ids: [] })
        .expect(409);
      const created = (
        await api()
          .post('/usuarios')
          .set('Authorization', bearer())
          .send({
            nombre_completo: 'Usuario temporal',
            cedula_identidad: 'INTEGRATION-002',
            usuario: 'integration_operator',
            password,
            role_id: role.id,
          })
          .expect(201)
      ).body;
      const limited = (
        await api()
          .post('/auth/login')
          .send({ usuario: 'integration_operator', password })
          .expect(201)
      ).body.access_token;
      const options = await api()
        .get('/roles/opciones')
        .set('Authorization', `Bearer ${limited}`)
        .expect(200);
      expect(options.body.some((entry: any) => entry.id === role.id)).toBe(
        true,
      );
      expect(options.body.every((entry: any) => !('permisos' in entry))).toBe(
        true,
      );
      await api()
        .get('/roles')
        .set('Authorization', `Bearer ${limited}`)
        .expect(403);
      for (const endpoint of ['/permisos', '/tvs', '/contenidos', '/playlists'])
        await api()
          .get(endpoint)
          .set('Authorization', `Bearer ${limited}`)
          .expect(403);
      await api()
        .get('/usuarios?search=integration_operator&page=1&limit=1')
        .set('Authorization', `Bearer ${limited}`)
        .expect(200);
      await api()
        .put(`/usuarios/${created.id}`)
        .set('Authorization', bearer())
        .send({ usuario: username })
        .expect(409);
      await api()
        .post('/roles')
        .set('Authorization', bearer())
        .send({ nombre: '   ', permission_ids: [] })
        .expect(400);
      await api()
        .put(`/roles/${role.id}`)
        .set('Authorization', bearer())
        .send({ permission_ids: [] })
        .expect(200);
      await api()
        .get('/usuarios')
        .set('Authorization', `Bearer ${limited}`)
        .expect(403);
      await api()
        .put(`/usuarios/${created.id}`)
        .set('Authorization', bearer())
        .send({ estado: 'INACTIVO' })
        .expect(200);
      await api()
        .get('/auth/me')
        .set('Authorization', `Bearer ${limited}`)
        .expect(401);
      await api()
        .delete(`/usuarios/${created.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .delete(`/roles/${role.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .delete(`/usuarios/${adminId}`)
        .set('Authorization', bearer())
        .expect(403);
      await api()
        .delete(`/roles/${user.rol.id}`)
        .set('Authorization', bearer())
        .expect(403);
    });

    it('televisores: registro, búsqueda, modificación, desconexión y eliminación', async () => {
      const pending = (
        await api()
          .post('/tvs/connect')
          .send({
            connectionId: 'integration-socket',
            ip: '127.0.0.1',
            model: 'Test TV',
            version_android: '12',
          })
          .expect(201)
      ).body;
      const tv = (
        await api()
          .post('/tvs')
          .set('Authorization', bearer())
          .send({
            tv_id: pending.tvId,
            ip: '127.0.0.1',
            model: 'Test TV',
            version_android: '12',
            nombre: 'TV integración',
            sala: 'Sala integración',
            ubicacion: 'Pruebas',
          })
          .expect(201)
      ).body;
      const listed = await api()
        .get('/tvs?search=integración&limit=1&page=1')
        .set('Authorization', bearer())
        .expect(200);
      expect(listed.body.total).toBe(1);
      await api()
        .put(`/tvs/${tv.id}`)
        .set('Authorization', bearer())
        .send({
          tv_id: tv.tv_id,
          nombre: 'TV actualizada',
          sala_id: tv.sala.id,
          sala: 'Sala integración',
          ubicacion: 'Pruebas actualizadas',
        })
        .expect(200);
      await api()
        .delete(`/tvs/${tv.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .get(`/tvs/${tv.id}`)
        .set('Authorization', bearer())
        .expect(404);
    });

    it('contenido y playlists: subida, filtros, paginación completa, orden y limpieza', async () => {
      const upload = await api()
        .post('/contenidos/archivos')
        .set('Authorization', bearer())
        .attach('files', png, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .attach('files', Buffer.from('test-video'), {
          filename: 'test.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);
      const image = upload.body.find((entry: any) => entry.tipo === 'IMAGEN');
      const video = upload.body.find((entry: any) => entry.tipo === 'VIDEO');
      expect(image).toBeTruthy();
      expect(video).toBeTruthy();
      const prepared = await playback.prepare('media.play', {
        tv_id: 'TV-00000000-000',
        contenido_id: video.id,
        auto_reproducir: false,
      });
      const signed = new URL(prepared.contenido.url, 'http://tests');
      await api()
        .get(signed.pathname + signed.search)
        .expect(200);
      await api().get(signed.pathname).expect(404);
      await api()
        .get('/contenidos?type=INVALID')
        .set('Authorization', bearer())
        .expect(400);
      const videos = await api()
        .get('/contenidos?type=VIDEO&limit=1&page=1')
        .set('Authorization', bearer())
        .expect(200);
      expect(videos.body.total).toBe(1);
      const list = (
        await api()
          .post('/playlists')
          .set('Authorization', bearer())
          .send({
            nombre: 'Lista mixta',
            items: [
              { contenido_id: image.id },
              { contenido_id: video.id, duracion_segundos: 7 },
            ],
          })
          .expect(201)
      ).body;
      expect(list.items.map((item: any) => item.duracion_segundos)).toEqual([
        10, 7,
      ]);
      await api()
        .post('/playlists')
        .set('Authorization', bearer())
        .send({
          nombre: 'Segunda',
          items: [
            { contenido_id: image.id },
            { contenido_id: image.id },
            { contenido_id: image.id },
            { contenido_id: image.id },
            { contenido_id: image.id },
            { contenido_id: image.id },
          ],
        })
        .expect(201);
      const copy = (
        await api()
          .post(`/playlists/${list.id}/duplicar`)
          .set('Authorization', bearer())
          .expect(201)
      ).body;
      const page = await api()
        .get('/playlists?limit=4&page=1')
        .set('Authorization', bearer())
        .expect(200);
      expect(page.body.total).toBe(3);
      expect(page.body.data).toHaveLength(3);
      const reversed = [...list.items].reverse().map((item: any) => item.id);
      const reordered = await api()
        .put(`/playlists/${list.id}/orden`)
        .set('Authorization', bearer())
        .send({ item_ids: reversed })
        .expect(200);
      expect(reordered.body.items.map((item: any) => item.id)).toEqual(
        reversed,
      );
      await api()
        .delete(`/playlists/${copy.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .get(`/contenidos/${image.id}/archivo`)
        .set('Authorization', bearer())
        .expect(200);
      const stored = await contentRepo
        .createQueryBuilder('item')
        .addSelect('item.archivo')
        .where('item.id = :id', { id: image.id })
        .getOne();
      await rm(join(storage, stored.archivo));
      await api()
        .get(`/contenidos/${image.id}/archivo`)
        .set('Authorization', bearer())
        .expect(404);
      await api()
        .get(`/contenidos/${image.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .delete(`/contenidos/${video.id}`)
        .set('Authorization', bearer())
        .expect(200);
      await api()
        .get(`/contenidos/${video.id}`)
        .set('Authorization', bearer())
        .expect(404);
    });
  },
);
