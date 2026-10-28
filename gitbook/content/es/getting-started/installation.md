# Instalación

Todo lo que necesitas para poner Vela en marcha: los requisitos, cuatro formas de instalarlo, cómo verificar que funciona y cómo quitarlo de nuevo. Si solo quieres tenerlo corriendo en dos minutos, [Inicio rápido](quick-start.md) es el camino más corto.

---

## Requisitos

### Requisitos del sistema

- **Node.js**: versión 20 o superior si lo instalas con npm. La imagen oficial de Docker incluye Node 22, así que los usuarios de Docker pueden saltarse esto.
- **npm**: versión 10 o superior (viene con Node.js).
- **Sistema operativo**: macOS, Linux o Windows (Windows funciona de forma nativa; WSL también sirve).
- **Disco**: unos 500MB para la aplicación, más para tus datos a medida que crece el historial de uso.
- **Memoria**: alrededor de 1GB es cómodo. La imagen de Docker fija un techo de 1GB de heap por defecto.

Comprueba lo que tienes:

```bash
node --version
# v20.x.x or newer

npm --version
# 10.x.x or newer
```

Si te falta Node.js, instálalo desde [nodejs.org](https://nodejs.org/) o con un gestor de versiones como `nvm`.

---

## Métodos de instalación

### Método 1: instalación global con npm (recomendado)

```bash
npm install -g vela
vela
```

El comando `vela` es un lanzador. Inicia la puerta de enlace, espera a que el puerto responda y abre el dashboard. Opciones que vale la pena conocer:

```bash
vela                    # start on the default port, open the browser
vela --port 8080        # a different port
vela --host 127.0.0.1   # this machine only (the default binds 0.0.0.0)
vela --no-browser       # do not open a browser
vela --log              # show server logs in the terminal
vela --tray             # run in the system tray
vela --skip-update      # skip the update check on start
vela --help             # everything else
```

**Por qué es la opción por defecto:**
- ✅ Ejecútalo desde cualquier directorio
- ✅ Un solo comando: `vela`
- ✅ `npm update -g vela` lo mantiene al día
- ✅ El lanzador reinicia un servidor caído y guarda sus binarios de ejecución en `~/.vela/runtime`, lejos del directorio de instalación

### Método 2: ejecutar sin instalar

Si solo quieres probarlo:

```bash
npx vela
```

Esto descarga el lanzador a la caché de npm y lo ejecuta. Nada se instala globalmente, pero el directorio de datos (`~/.vela`) sí se crea, y tus ajustes sobreviven entre ejecuciones.

### Método 3: Docker

Bueno para un servidor, un NAS, o cualquier cosa donde prefieras no instalar Node.js.

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.4
```

Luego abre **http://localhost:32060/dashboard**.

- La imagen es **pública**. No necesitas un inicio de sesión de GitHub, un token de acceso personal ni credencial alguna para descargarla.
- La imagen es multiarquitectura: se ejecuta de forma nativa tanto en servidores corrientes (`linux/amd64`) como en máquinas ARM, como una Raspberry Pi o un host Docker con Apple Silicon (`linux/arm64`).
- **Fija la etiqueta.** `ghcr.io/yumamax3/vela:1.2.4` es la versión actual. `:latest` se mueve cada vez que se publica una nueva versión, y entonces un reinicio puede colocarte en silencio en una versión que no elegiste.
- **Monta siempre `/app/data`.** Sin el volumen, tu base de datos vive dentro del contenedor y desaparece con él.

La [guía de despliegue en la nube](../deployment/cloud.md) cubre Compose, los proxies inversos y las variables de entorno en profundidad.

### Método 4: desde el código fuente

Para desarrollo, parches o para compilar tu propia imagen.

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

El proyecto está en la raíz del clon — no hay una carpeta `app/` anidada. Los scripts son:

```bash
npm run dev        # development server with hot reload, port 32060
npm run build      # production build
npm run start      # run the production build
```

`npm run dev` es para trabajar sobre Vela mismo. `npm run build` seguido de `npm run start` es lo que debe ejecutar un despliegue.

> ⚠️ **Una nota sobre las versiones:** si lo que compilaste se comporta distinto de esta documentación, comprueba `package.json` — su campo `version` es la verdad. Esta documentación describe la **1.2.4**.

---

## Primera ejecución

### Arrancar el servidor

```bash
vela
```

Qué ocurre:

1. La puerta de enlace arranca en `http://localhost:32060`.
2. El dashboard se abre en tu navegador en `/dashboard`.
3. Se crea un directorio de datos — `~/.vela` en macOS y Linux, `%APPDATA%\vela` en Windows — o el que nombre `DATA_DIR` si lo configuraste.
4. Nada más. **No hay contraseña por defecto** ni clave pregenerada.

### La contraseña del dashboard

Aquí es donde los tutoriales antiguos discrepan con Vela moderno, así que vale la pena decirlo sin rodeos:

- **No hay contraseña por defecto.** Ni `123456`, ni `admin`, ni ninguna otra.
- **El acceso local está abierto.** Desde la máquina que ejecuta Vela, el dashboard carga sin pedir nada. Es deliberado: no deberías tener que iniciar sesión en tu propio portátil.
- **El acceso remoto se rechaza hasta que la configures.** Si alguien abre el dashboard desde otra máquina de la red, Vela no le dejará entrar con una contraseña que nunca se eligió.

Para configurar una contraseña: abre el dashboard **desde la máquina que ejecuta Vela**, ve a **Settings → Access**, y configúrala allí. La misma pantalla te permite exigir un inicio de sesión para el dashboard, alternar si las solicitudes a la API deben llevar una clave, y ver de un vistazo si la puerta de enlace está "gated" — la marca que quieres antes de exponerla a una red.

Alternativamente, configura `INITIAL_PASSWORD` en el entorno antes del primer arranque; Vela lo aceptará como contraseña de inicio de sesión.

### Obtener una clave de API para tus herramientas

```
Dashboard → Endpoint & Key → Create Key
→ copy the key that appears (it is shown once)
```

Una clave tiene la forma `vela-v1-<random>-<checksum>`. En el mismo diálogo puedes darle un ámbito más estrecho: a qué proveedores, modelos o combos puede llegar; un límite de tasa; un presupuesto de tokens diario/semanal/mensual; y un techo de gasto. Para una configuración compartida o de larga duración, fija un techo — Vela responde con un 429 claro al alcanzarlo, en lugar de gastar en silencio.

---

## Verificar la instalación

### Comprobar que el servidor está vivo

```bash
curl http://localhost:32060/api/health
```

Esperado:

```json
{"ok":true}
```

La ruta de salud es intencionadamente sin autenticación, así que responde incluso cuando `REQUIRE_API_KEY` está activado.

### Listar los modelos a los que puedes llegar

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer vela-v1-your-key-here"
```

Obtendrás todos los modelos de todos los proveedores que hayas conectado. Si la lista está vacía, todavía no hay ningún proveedor conectado — consulta el paso 3 de [Inicio rápido](quick-start.md).

### Enviar una solicitud real

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer vela-v1-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm/glm-4.7",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

Una respuesta significa que todo — puerta de enlace, clave, proveedor, enrutamiento — está funcionando. Si falla, el texto del error indica el motivo; [Solución de problemas](../troubleshooting.md) relaciona los habituales con sus soluciones.

---

## Configuración

### Variables de entorno

Puedes configurarlas en tu shell, en un archivo `.env` junto a la aplicación, o como entorno del contenedor. Las que importan primero:

```bash
# Security — set these for any non-local deployment
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="your-password"       # optional first login password

# Storage
export DATA_DIR="$HOME/.vela"                 # where the database lives

# Server
export PORT="32060"                           # the default
export NODE_ENV="production"
```

`JWT_SECRET` merece una advertencia: desde octubre de 2026, Vela **se niega a arrancar** si se deja en un valor de ejemplo o tiene menos de 32 caracteres. Genera uno real. La lista completa de variables está en el `.env.example` del repositorio y en `docs/ENVIRONMENT.md`.

### Directorio de datos

Por defecto: `~/.vela` (macOS/Linux) o `%APPDATA%\vela` (Windows).

```text
~/.vela/
  db/
    data.sqlite        # providers, combos, keys, settings
    backups/           # pre-migration safety copies and scheduled backups
  logs/                # request logs, if enabled
  runtime/             # launcher-managed binaries
```

Para moverlo:

```bash
export DATA_DIR="/srv/vela-data"
vela
```

En Windows, una ruta estilo Unix (que empiece por `/`) se ignora con una advertencia y se usa la predeterminada — esa ruta no puede existir allí.

### Configuración del puerto

El valor por defecto es `32060`. Cámbialo con la opción o con el entorno:

```bash
vela --port 8080
# or
PORT=8080 vela
```

Si usas otro puerto, actualiza cada herramienta que apunte a `/v1` — y conserva el `/v1` final en la URL base.

---

## Solución de problemas de la instalación

### El puerto ya está en uso

```
Error: listen EADDRINUSE: address already in use :::32060
```

Encuentra y detén el proceso, o elige otro puerto:

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F

# or simply start elsewhere
vela --port 8080
```

### Permiso denegado

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'
```

La solución es dar a npm un directorio que posea, no usar `sudo`:

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Node.js demasiado antiguo

```
Error: The engine "node" is incompatible with this module
```

Actualiza Node.js — con `nvm` si lo tienes, o si no desde [nodejs.org](https://nodejs.org/):

```bash
nvm install 20
nvm use 20
```

### El dashboard no se abre

Abre `http://localhost:32060/dashboard` tú mismo. Si tampoco carga, comprueba que el proceso está en ejecución (`vela --log` muestra su salida) y revisa tu cortafuegos: en macOS, permite el proceso de Node en Ajustes del Sistema → Red → Cortafuegos; en Linux, revisa `ufw` o `iptables`; en Windows, permítelo en el Firewall de Windows Defender.

### Un proveedor no se conecta

- Comprueba que tienes conexión (`ping 1.1.1.1`).
- Revisa la página de estado del proveedor antes de suponer un fallo local.
- Para proveedores OAuth, prueba **Providers → [proveedor] → Disconnect → Connect** de nuevo; una sesión caducada a menudo se parece exactamente a una instalación rota.

### Uso elevado de memoria

Reinicia la puerta de enlace (`Ctrl+C`, y luego `vela`). Para una instalación de larga duración, usa un gestor de procesos:

```bash
npm install -g pm2
pm2 start vela --name vela
pm2 save
```

---

## Opciones de despliegue

### En tu propia máquina

```bash
npm install -g vela
vela
```

**Bueno para:** programación personal, probar proveedores, mantenerlo todo local.

### En un servidor

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="choose-a-password" \
  ghcr.io/yumamax3/vela:1.2.4
```

Escuchar en `127.0.0.1` significa que solo un proxy inverso en la misma máquina puede alcanzar el dashboard — la opción segura por defecto para un host expuesto a internet. [Despliegue en la nube](../deployment/cloud.md) tiene la configuración completa de Nginx, con los ajustes de transmisión que importan.

### Detrás de un proxy inverso

Las respuestas en transmisión (server-sent events) necesitan el búfer desactivado, o llegarán de golpe al final:

```nginx
location / {
    proxy_pass http://127.0.0.1:32060;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
```

---

## Desinstalar

```bash
npm uninstall -g vela      # remove the launcher
rm -rf ~/.vela             # remove data, keys and settings — this is irreversible
```

En Windows el directorio de datos es `%APPDATA%\vela`. Después, elimina cualquier exportación que hayas añadido al perfil de tu shell.

Si en cambio usaste Docker:

```bash
docker stop vela && docker rm vela
docker rmi ghcr.io/yumamax3/vela:1.2.4
# and remove the volume or host directory you mounted
```

---

## A dónde ir después

- [Inicio rápido](quick-start.md) — conectar proveedores y apuntar tus herramientas a Vela
- [Proveedores](../providers/subscription.md) — qué nivel usar y cuándo
- [Funciones](../features/smart-routing.md) — enrutamiento, combos, seguimiento de cuota
- [Solución de problemas](../troubleshooting.md) — cuando algo no se conecta

---

## ¿Necesitas ayuda?

- **Sitio web**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
