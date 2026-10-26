# Reproducción por Socket.IO

Namespace `/tvs`. Las órdenes y confirmaciones nuevas usan el evento Socket.IO
`admin.message` y el sobre `{ evento, datos }`, como objeto o string JSON.

El administrador conecta con `auth: { token: accessToken }` (también se acepta
`auth.access_token` o la cabecera `Authorization: Bearer ...`). Cada orden verifica
el token, que el usuario siga activo y el permiso `tvs.control` (o `*`). Los
administradores autorizados reciben confirmaciones en la sala interna
`playback.admins`. El frontend debe reconectar con el token renovado si expira.

Las TVs se identifican por el flujo existente `tv.obtener` / `tv.heartbeat` o el
registro inicial. Pueden seguir enviando esos eventos por `tv.message`. También se
aceptan por `admin.message`. El backend distingue una TV por su conexión registrada;
sus confirmaciones no se interpretan como órdenes de administrador.

## Orden del administrador

```json
{
  "evento": "media.play",
  "datos": {
    "tv_id": "TV-9FAA8218-A1A",
    "playlist_id": "84d23cd1-f4a0-4439-98f7-bfd344ba3f7f"
  }
}
```

`tv_id` es el código de dispositivo, no el UUID de su registro. El formato individual
anterior sigue disponible durante la transición. El formato nuevo del panel es:

```json
{
  "evento": "media.play",
  "datos": {
    "request_id": "64c9725a-8411-4516-9d45-189e2a66a016",
    "tv_ids": ["TV-001", "TV-002"],
    "playlist_id": "84d23cd1-f4a0-4439-98f7-bfd344ba3f7f"
  }
}
```

Todas las acciones de la tabla admiten este sobre. Cada clic genera un UUID nuevo
en `request_id`. `tv_ids` admite de 1 a 100 códigos únicos; una sola TV también usa
un array. No se admite combinar `tv_ids` con `tv_id`. El backend valida permisos una
vez y procesa cada destinatario de forma independiente. La orden dirigida a cada
TV conserva `request_id`, añade su `tv_id` y elimina el array `tv_ids`. Nunca se
envía a TVs fuera del grupo.

Una estructura de grupo inválida genera `media.error` con `INVALID_COMMAND`, sin
enviar órdenes. Un grupo válido genera un `media.result` por TV, incluidos los
errores de validación de la acción, permisos, preparación o desconexión.

| Evento | Datos adicionales |
| --- | --- |
| `media.play` | `playlist_id` o `contenido_id` (UUID), nunca ambos; sin contexto reanuda la reproducción actual |
| `media.show` | `contenido_id` de una imagen |
| `media.pause`, `media.stop`, `media.hide` | Contexto opcional |
| `media.volume`, `media.volumen` | `volumen`: entero 0–100 |
| `media.repeat` | `repetir`: booleano explícito; contexto opcional |
| `media.shuffle` | `aleatorio`: booleano explícito; contexto opcional |

Para contenido individual se admite `tipo: "VIDEO"` o `"IMAGEN"`, validado contra
el registro. Una imagen individual permanece visible hasta otra orden.

## Orden resuelta que recibe la TV

La TV escucha `admin.message`. En `media.play` con playlist, `datos` conserva
`tv_id` y `playlist_id`, y añade:

```json
{
  "repetir": false,
  "aleatorio": false,
  "playlist": {
    "id": "UUID-PLAYLIST",
    "nombre": "Sala de espera",
    "items": [
      {
        "id": "UUID-ITEM",
        "contenido_id": "UUID-CONTENIDO",
        "orden": 0,
        "duracion_segundos": 10,
        "contenido": {
          "id": "UUID-CONTENIDO",
          "nombre": "Bienvenida.png",
          "tipo": "IMAGEN",
          "url": "/tvs/TV-9FAA8218-A1A/reproduccion/UUID-CONTENIDO/archivo?expires=...&token=..."
        }
      }
    ]
  }
}
```

Para un contenido individual, se añade `datos.contenido` con sus metadatos y URL.
Las URLs de archivos locales se firman por TV y contenido, con vigencia de 24 h;
no requieren el token de administrador. La TV resuelve las rutas relativas contra
la URL HTTP del backend. Las URLs externas se conservan.

La TV descarga/prepara los archivos, reproduce la secuencia y detecta la duración
de los videos (`duracion_segundos: null`); las imágenes usan la duración guardada
(10 segundos si falta). Aleatorio cambia el recorrido en la TV, nunca el orden
guardado en la base de datos. Repetir y aleatorio se conservan por TV para futuras
reproducciones. Este repositorio implementa el backend, no el reproductor Android.

## Confirmación y errores

Después de aplicar la orden, la TV envía `admin.message` con el mismo `evento` y
su `tv_id`, `request_id` recibido y los valores finales (sin reenviar `playlist` ni
los archivos). El contexto omitido se toma de la orden pendiente; un valor explícito
distinto se rechaza. Las órdenes nuevas no aceptan confirmaciones sin `request_id`.
El backend valida la conexión y la orden pendiente, guarda el estado y publica el
mismo evento a los administradores autorizados. Aceptar una orden no genera una
confirmación de éxito. Se mantiene `tv.message` como entrada de confirmaciones
para clientes antiguos; las órdenes nuevas se entregan solo por `admin.message`.

