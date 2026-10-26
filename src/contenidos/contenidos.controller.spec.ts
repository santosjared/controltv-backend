import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { ContenidosController } from './contenidos.controller.js';
import { ContenidosService } from './contenidos.service.js';

describe('Carga multipart de contenidos', () => {
  let app: INestApplication;
  const upload = vi.fn(async (files: { path: string }[]) => {
    await Promise.all(files.map((file) => rm(file.path, { force: true })));
    return { count: files.length };
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContenidosController],
      providers: [{ provide: ContenidosService, useValue: { upload } }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('acepta exactamente seis archivos en el campo files', async () => {
    let req = request(app.getHttpServer()).post('/contenidos/archivos');
    for (let i = 0; i < 6; i++) {
      req = req.attach('files', Buffer.from('test'), {
        filename: `${i}.png`,
        contentType: 'image/png',
      });
    }
    const response = await req;
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ count: 6 });
  });
  it('rechaza siete archivos', async () => {
    let req = request(app.getHttpServer()).post('/contenidos/archivos');
    for (let i = 0; i < 7; i++) {
      req = req.attach('files', Buffer.from('test'), {
        filename: `${i}.png`,
        contentType: 'image/png',
      });
    }
    expect((await req).status).toBe(400);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
