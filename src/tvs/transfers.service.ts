import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TRANSFER_DIR = mkdtempSync(join(tmpdir(), 'tvcontrol-'));
export const MAX_MEDIA_SIZE = 100 * 1024 * 1024;
export interface MediaFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}
interface Transfer {
  id: string;
  tvId: string;
  senderId: string | null;
  token: string;
  file: MediaFile;
  expiresAt: number;
  completing?: boolean;
}

@Injectable()
export class TransfersService implements OnModuleDestroy {
  private readonly transfers = new Map<string, Transfer>();
  private readonly timer = setInterval(() => {
    void this.expire().catch(() => undefined);
  }, 60_000).unref();

  create(tvId: string, senderId: string | null, file: MediaFile) {
    if (
      [...this.transfers.values()].some(
        (t) => t.tvId === tvId && (t.completing || t.expiresAt > Date.now()),
      )
    ) {
      throw new ConflictException('La TV ya tiene una transferencia pendiente');
    }
    if (!file.size) throw new BadRequestException('El archivo está vacío');
    const transfer: Transfer = {
      id: randomUUID(),
      tvId,
      senderId,
      file,
      token: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 3_600_000,
    };
    this.transfers.set(transfer.id, transfer);
    return this.describe(transfer);
  }

  async createMany(
    tvIds: string[],
    senderId: string | null,
    sourceFile: MediaFile,
  ) {
    const uniqueTvIds = [...new Set(tvIds)];
    if (uniqueTvIds.length !== tvIds.length)
      throw new BadRequestException('tv_ids no puede contener IDs repetidos');
    if (!sourceFile.size)
      throw new BadRequestException('El archivo está vacío');

    for (const tvId of uniqueTvIds) {
      if (
        [...this.transfers.values()].some(
          (t) => t.tvId === tvId && (t.completing || t.expiresAt > Date.now()),
        )
      ) {
        throw new ConflictException(
          `La TV ${tvId} ya tiene una transferencia pendiente`,
        );
      }
    }

    const created: Transfer[] = [];
    try {
      for (const tvId of uniqueTvIds) {
        const path = join(TRANSFER_DIR, randomUUID());
        await copyFile(sourceFile.path, path);
        const transfer: Transfer = {
          id: randomUUID(),
          tvId,
          senderId,
          file: { ...sourceFile, path },
          token: randomBytes(32).toString('hex'),
          expiresAt: Date.now() + 3_600_000,
        };
        this.transfers.set(transfer.id, transfer);
        created.push(transfer);
      }
      return created.map((transfer) => this.describe(transfer));
    } catch (error) {
      for (const transfer of created) {
        this.transfers.delete(transfer.id);
        await rm(transfer.file.path, { force: true });
      }
      throw error;
    }
  }

  pending(tvId: string) {
    return [...this.transfers.values()]
      .filter((t) => t.tvId === tvId && t.expiresAt > Date.now())
      .map((t) => this.describe(t));
  }

  private describe(t: Transfer) {
    const base = `/tvs/${encodeURIComponent(t.tvId)}/transferencias/${t.id}`;
    return {
      transferId: t.id,
      tv_id: t.tvId,
      senderId: t.senderId,
      filename: t.file.originalname,
      mimeType: t.file.mimetype,
      size: t.file.size,
      expiresAt: new Date(t.expiresAt).toISOString(),
      downloadUrl: `${base}/archivo?token=${t.token}`,
      confirmUrl: `${base}/confirmar?token=${t.token}`,
    };
  }

  get(tvId: string, id: string, token: unknown) {
    const t = this.transfers.get(id);
    if (
      !t ||
      t.tvId !== tvId ||
      typeof token !== 'string' ||
      token !== t.token ||
      t.expiresAt <= Date.now()
    ) {
      throw new NotFoundException('Transferencia no encontrada o expirada');
    }
    return t.file;
  }

  async confirm(tvId: string, id: string, token: unknown) {
    const file = this.get(tvId, id, token);
    if (this.transfers.get(id)?.completing)
      throw new ConflictException('Confirmación en curso');
    await rm(file.path, { force: true });
    this.transfers.delete(id);
    return { transferId: id, deleted: true };
  }

  async complete<T>(
    tvId: string,
    persist: (id: string, file: MediaFile) => Promise<T>,
  ): Promise<T> {
    const transfer = [...this.transfers.values()].find(
      (t) => t.tvId === tvId && (t.completing || t.expiresAt > Date.now()),
    );
    if (!transfer)
      throw new NotFoundException(
        'No hay transferencia pendiente para esta TV',
      );
    if (transfer.completing)
      throw new ConflictException('Confirmación en curso');
    transfer.completing = true;
    try {
      const result = await persist(transfer.id, transfer.file);
      await rm(transfer.file.path, { force: true });
      this.transfers.delete(transfer.id);
      return result;
    } finally {
      transfer.completing = false;
    }
  }

  async expire() {
    for (const [id, t] of this.transfers) {
      if (!t.completing && t.expiresAt <= Date.now()) {
        await rm(t.file.path, { force: true });
        this.transfers.delete(id);
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await rm(TRANSFER_DIR, { recursive: true, force: true });
  }
}