Además del evento de estado conservado para los paneles antiguos, el panel que
envió la orden nueva recibe exactamente un resultado final por TV:

```json
{
  "evento": "media.result",
  "datos": {
    "request_id": "64c9725a-8411-4516-9d45-189e2a66a016",
    "tv_id": "TV-001",
    "accion": "media.play",
    "ok": true
  }
}
```

```json
{
  "evento": "media.result",
  "datos": {
    "request_id": "64c9725a-8411-4516-9d45-189e2a66a016",
    "tv_id": "TV-002",
    "accion": "media.play",
    "ok": false,
    "code": "TV_OFFLINE",
    "message": "La TV no está conectada"
  }
}
```

La TV también puede confirmar usando `media.result` con `request_id`, `tv_id`,
`accion` y `ok`. Si `ok=false`, puede incluir `code` y `message`. En ambos formatos
se valida que el socket sea el destinatario original. Peticiones distintas de la
misma acción se correlacionan por `request_id`; las respuestas duplicadas, ajenas
o que llegan después de finalizar la petición se ignoran.

Si falla, la TV envía `media.error` con `datos.tv_id` y `datos.message`. El backend
publica un error y no confirma éxito. Debe devolver el `request_id` original. También informa `FORBIDDEN`, `TV_OFFLINE`,
`INVALID_COMMAND`, `PLAYLIST_NOT_FOUND`, `CONTENT_NOT_FOUND`, `DOWNLOAD_FAILED`,
`PLAYBACK_FAILED`, `COMMAND_PENDING` o `PLAYBACK_TIMEOUT`: `media.result` con
`ok=false` para peticiones correlacionadas, `media.error` para el formato anterior.
Las órdenes `media.play` y `media.show` esperan hasta 15 minutos de forma
predeterminada, incluyendo la descarga. Se configura con
`PLAYBACK_DOWNLOAD_TIMEOUT_MS=900000`. Los controles restantes esperan 30 segundos.
El vencimiento solo finaliza la espera de confirmación; no cancela la descarga HTTP.
Las confirmaciones duplicadas o
sin orden pendiente se ignoran. Se conserva el flujo anterior de transferencias
`media.lista`, `media.lista.error`, y la presencia `devices.status`.
Los avisos antiguos `media.lista` con una URI local, sin una transferencia
pendiente, se ignoran: no generan `MEDIA_CONFIRM_ERROR` ni confirman reproducción.
Las descargas del protocolo nuevo se confirman con `media.result`.

`devices.status` se envía al conectar el panel, al cambiar la conexión de una TV o
al recibir `devices.status.request`. Conserva `datos.enline` y `datos.low_sengal`,
con objetos `{ "tv_id": "TV-001" }`. Una TV registrada ausente de ambas listas se
considera desconectada.

Los archivos eliminados por la limpieza diaria no pueden descargarse; el backend
devuelve error al preparar la orden. La limpieza y el CRUD de contenidos continúan
funcionando igual.

## Base de datos

La TV puede informar avance por `admin.message` con
`{ "evento": "media.progress", "datos": { "request_id": "UUID", "tv_id": "TV-001", "accion": "media.play", "porcentaje": 42 } }`.
El porcentaje debe ser un número de 0 a 100 que aumente durante la descarga
completa de la orden (en playlists, el total de archivos, sin reiniciarlo por cada
archivo). Cada avance válido renueva la espera y se reenvía al panel con
`estado: "DOWNLOADING"`. No genera éxito: la TV aún debe confirmar después de
iniciar la reproducción. Avances repetidos, ajenos o de peticiones terminadas
se ignoran. El soporte requiere que la TV emita progreso y el panel lo muestre.

El estado de TV añade `playlist_id` (UUID nullable) y `aleatorio` (booleano false).
Si `DB_SYNCHRONIZE=false`, ejecutar `database/20261025-playback.sql` antes de iniciar.

## Controles locales de la TV

La TV aplica el control local y publica por admin.message el mismo evento,
con datos.tv_id y origen: "tv", sin request_id. Ejemplo:

```json
{ "evento": "media.pause", "datos": { "tv_id": "TV-001", "origen": "tv" } }
```

El backend valida que el socket pertenezca a esa TV, guarda el estado y lo publica
solo a los administradores autorizados. No reenvía la acción a la TV. Los controles
locales que reemplazan órdenes remotas pendientes las finalizan con CANCELLED.
Las respuestas atrasadas de esas órdenes no deben revertir el estado del panel.
Las confirmaciones remotas conservan request_id y utilizan media.result.

Al conectar/reconectar el panel se recibe devices.status y el estado guardado de
cada TV, con volumen, repetición y aleatorio. Los eventos confirmados son la fuente
del estado; media.result resuelve la petición sin inferir ni sobrescribir ese estado.
La TV descarga por HTTP directo a archivos temporales, verifica Content-Length y
publica media.progress. El panel muestra ese avance y espera hasta 15 minutos,
renovando la espera con cada avance real.
