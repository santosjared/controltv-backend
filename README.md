<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Estado de dispositivos para administración

En el namespace Socket.IO `/tvs`, el frontend de administración escucha
`admin.message` para recibir estados. Cada mensaje `devices.status` contiene una
instantánea completa: reemplaza las listas anteriores, no agregues sus elementos.

```js
socket.on('admin.message', ({ evento, datos }) => {
  if (evento === 'devices.status') {
    // datos = { enline: [{ tv_id: 'TV-12345678-ABC' }], low_sengal: [] }
    actualizarDispositivos(datos);
  } else if (evento === 'devices.pending') {
    // Dispositivos con tvId, ip, model y version_android.
    actualizarPendientes(datos.pendientes_registro);
  }
});

// Opcional: solicitar una nueva instantánea por el mismo canal.
socket.emit('admin.message', { evento: 'devices.status.request' });
```

El servidor envía ambas listas al conectar el socket o solicitar una instantánea.
`admin.message` se actualiza al cambiar una conexión o la señal, y solo incluye
`tv_id` en las listas `enline` y `low_sengal` (nombres exactos del contrato).
El frontend obtiene los datos completos por GET `/tvs`: las TVs que no aparecen
en ninguna de esas dos listas están desconectadas.
Los pendientes se envían por el mismo canal `admin.message` cuando cambia su lista,
con el formato `{ evento: 'devices.pending', datos: { pendientes_registro: [{ tvId, ip, model, version_android }] } }`.
Un pendiente se retira al desconectarse o registrarse; al registrarse pasa a `enline`.
Si falla la consulta solicitada, responde por `admin.message` con
`evento: 'error'` y `datos.code: 'DEVICE_STATUS_ERROR'`.

Este canal reemplaza los eventos `device.connected`, `devices.pending`,
`devices.connected` y `tv.connection_status`, así como la solicitud
`devices.pending.request`. La comunicación de las TVs continúa en `tv.message`.

## Project setup

## Transferencias temporales de imagen/video

`POST /tvs/:tv_id/transferencias` recibe multipart/form-data:
`file` (un video o imagen, máximo 100 MiB = 104857600 bytes) y
`senderId` (identificador de quien envía, opcional, hasta 100 caracteres).
Por ahora se permite omitirlo o enviar vacío o `"null"` en multipart;
se normaliza a `null` en la respuesta y en el aviso al TV.
`tv_id` identifica la TV registrada de destino. Si el origen es otra TV,
envía su identificador como `senderId`. Este campo es declarativo: no autentica
al remitente. El tipo de archivo se valida por MIME declarado.

```bash
curl -X POST http://localhost:3000/tvs/TV-12345678-ABC/transferencias -F "senderId=admin-1" -F "file=@video.mp4"
```

Al completar la subida, el destino recibe por Socket.IO namespace `/tvs`:
`tv.message` con `{ evento: 'media.disponible', datos: { transferId, tv_id,
senderId, filename, mimeType, size, expiresAt, downloadUrl, confirmUrl } }`.
La respuesta HTTP contiene los mismos datos. Las URLs son relativas al backend
e incluyen un token secreto de transferencia; conservarlo y no publicarlo.

El TV hace GET a `downloadUrl`, guarda el archivo completo y confirma por
`tv.message` en el namespace `/tvs` con campos en la raíz:

```json
{ "evento": "media.lista", "tv_id": "TV-12345678-ABC", "url": "content://media/external/video/media/123" }
```

El socket debe haberse identificado como ese TV. Solo se permite una transferencia
pendiente por TV (otra carga devuelve 409), ya que la confirmación no incluye
transferId. Para una imagen, enviar media.lista cuando ya se esté mostrando;
para un video, cuando esté guardado y listo para reproducir.

El backend guarda en `contenidos` el nombre original (hasta 150 caracteres), tipo
VIDEO/IMAGEN, tamaño en bytes y URL local. Si el TV ya tiene contenido asociado,
actualiza ese mismo registro conservando su ID; si no, crea uno nuevo.
También vincula el contenido al TV en
`estados_tv`: STOPPED para video listo y PLAYING para imagen mostrada. Tras guardar,
elimina el archivo temporal y su transferencia en memoria; conserva el registro
de contenido en la base de datos. No se almacenan los bytes del archivo en la BD.

