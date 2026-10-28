# ☁️ Despliegue en la nube

Ejecutar Vela en un servidor cambia una sola cosa: ahora es alcanzable por otras máquinas, lo que significa que necesita una contraseña y una puerta de entrada. Todo lo demás — proveedores, combos, claves — funciona exactamente igual que en local.

Esta guía cubre la imagen Docker publicada (la ruta recomendada), una instalación en VPS, un proxy inverso, y la lista de seguridad que importa antes de abrir el puerto.

---

## 🖥️ En un VPS

### Requisitos previos

- Ubuntu 22.04 o superior, o cualquier Linux comparable
- Node.js 20 o superior (sáltate esto si usas Docker)
- `git`
- Un usuario con `sudo`

### Paso 1: instalar Node.js, y luego Vela

```bash
# Node.js 20+ — the official NodeSource script is one option
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vela
npm install -g vela
```

Si prefieres compilar desde el código fuente:

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

La raíz del repositorio **es** la aplicación. No hay un directorio `app/` anidado.

### Paso 2: configurar el entorno

Pon esto en un perfil de shell, una unidad de systemd o un archivo `.env` junto a la aplicación:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="set-me-by-you"       # placeholder, not a secret
export DATA_DIR="/var/lib/vela"
export NODE_ENV="production"
export PORT="32060"
```

`JWT_SECRET` debe generarse de nuevo y tener al menos 32 caracteres; un valor de ejemplo hace que Vela se niegue a arrancar.

| Variable | Qué hace |
|----------|--------------|
| `JWT_SECRET` | Firma las sesiones del dashboard. Genéralo; nunca reutilices uno de un tutorial. |
| `INITIAL_PASSWORD` | La primera contraseña de inicio de sesión del dashboard. Opcional, pero esperada en un servidor. Es una credencial: pásala en tiempo de ejecución, nunca hagas commit de ella. |
| `DATA_DIR` | Dónde vive la base de datos. Por defecto `~/.vela`. |
| `NODE_ENV` | Pon `production` para cualquier cosa real. |
| `ENABLE_REQUEST_LOGS` | `false` por defecto; actívalo solo mientras depuras. |
| `REQUIRE_API_KEY` | Cuando está activado, las solicitudes sin una clave válida se rechazan. |
| `VELA_BACKUP_*` | El motor opcional de copias de seguridad cifradas; todo desactivado por defecto. |

La lista completa está en el `.env.example` del repositorio y en `docs/ENVIRONMENT.md`.

### Paso 3: el directorio de datos

```bash
sudo mkdir -p /var/lib/vela
sudo chown $USER:$USER /var/lib/vela
```

### Paso 4: ejecutarlo bajo un gestor de procesos

```bash
sudo npm install -g pm2

pm2 start vela --name vela
pm2 save
pm2 startup      # follow the line it prints, so it survives a reboot
```

Comandos útiles de PM2:

```bash
pm2 logs vela          # follow the output
pm2 restart vela
pm2 stop vela
pm2 status
pm2 monit
```

### Paso 5: configurar la contraseña del dashboard

Abre el dashboard **desde el servidor** — por ejemplo a través de un túnel SSH (ver más abajo) — ve a **Settings → Access**, y configura una contraseña. Hasta que lo hagas, los navegadores remotos se rechazan, por diseño.

---

## 🐳 Despliegue con Docker

La imagen publicada es el camino más corto, y es la que conviene preferir.

### La imagen publicada

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="set-me-by-you" \
  ghcr.io/yumamax3/vela:1.2.5
```

- `ghcr.io/yumamax3/vela` es una imagen **pública**. Cualquiera puede descargarla sin iniciar sesión; no se requiere ningún token. No contiene secretos — cada secreto se pasa como variable de entorno en tiempo de ejecución, que es justo por lo que es seguro que sea pública.
- **Fija la etiqueta** (`:1.2.5`). `:latest` sigue a las versiones y puede cambiar bajo un reinicio.
- **Publica en `127.0.0.1`** cuando un proxy inverso sea la entrada prevista. Así el puerto crudo no está en internet en absoluto.
- **Monta `/app/data`.** Sin el volumen, todo desaparece cuando se reemplaza el contenedor.

### Docker Compose

El repositorio incluye una plantilla documentada, `docker-compose.example.yml`. Cópiala, rellena los marcadores de posición y arráncala:

```bash
cp docker-compose.example.yml docker-compose.yml
# edit docker-compose.yml: every `set-me` and every secret
docker compose up -d
```

Un gráfico mínimo propio tiene este aspecto:

```yaml
services:
  vela:
    image: ghcr.io/yumamax3/vela:1.2.5
    container_name: vela
    restart: unless-stopped
    ports:
      - "127.0.0.1:32060:32060"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/app/data
      - JWT_SECRET=set-me-from-openssl-rand-hex-32   # placeholder, not a secret
      - INITIAL_PASSWORD=set-me-by-you               # placeholder, not a secret
    volumes:
      - vela-data:/app/data
    stop_grace_period: 30s

volumes:
  vela-data:
```

```bash
docker compose up -d          # start
docker compose logs -f        # follow
docker compose down           # stop
docker compose pull && docker compose up -d   # update
```

> El gráfico de ejemplo ofrece además un "gemelo" MariaDB opcional para los modos de almacenamiento `mysql` / `mirror` y un sidecar de compresión opcional. Ambos están comentados o son solo internos; no necesitas ninguno de los dos para ejecutar Vela.

### Compilar tu propia imagen

