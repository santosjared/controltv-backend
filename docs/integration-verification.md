# Verificación de integración — 26/10/2026

Se revisaron login, Inicio, usuarios, roles/permisos, televisores, contenido y playlists. Las pruebas HTTP usan PostgreSQL real con un esquema `integration_<UUID>` y una carpeta de archivos propios; ambos se eliminan al finalizar. No se inicia `AppModule`, por lo que estas pruebas no ejecutan la limpieza programada ni desconectan los televisores reales.

## Cobertura

| Módulo | Verificación |
| --- | --- |
| Login y sesión | Credenciales válidas e inválidas, sesión protegida, renovación de un solo uso, logout, cookies HttpOnly, Recordarme, expiración y renovación simultánea desde Next.js. |
| Inicio | Autorización del socket y de órdenes, resultados por TV, estado de solo lectura sin permiso de controlar, separación entre envío y reproducción. |
| Usuarios | Crear, listar/buscar/paginar, modificar, inactivar, eliminar, duplicados, protección de SUPER_ADMIN y catálogo de roles accesible con users.manage. |
| Roles y permisos | Crear, asignar y retirar permisos, actualizar, eliminar, protección de SUPER_ADMIN y revocación efectiva aun con un access token anterior. |
| Televisores | Solicitud de conexión, registro protegido, listado/búsqueda, modificación y eliminación. La confirmación del gateway en estas pruebas HTTP está simulada; el gateway tiene pruebas de contrato aparte. |
| Contenido | Subida multipart, filtros por tipo, descarga autenticada, descarga firmada para TV, enlace inválido, archivo limpiado y cancelación normal del cliente. |
| Playlists | Lista mixta, 10 segundos por imagen, duración de video enviada, duplicación, orden, eliminación y paginación sin perder playlists por sus elementos. |

## Correcciones de esta revisión

- Los guards HTTP y las órdenes del gateway consultan los permisos vigentes del usuario, en lugar de conservar permisos antiguos del JWT hasta su vencimiento.
- La renovación devuelve el perfil actual; Next.js verifica la sesión con el backend y no borra las cookies por una caída temporal.
- Las solicitudes concurrentes comparten una renovación para no consumir varias veces el mismo refresh token.
- Logout revoca el refresh token y limpia la sesión local; la caché de consultas se reinicia al entrar/salir para no reutilizar datos de otro usuario.
- Recordarme se conserva durante la validación y la renovación.
- GET /roles/opciones devuelve solamente id/nombre para usuarios con users.manage, sin conceder roles.manage.
- Nombres vacíos y duplicados de usuario, cédula o rol tienen validación y errores de conflicto. Los nombres se comparan sin distinguir mayúsculas, escapando comodines de SQL.
- El registro HTTP de una TV exige tvs.register; la identificación/conexión inicial de la TV continúa sin token de administrador.
- El socket permite consultar estado con tvs.view, pero las órdenes siguen exigiendo tvs.control.
- ECONNABORTED y ECONNRESET durante una descarga se tratan como cancelación del cliente; los demás errores se siguen procesando.
- Usuarios/roles se actualizan al volver a la página o recuperar foco, y editar un rol invalida también la consulta de usuarios.
- Next.js usa el puerto 3001 tanto en desarrollo como en producción; el backend conserva el 3000.

## Resultado

- Backend: 89 pruebas en 15 archivos, correctas.
- HTTP con PostgreSQL aislado: 4 escenarios completos, correctos.
- Next.js: test:integration, TypeScript, eslint y build correctos.
- Backend: build y oxlint correctos.

Esto verifica código, contratos y HTTP; no equivale a una nueva revisión visual manual de cada pantalla ni a una prueba completa sobre televisores físicos.

## Repetir las pruebas

En el backend:

```powershell
pnpm test
pnpm build
pnpm lint
$env:RUN_DB_INTEGRATION = '1'
pnpm test:e2e
Remove-Item Env:RUN_DB_INTEGRATION
```

Las pruebas de integración requieren las credenciales DB_* de .env y permiso para crear/eliminar su propio esquema temporal. No deben apuntarse a una base de producción.

En C:\projects\controltv:

```powershell
npm run test:integration
npm run lint
npm run build
```

Para cargar los cambios, reiniciar el backend desde la terminal del usuario. No se dejó otra instancia del servidor en ejecución desde esta revisión.

Además, el endpoint de descarga autenticada de Contenido establece el tipo MIME mediante el nombre original. Esto evita servir las vistas previas como application/octet-stream cuando el archivo físico está guardado con un hash sin extensión.
