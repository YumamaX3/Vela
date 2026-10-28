# 🏠 Despliegue en localhost

Ejecutar Vela en tu propia máquina es lo predeterminado, lo más fácil y lo que menos formas tiene de salir mal. Esta página cubre el día a día: arrancarlo, detenerlo, mover sus datos, actualizarlo, y los dos o tres problemas que surgen con más frecuencia.

Si todavía no lo has instalado, empieza por [Instalación](../getting-started/installation.md).

---

## 📦 Instalación

```bash
npm install -g vela
```

**Requisitos:**
- Node.js 20 o superior
- npm 10 o superior (viene con Node.js)

---

## 🚀 Arrancar el servidor

```bash
vela
```

El dashboard se abre solo en **http://localhost:32060/dashboard**.

**Configuración por defecto:**

| Qué | Dónde |
|-|-|
| **Dashboard** | `http://localhost:32060/dashboard` |
| **Endpoint de la API** | `http://localhost:32060/v1` |
| **Puerto por defecto** | `32060` |
| **Directorio de datos** | `~/.vela` (macOS/Linux) · `%APPDATA%\vela` (Windows) |
| **Contraseña del dashboard** | ninguna por defecto — ver más abajo |

Un solo proceso sirve tanto el dashboard como la API. No hay un segundo puerto que recordar.

### Sobre la contraseña

En el Vela actual **no hay contraseña por defecto**. Desde la propia máquina, el dashboard se abre sin ninguna. Los navegadores remotos se rechazan hasta que configures una contraseña en **Settings → Access** — una respuesta directa a todos los que alguna vez publicaron `123456` como valor por defecto y se arrepintieron.

Si quieres un inicio de sesión incluso en local, configúralo en **Settings → Access** (o configura `INITIAL_PASSWORD` antes del primer arranque) y activa **Require dashboard login**.

### Sobre la red

Por defecto el lanzador escucha en `0.0.0.0`, lo que significa que otras máquinas de tu red pueden alcanzar el puerto. Para una configuración puramente local:

```bash
vela --host 127.0.0.1
```

---

## 🔧 Configuración

### Un directorio de datos personalizado

```bash
DATA_DIR=/path/to/data vela
```

En Windows, usa una ruta nativa como `D:\vela-data`; una ruta estilo Unix allí se ignora con una advertencia.

### Un puerto personalizado

```bash
vela --port 8080
# or
PORT=8080 vela
```

Todo lo que hable con Vela — tu editor, tus scripts — debe entonces usar `http://localhost:8080/v1`.

### Un host personalizado

```bash
vela --host 127.0.0.1    # this machine only
vela --host 0.0.0.0      # all interfaces (the default)
```

---

## 🛑 Detener el servidor

Pulsa `Ctrl+C` en la terminal que lo ejecuta. La puerta de enlace drena las solicitudes en curso antes de salir, así que una respuesta en transmisión termina en lugar de cortarse a la mitad.

Si se arrancó en segundo plano o mediante un gestor de procesos:

```bash
pm2 stop vela         # if you used PM2
pkill -f vela         # last resort
```

---

## 🔄 Reiniciar

```bash
vela
```

Los proveedores, claves, combos, presupuestos e historial de uso sobreviven — viven en el directorio de datos, no en memoria.

---

## 📊 Actualizar

```bash
npm update -g vela
```

Comprueba qué estás ejecutando:

```bash
npm list -g vela
```

Para la ruta de Docker, descarga explícitamente la etiqueta más nueva:

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run the same docker run command with the new tag
```

Las migraciones de la base de datos se ejecutan automáticamente al arrancar, con una copia de seguridad tomada antes en `~/.vela/db/backups/`. Aun así, haz una copia de seguridad antes de una actualización mayor.

---

## 🔍 Solución de problemas

### El puerto ya está en uso

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F
```

O simplemente ejecuta en otro puerto: `vela --port 8080`.

### Errores de permisos al instalar

```bash
# Give npm a directory it owns (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### El directorio de datos no es escribible

```bash
ls -la ~/.vela
chmod 755 ~/.vela
```

Si sigue fallando, apunta `DATA_DIR` a un directorio que poseas.

### El dashboard no carga desde otra máquina

Esa es la puerta de la contraseña haciendo su trabajo. O lo abres en la máquina de Vela y configuras una contraseña en **Settings → Access**, o lo mantienes local con `vela --host 127.0.0.1` y lo alcanzas a través de un túnel SSH:

```bash
ssh -L 32060:localhost:32060 you@the-vela-machine
# then open http://localhost:32060/dashboard
```

---

## 📁 El directorio de datos

```text
~/.vela/
├── db/
│   ├── data.sqlite     # providers, keys, combos, settings, usage
│   └── backups/        # pre-migration copies and any scheduled backups
├── logs/               # request logs, when enabled
└── runtime/            # binaries the launcher manages
```

**Hacer una copia de seguridad es simplemente copiar el directorio** — idealmente con Vela detenido, para que el write-ahead log de SQLite se haya asentado:

```bash
# While Vela is stopped:
cp -r ~/.vela ~/.vela.backup

# Restore (with Vela stopped):
rm -rf ~/.vela && cp -r ~/.vela.backup ~/.vela
```

Para copias de seguridad programadas y cifradas, Vela tiene un motor integrado — consulta las variables de copia de seguridad en `.env.example` (`VELA_BACKUP_*`). Guarda `VELA_BACKUP_ENCRYPTION_KEY` en un lugar donde todavía lo tengas dentro de un año; perderlo hace que las copias queden ilegibles para siempre.

---

## 🔗 A dónde ir después

- [Conectar proveedores](../providers/subscription.md)
- [Construir una cadena de fallback](../features/combos.md)
- [Apuntar tu editor a Vela](../integration/cursor.md)
- [Ir a remoto: despliegue en la nube](cloud.md)
