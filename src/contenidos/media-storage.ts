import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const CONTENT_DIR = resolve(
  process.env.CONTENT_UPLOAD_DIR ?? 'uploads/contenidos',
);
mkdirSync(CONTENT_DIR, { recursive: true });

export const CONTENT_STAGING_DIR = `${CONTENT_DIR}-pending`;
mkdirSync(CONTENT_STAGING_DIR, { recursive: true });
