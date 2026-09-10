import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRANSFER_DIR, TransfersService } from './transfers.service.js';

describe('Transferencias temporales', () => {
  const service = new TransfersService();
  afterEach(() => vi.restoreAllMocks());

  it('conserva la descarga hasta confirmar, valida destino/token y elimina al confirmar', async () => {
    await mkdir(TRANSFER_DIR, { recursive: true });
    const path = join(TRANSFER_DIR, 'test-media');
    await writeFile(path, 'media');
    const result = service.create('TV-1', 'admin-1', {
      path,
      size: 5,
      originalname: 'test.png',
      mimetype: 'image/png',
    });
    const token = new URL(
      result.downloadUrl,
      'http://localhost',
    ).searchParams.get('token');
    expect(() => service.get('TV-2', result.transferId, token)).toThrow();
    expect(() => service.get('TV-1', result.transferId, 'invalid')).toThrow();
    expect(service.get('TV-1', result.transferId, token).path).toBe(path);
    await access(path);
    expect(service.pending('TV-1')).toHaveLength(1);
    expect(service.pending('TV-2')).toHaveLength(0);
    await service.confirm('TV-1', result.transferId, token);
    await expect(access(path)).rejects.toThrow();
    expect(() => service.get('TV-1', result.transferId, token)).toThrow();
  });

  it('elimina archivos vencidos sin confirmación', async () => {
    const path = join(TRANSFER_DIR, 'expired-media');
    await writeFile(path, 'media');
    service.create('TV-1', 'admin-1', {
      path,
      size: 5,
      originalname: 'test.mp4',
      mimetype: 'video/mp4',
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_001);
    await service.expire();
    await expect(access(path)).rejects.toThrow();
    expect(service.pending('TV-1')).toEqual([]);
    await service.onModuleDestroy();
  });

  it('no borra si falla la persistencia y solo permite una carga pendiente por TV', async () => {
    await mkdir(TRANSFER_DIR, { recursive: true });
    const path = join(TRANSFER_DIR, 'persist-media');
    await writeFile(path, 'media');
    const file = {
      path,
      size: 5,
      originalname: 'movie.mp4',
      mimetype: 'video/mp4',
    };
    service.create('TV-3', 'admin', file);
    expect(() => service.create('TV-3', 'admin', file)).toThrow();
    await expect(
      service.complete('TV-3', async () => {
        throw new Error('DB offline');
      }),
    ).rejects.toThrow('DB offline');
    await access(path);
    const persist = vi.fn(async () => ({ saved: true }));
    await expect(service.complete('TV-3', persist)).resolves.toEqual({
      saved: true,
    });
    expect(persist).toHaveBeenCalledWith(expect.any(String), file);
    await expect(access(path)).rejects.toThrow();
    expect(service.pending('TV-3')).toEqual([]);
    await service.onModuleDestroy();
  });
});