El administrador recibe por `admin.message`:

```json
{
  "evento": "media.lista",
  "datos": {
    "tv_id": "TV-12345678-ABC",
    "contenido": { "id": "uuid", "nombre": "video.mp4", "tipo": "VIDEO", "tamano_bytes": "52428800", "url": "content://media/external/video/media/123" },
    "estado": "LISTO_PARA_REPRODUCIR"
  }
}
```

Para imágenes, estado es `MOSTRANDO`. El TV recibe `media.confirmada` por
`tv.message` con los mismos datos. Si falla, recibe evento `error` y puede
reintentar; no se anuncia éxito al administrador. Una confirmación ya completada
no crea otro registro. La URL content:// solo se puede abrir en el TV que la envió.

No usar el POST `confirmUrl` en este flujo: es el mecanismo anterior de solo
borrado y elimina los metadatos necesarios para registrar el contenido.
Si falla la descarga no confirmar; se permiten reintentos y solicitudes Range.
Archivos mayores al límite devuelven 413.
El TV debe identificarse previamente con `tv.obtener` o `tv.heartbeat`.
Al reconectarse e identificarse recibe las transferencias todavía pendientes.
Los archivos expiran tras una hora y se limpian cada minuto. Se guardan en el
directorio temporal del sistema, con metadatos en memoria: requieren una sola
instancia, no sobreviven a reinicios y se borran en el cierre ordenado del módulo.
Un cierre abrupto puede dejar archivos que debe limpiar el sistema operativo.

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).




### Archivos de contenidos

- `POST /contenidos/archivos`: multipart con campo `files` repetido, entre 1 y 6 imágenes/videos por solicitud y máximo 6 archivos almacenados simultáneamente para todo el sistema; eliminar un archivo libera un espacio, máximo 100 MiB (104857600 bytes) por archivo. Devuelve un array de contenidos. Requiere `content.upload`.
- `POST /contenidos`: conserva el registro de contenido por metadatos/URL.
- `GET /contenidos?page=1&limit=10&search=texto&type=VIDEO`: devuelve `{ data, total }`, busca por nombre/tipo con las mismas coincidencias de los otros CRUD; límite máximo 100. El filtro opcional `type` acepta `VIDEO` o `IMAGEN`; al omitirlo lista ambos. Un valor diferente devuelve 400. El total corresponde a los filtros aplicados.
- `GET /contenidos/:id` y `GET /contenidos/:id/archivo`: consulta y descarga autenticadas con `content.view`.
- `PATCH /contenidos/:id`: actualiza metadatos con `content.upload`.
- `DELETE /contenidos/:id`: marca `deleted=true`; borra el archivo local si existe y conserva el registro marcado como eliminado. Requiere `content.delete`.

Los archivos subidos se guardan en `CONTENT_UPLOAD_DIR` (por defecto `uploads/contenidos`). A las 00:00 de Bolivia (America/La_Paz, UTC-4) se borran los archivos de días anteriores sin cambiar el estado de sus registros. Al iniciar se recupera la limpieza pendiente. La limpieza solo administra archivos de este directorio; las URL externas y los archivos ya descargados en TVs no se eliminan. El proceso del backend debe estar ejecutándose para realizar la tarea a medianoche.

La entidad contenidos añade las columnas `deleted` (boolean, default false) , `archivo` (varchar nullable) y `subido_at` (timestamptz nullable para registrar la fecha de carga). En instalaciones con `DB_SYNCHRONIZE=false`, aplicar estas columnas mediante una migración antes de iniciar.

### Playlists

El protocolo de reproducción por el canal `admin.message` está documentado en
[docs/socket-playback.md](docs/socket-playback.md). Incluye playlists, contenido
individual, repetir, aleatorio y confirmaciones enviadas por la TV.
El panel puede enviar `request_id` y `tv_ids` para una o varias TVs y recibir
`media.result` por destinatario después de la confirmación o del error. Se conserva
el formato individual anterior para la transición.

