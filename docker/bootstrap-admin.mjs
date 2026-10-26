const baseUrl = process.env.API_BASE_URL ?? 'http://backend:3000';
const password = process.env.BOOTSTRAP_PASSWORD;
if (!password || password === 'GENERATE_WITH_SETUP') {
  throw new Error('Genera .env.docker con node docker/setup.mjs antes de iniciar.');
}
const result = await fetch(`${baseUrl}/auth/bootstrap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nombre_completo: process.env.BOOTSTRAP_NAME ?? 'Administrador',
    cedula_identidad: process.env.BOOTSTRAP_CI ?? 'ADMIN-LOCAL-001',
    usuario: process.env.BOOTSTRAP_USER ?? 'admin',
    password,
  }),
  signal: AbortSignal.timeout(30000),
});
if (result.status === 409) {
  console.log('La base ya tiene usuarios; se conserva el administrador existente.');
} else if (result.ok) {
  console.log('Administrador inicial creado. Inicia sesión con BOOTSTRAP_USER y BOOTSTRAP_PASSWORD de .env.docker.');
} else {
  throw new Error(`No se pudo crear el administrador inicial (HTTP ${result.status}). Revisa la configuración BOOTSTRAP_ en .env.docker.`);
}
