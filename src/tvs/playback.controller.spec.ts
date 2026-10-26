import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { PlaybackController } from './playback.controller.js';
import type { PlaybackService } from './playback.service.js';

describe('Cabeceras de descarga para TV', () => {
  it.each(['probando.mp4', 'servicios.png'])(
    'establece el tipo MIME usando el nombre original: %s',
    async (nombre) => {
      const getFile = vi.fn(async () => ({
        path: '/uploads/hash-sin-extension',
        nombre,
      }));
      const controller = new PlaybackController({
        getFile,
      } as unknown as PlaybackService);
      const response = { setHeader: vi.fn(), type: vi.fn(), download: vi.fn() };
      await controller.download(
        'TV-001',
        'id',
        'expires',
        'signature',
        response as unknown as Response,
        vi.fn(),
      );
      expect(getFile).toHaveBeenCalledWith(
        'TV-001',
        'id',
        'expires',
        'signature',
      );
      expect(response.type).toHaveBeenCalledWith(nombre);
      expect(response.download).toHaveBeenCalledWith(
        '/uploads/hash-sin-extension',
        nombre,
        expect.any(Function),
      );
    },
  );
});