Requiere autenticación y permisos `playlists.view` para consultar o `playlists.manage` para modificar.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/playlists?page=1&limit=10&search=sala` | Búsqueda por nombre y descripción, devuelve `{ data, total }`. Página inicial 1; límite predeterminado 10, máximo 100. |
| GET | `/playlists/:id` | Detalle con contenido y elementos ordenados. |
| POST | `/playlists` | Crear con `{ "nombre": "Sala de espera", "descripcion": "Información para pacientes" }`. |
| PUT | `/playlists/:id` | Editar nombre y/o descripción. |
| DELETE | `/playlists/:id` | Eliminar la lista y sus elementos; conserva los contenidos originales. |
| POST | `/playlists/:id/duplicar` | Crear una copia con los mismos contenidos, duraciones y orden. |
| POST | `/playlists/:id/items` | Agregar imagen o video con `{ "contenido_id": "UUID", "duracion_segundos": 12 }`. |
| DELETE | `/playlists/:id/items/:itemId` | Quitar un elemento de la lista. |
| PUT | `/playlists/:id/orden` | Guardar `{ "item_ids": ["UUID-item-2", "UUID-item-1"] }` con todos los IDs de elementos, una vez cada uno. |

La creación admite un array opcional `items` con `contenido_id`, `duracion_segundos` (1–3600) y `orden` opcional (desde 0). Al agregar contenido, omitir `orden` lo coloca al final; un orden ocupado devuelve 400. No se admiten contenidos marcados como eliminados. Los cambios de orden se guardan en una transacción.

Cada playlist incluye `total_elementos` y `duracion_total_segundos`, además de `items` con su `contenido`, `created_at` y `updated_at`. El listado devuelve ahora un objeto paginado en lugar del array anterior. Las rutas `/playlists/:id/imagenes` y `/playlists/:id/imagenes/:itemId` y el campo de creación `imagenes` se conservan como alias; enviar `items` e `imagenes` juntos devuelve 400.

Las entidades usan las tablas `playlists` y `playlist_items`, con orden único por playlist y eliminación en cascada de sus elementos. Si todavía no existen y `DB_SYNCHRONIZE=false`, deben crearse mediante una migración antes de usar estas rutas.

Contenido actual en reproducción: la TV informa `media.play` con `origen: "tv"` y `contenido_actual_id` al iniciar cada video o mostrar cada imagen de una playlist. No cambia `playlist_id`: el backend valida que el contenido pertenezca a la selección activa y guarda su ID en el estado. Los eventos confirmados y la instantánea del panel incluyen `contenido_actual: { id, nombre, tipo }`; esto permite conservar el nombre aunque la limpieza haya eliminado el archivo físico. La vista previa usa el endpoint de archivos autenticado del panel y muestra fondo oscuro si no está disponible. Al reemplazar contenido, Android elimina las descargas anteriores y descarta también listas incompletas; espera a que finalice la limpieza de la descarga cancelada antes de iniciar otra.

Preparación y aprobación: los envíos de la biblioteca usan `auto_reproducir: false` en `media.play`/`media.show`. La TV confirma la descarga mediante `media.result`, pero conserva el contenido detenido y oculto. Solo un Play/Mostrar explícito autoriza reproducción (`auto_reproducir: true` si incluye una nueva selección, o `media.play` sin selección para el contenido local preparado). Si falta la opción en un envío, el backend usa false. Al perder conexión y al iniciar el backend, el estado guardado se restablece a STOPPED; la app también detiene/cancela localmente y no reanuda contenido al reconectar. Los televisores deben usar la APK actualizada para respetar esta opción.

La verificación integral de login, módulos, permisos y comunicación está documentada en [docs/integration-verification.md](docs/integration-verification.md). Incluye los comandos de pruebas HTTP en PostgreSQL aislado y las correcciones de sesión de Next.js.
