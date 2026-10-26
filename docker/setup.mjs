import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? resolve(root, '.env.docker'));
const template = await readFile(resolve(root, '.env.docker.example'), 'utf8');
let result = template;
for (const key of ['DB_PASSWORD', 'JWT_SECRET', 'BOOTSTRAP_PASSWORD']) {
  result = result.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
}
try {
  await writeFile(target, result, { flag: 'wx', mode: 0o600 });
  console.log(`Configuración creada: ${target}`);
  console.log('Usuario inicial: admin. Su contraseña está en BOOTSTRAP_PASSWORD dentro de ese archivo.');
  console.log('No se modificó tu .env de desarrollo.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log(`Ya existe ${target}; se conservó sin modificar sus claves.`);
}
