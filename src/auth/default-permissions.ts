export const DEFAULT_PERMISSIONS = [
  ['dashboard.view', 'Ver panel principal', 'Panel'],
  ['tvs.view', 'Ver televisores', 'Televisores'],
  ['tvs.register', 'Registrar televisores', 'Televisores'],
  ['tvs.edit', 'Editar televisores', 'Televisores'],
  ['tvs.delete', 'Eliminar televisores', 'Televisores'],
  ['tvs.control', 'Controlar reproducción y volumen', 'Televisores'],
  ['content.view', 'Ver biblioteca de contenido', 'Contenido'],
  ['content.upload', 'Subir imágenes y videos', 'Contenido'],
  ['content.send', 'Enviar contenido a pantallas', 'Contenido'],
  ['content.delete', 'Eliminar contenido', 'Contenido'],
  ['playlists.view', 'Ver playlists', 'Playlists'],
  ['playlists.manage', 'Crear y editar playlists', 'Playlists'],
  ['users.manage', 'Administrar usuarios', 'Seguridad'],
  ['roles.manage', 'Administrar roles y permisos', 'Seguridad'],
] as const;

export const DEFAULT_PERMISSION_KEYS = new Set<string>(
  DEFAULT_PERMISSIONS.map(([key]) => key),
);
