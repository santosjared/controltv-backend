import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_DIR } from './media-storage.js';

// Bolivia usa UTC-4 durante todo el a�o.
export function boliviaMidnight(now = Date.now()) {
  const local = new Date(now - 4 * 60 * 60 * 1000);
  return Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    4,
  );
}

@Injectable()
export class ContenidosCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContenidosCleanupService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  async onModuleInit() {
    await this.run();
  }

  private async run() {
    try {
      await this.cleanup();
    } catch (error) {
      this.logger.error(
        'No se pudo completar la limpieza de contenidos',
        error,
      );
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            void this.run();
          },
          boliviaMidnight() + 86400000 - Date.now(),
        );
        this.timer.unref();
      }
    }
  }

  async cleanup(now = Date.now()) {
    const cutoff = boliviaMidnight(now);
    for (const name of await readdir(CONTENT_DIR)) {
      const path = join(CONTENT_DIR, name);
      try {
        const file = await stat(path);
        if (!file.isFile() || file.mtimeMs >= cutoff) continue;
        await rm(path, { force: true });
      } catch (error) {
        this.logger.error(`No se pudo limpiar el archivo ${name}`, error);
      }
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