Solo si necesitas modificar el código:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 32060
CMD ["npm", "run", "start"]
```

```bash
docker build -t vela-local:1.2.5 .
docker run -d --name vela -p 127.0.0.1:32060:32060 \
  -v vela-data:/app/data \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  vela-local:1.2.5
```

Compilar desde el código fuente es más lento y más pesado que la imagen publicada, y hereda lo que haya en tu máquina. La imagen publicada se compila desde commits etiquetados; la tuya se compila desde los tuyos.

---

## 🌐 Un proxy inverso (Nginx)

Por qué molestarse: TLS, un nombre de dominio real, y una única entrada bien configurada que puede limitar el tamaño de las solicitudes y añadir cabeceras.

### Instalar

```bash
sudo apt update
sudo apt install -y nginx
```

### Configurar

Crea `/etc/nginx/sites-available/vela`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Vela caps request bodies at 32 MB by default
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:32060;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Streaming (SSE) — without these, replies arrive in one lump at the end
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

Tanto el dashboard como `/v1` viven en el mismo puerto, así que un solo `location` cubre a ambos.

### Habilitarlo y obtener un certificado

```bash
sudo ln -s /etc/nginx/sites-available/vela /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

Luego apunta tus herramientas a `https://your-domain.com/v1`.

---

## 🔒 Lista de seguridad

Todo en esta lista lleva un minuto y evita el peor día.

### 1. Un `JWT_SECRET` real y una contraseña real

```bash
openssl rand -hex 32        # paste into JWT_SECRET
```

Luego configura una contraseña del dashboard en **Settings → Access** y activa **Require dashboard login**. Considera también **Require API key** para que cualquier cosa que llegue a `/v1` deba presentar una clave.

### 2. Un cortafuegos

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# only if you are NOT behind a proxy:
# sudo ufw allow 32060/tcp
sudo ufw enable
```

### 3. Mantén privado el puerto crudo

Si Nginx es la puerta de entrada, Vela debería escuchar solo en loopback — publica con `127.0.0.1:32060:32060` como en los ejemplos de arriba. Para alcanzar el dashboard en una máquina sin proxy público:

```bash
ssh -L 32060:localhost:32060 you@your-server
# then open http://localhost:32060/dashboard on your own machine
```

### 4. Techos de gasto por clave

Entrega una clave de API por persona o por herramienta (**Endpoint & Key → Create Key**) y fija en cada una un presupuesto de tokens o un tope de gasto. Cuando se alcanza un tope, Vela responde con un `429` claro en lugar de gastar más en silencio.

### 5. Actualiza con deliberación

```bash
# Packages you depend on
sudo apt update && sudo apt upgrade -y

# From a git checkout
cd Vela && git pull && npm install && npm run build && pm2 restart vela

# Docker
docker compose pull && docker compose up -d
```

### 6. Haz copia de seguridad del directorio de datos

```bash
tar -czf vela-backup-$(date +%Y%m%d).tar.gz -C /var/lib vela
```

Añádelo a cron para una copia nocturna. Si activas las copias de seguridad cifradas integradas, recuerda que perder `VELA_BACKUP_ENCRYPTION_KEY` es perder también las copias.

---

## 📊 Monitoreo

```bash
pm2 status
pm2 logs vela --lines 100
pm2 monit

docker compose logs -f --tail 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

curl -s http://127.0.0.1:32060/api/health      # {"ok":true}
```

El contenedor incluye una comprobación de salud que consulta `/api/health`, así que `docker ps` mostrará `healthy` una vez que esté en marcha.

---

## 🚨 Solución de problemas

### No arranca

```bash
pm2 logs vela          # or: docker compose logs
ss -tlnp | grep 32060  # is something else on the port?
```

Una negativa a arrancar que menciona `JWT_SECRET` significa exactamente eso: genera un secreto largo y aleatorio.

### Nginx devuelve 502

Nginx no puede alcanzar Vela. Comprueba que Vela está en ejecución (`curl`, arriba), que el puerto de `proxy_pass` coincide, y el registro de errores:

```bash
sudo tail -f /var/log/nginx/error.log
```

### La transmisión no se transmite

Falta `proxy_buffering off`, o una CDN o un WAF delante está almacenando en búfer. Ambos deben dejar pasar los eventos.

### Se rechaza el inicio de sesión remoto

Esa es la puerta de la contraseña. Configura una contraseña desde la máquina de Vela (**Settings → Access**), o proporciona `INITIAL_PASSWORD` y reinicia.

### Permiso denegado en el directorio de datos

```bash
sudo chown -R $USER:$USER /var/lib/vela
chmod 755 /var/lib/vela
```

En Docker, asegúrate de que el directorio del host montado sea escribible por el usuario `node` del contenedor (uid 1000).

---

## 📱 Sobre los endpoints alojados

Puede que veas `https://vela.my.id` y `https://vela.ai` mencionados en páginas antiguas de esta documentación como una instancia alojada de Vela. Esos son **los despliegues del propio propietario del proyecto**, señalados aquí como un dato upstream, no como un servicio que esta documentación pueda prometerte. Trata cualquier cosa que leas sobre ellos con una fecha en mente.

Para cualquier cosa que te importe, alójalo tú mismo (esta página) — o alcanza la instancia alojada que te dio tu proveedor, con la clave de API que emitió. La configuración de la herramienta es idéntica en ambos casos; solo cambia la URL base.

---

## 🔗 A dónde ir después

- [Conectar proveedores](../providers/subscription.md)
- [Construir combos](../features/combos.md)
- [Apuntar Cursor a tu servidor](../integration/cursor.md)
- [Solución de problemas](../troubleshooting.md)
