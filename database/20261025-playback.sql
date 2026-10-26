-- Ejecutar antes de iniciar si DB_SYNCHRONIZE=false.
ALTER TABLE estados_tv ADD COLUMN IF NOT EXISTS playlist_id uuid NULL;
ALTER TABLE estados_tv ADD COLUMN IF NOT EXISTS aleatorio boolean NOT NULL DEFAULT false;
