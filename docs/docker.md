# Levantar TV Control con Docker Compose

Desde el repositorio backend se inicia PostgreSQL, NestJS, Next.js y Nginx. Un servicio de inicialización crea el administrador solamente si la base todavía no tiene usuarios. La app Android se instala en la TV como siempre.

## Requisitos

- Docker con Compose v2; en Windows, Docker Desktop iniciado y configurado para contenedores Linux.
- Node.js 22 para generar la configuración inicial. Los servicios y sus dependencias se ejecutan dentro de Docker.
- Los repositorios backend y frontend deben estar en carpetas hermanas:

```text
projects/
  tvcontrol-backend/    # compose.yaml
  controltv/            # Dockerfile de Next.js
```

Si se descargan en otro equipo:

```powershell
git clone https://github.com/santosjared/controltv-backend.git tvcontrol-backend
git clone https://github.com/santosjared/controltv.git controltv
cd tvcontrol-backend
```

Si el frontend está en otra ubicación, editar `FRONTEND_CONTEXT` en `.env.docker` con esa ruta, relativa a este repositorio.

## Iniciar en dos comandos

Dentro de la carpeta backend:

```powershell
node docker/setup.mjs
docker compose --env-file .env.docker up -d --build
```

El primer comando crea `.env.docker` con claves aleatorias. Si ya existe, conserva sus valores. No cambia tu `.env` de desarrollo.

El segundo construye las imágenes, espera a que PostgreSQL y los servicios estén listos, inicializa el administrador y publica el panel.

- Panel: **http://localhost:3001**.
- Backend y TV: **http://localhost:3000**.
- Usuario inicial: el valor de `BOOTSTRAP_USER` (por defecto `admin`).
- Contraseña inicial: el valor de `BOOTSTRAP_PASSWORD` dentro de `.env.docker`.

En Windows puedes consultar ese archivo con `notepad .env.docker`. El servicio `admin-init` terminado con código 0 es normal: se ejecuta una vez y no debe permanecer corriendo.

Si los puertos 3000 o 3001 están ocupados por los procesos de desarrollo, detenerlos desde sus terminales o cambiar `BACKEND_PORT` / `WEB_PORT` antes de iniciar Compose. Cambiar los puertos publicados no requiere modificar el código ni recompilar las direcciones de Socket.IO.

## TV y otros equipos de la red

Para una TV física:

```text
Servidor: IP del equipo que ejecuta Docker, por ejemplo 192.168.1.50
Puerto: 3000, o el valor de BACKEND_PORT
```

En el emulador Android del mismo PC, usar `10.0.2.2:3000`.

Desde otro navegador de la red, abrir `http://IP-DEL-PC:3001`, o el valor de `WEB_PORT`. Nginx reenvía `/socket.io/` al backend y el panel utiliza el namespace relativo `/tvs`, así que no se guarda `localhost` en el JavaScript del navegador. Las peticiones HTTP del panel llegan al backend por la red interna de Compose (`http://backend:3000`). Las transferencias multipart pasan por Next.js para incluir el token del administrador sin exponerlo en el navegador.

Permitir los puertos publicados en el firewall del equipo si se accede desde otra máquina. La TV conserva las URL firmadas completas para descargar contenido.

## Consultar y detener

```powershell
docker compose --env-file .env.docker ps -a
docker compose --env-file .env.docker logs -f backend frontend gateway admin-init
docker compose --env-file .env.docker down
```

Para actualizar después de cambiar el código:

```powershell
docker compose --env-file .env.docker up -d --build
```

`down` conserva los volúmenes. No hace falta instalar pnpm, PostgreSQL ni dependencias del proyecto en el equipo anfitrión.

## Datos y configuración

- `postgres_data` conserva la base de datos y `media_data` conserva `/app/uploads`.
- Por defecto esta instalación usa una **base nueva y separada** de la que se ejecuta fuera de Docker. No importa ni modifica automáticamente tu base o archivos locales.
- La limpieza diaria de contenido de la aplicación sigue funcionando dentro de Docker; un volumen persistente no desactiva esa limpieza.
- Las transferencias temporales mantienen su ciclo de vida habitual y no se conservan entre reinicios del contenedor.
- `.env.docker` contiene credenciales privadas y está ignorado por Git y por el contexto de construcción de las imágenes. Conserva ese archivo al recrear los contenedores.
- Si ya hay usuarios en el volumen, `admin-init` los conserva y no cambia sus contraseñas. Modificar `BOOTSTRAP_PASSWORD` no cambia la contraseña de un administrador existente.
- `DB_SYNCHRONIZE=true` facilita el primer arranque en esta base local nueva. Antes de usar una base con datos de producción, preparar las migraciones del esquema y desactivar la sincronización automática. El script SQL existente de reproducción es incremental, no crea por sí solo todo el esquema.
- `AUTH_COOKIE_SECURE=false` permite iniciar sesión por HTTP en la red local. Si se publica detrás de HTTPS, usar `true`. El valor por defecto del frontend fuera de esta configuración continúa siendo Secure en producción.

## Validación realizada

Se verificó la sintaxis y estructura YAML, la generación de claves sin sobrescritura, las pruebas de sesión/Socket.IO y la compilación standalone de Next.js. No se pudo ejecutar `docker compose up` en el entorno de desarrollo porque el comando Docker no está instalado; la construcción de imágenes y el arranque completo quedan por comprobar en un equipo con Docker.
