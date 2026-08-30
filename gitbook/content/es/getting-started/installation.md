# Instalación

Guía detallada de instalación de Vela con consejos de solución de problemas.

---

## Requisitos

### Requisitos del sistema

- **Node.js**: Versión 20.0.0 o superior
- **npm**: Versión 10.0.0 o superior (viene con Node.js)
- **OS**: macOS, Linux, Windows (WSL recomendado)
- **Espacio en disco**: ~200MB para la instalación

### Verifica tu versión

```bash
node --version
# Debería mostrar v20.x.x o superior

npm --version
# Debería mostrar 10.x.x o superior
```

**¿No tienes Node.js?** Instálalo desde [nodejs.org](https://nodejs.org/)

---

## Métodos de instalación

### Método 1: Instalación global (Recomendado)

Instala Vela globalmente para usar desde cualquier lugar:

```bash
npm install -g vela
```

**Iniciar Vela:**

```bash
Vela
```

**Beneficios:**
- ✅ Ejecuta desde cualquier directorio
- ✅ Comando simple: `Vela`
- ✅ Auto-actualizaciones con `npm update -g Vela`

### Método 2: Instalación local

Instala en un proyecto específico:

```bash
mkdir my-Vela
cd my-Vela
npm install -g vela
```

**Iniciar Vela:**

```bash
npx Vela
```

**Beneficios:**
- ✅ Aislado por proyecto
- ✅ Control de versiones por proyecto
- ✅ Sin contaminación del namespace global

### Método 3: Desde el código fuente (Desarrollo)

Clona y compila desde GitHub:

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela/app
npm install
npm run build
npm start
```

**Beneficios:**
- ✅ Últimas características de desarrollo
- ✅ Contribuir al desarrollo
- ✅ Modificaciones personalizadas

---

## Primera ejecución

### Iniciar el servidor

```bash
Vela
```

**Qué sucede:**
1. El servidor inicia en `http://localhost:32060`
2. El dashboard se abre automáticamente en el navegador
3. Se crea el directorio de datos en `~/.Vela`
4. API key generada automáticamente

### Login del dashboard

**Credenciales por defecto:**
- Contraseña: `123456`

**⚠️ Cambia la contraseña inmediatamente:**
1. Inicia sesión en el dashboard
2. Settings → Change Password
3. Usa una contraseña fuerte

### Obtén tu API key

```
Dashboard → Settings → API Keys
→ Copia tu API key
→ Úsala en herramientas CLI
```

**Ejemplo de formato de API key:**
```
9r_1234567890abcdef1234567890abcdef
```

---

## Verificar la instalación

### Verifica el estado del servidor

```bash
curl http://localhost:32060/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### Lista los modelos disponibles

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**Respuesta esperada:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### Prueba el chat completion

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## Configuración

### Variables de entorno

Crea un archivo `.env` o establece variables de entorno:

```bash
# Security (REQUIRED in production)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# Storage
export DATA_DIR="~/.Vela"

# Server
export PORT="32060"
export NODE_ENV="production"

# Logging
export ENABLE_REQUEST_LOGS="false"
```

### Directorio de datos

**Ubicación por defecto:** `~/.Vela`

**Contenido:**
```
~/.Vela/
  ├── db.json           # Database (providers, combos, usage)
  ├── api-keys.json     # API keys
  └── logs/             # Request logs (if enabled)
```

**Cambiar ubicación:**

```bash
export DATA_DIR="/custom/path"
Vela
```

### Configuración de puerto

**Puerto por defecto:** `32060`

**Cambiar puerto:**

```bash
export PORT="3000"
Vela
```

**O usa la línea de comandos:**

```bash
Vela --port 3000
```

---

## Solución de problemas

### Puerto ya en uso

**Error:**
```
Error: listen EADDRINUSE: address already in use :::32060
```

**Solución 1: Mata el proceso existente**

```bash
# Encuentra proceso usando el puerto 32060
lsof -i :32060

# Mata el proceso
kill -9 <PID>
```

**Solución 2: Usa otro puerto**

```bash
Vela --port 3000
```

### Permiso denegado

**Error:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/Vela'
```

**Solución: Usa sudo (no recomendado) o corrige los permisos de npm**

```bash
# Corregir permisos de npm (recomendado)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Luego instalar nuevamente
npm install -g vela
```

### Versión de Node.js muy antigua

**Error:**
```
Error: The engine "node" is incompatible with this module
```

**Solución: Actualizar Node.js**

```bash
# Usando nvm (recomendado)
nvm install 20
nvm use 20

# O descargar desde nodejs.org
```

### El dashboard no se abre

**Problema:** El dashboard no se abre automáticamente

**Solución 1: Abrir manualmente**

```
http://localhost:32060
```

**Solución 2: Verifica el firewall**

```bash
# macOS: Permitir Node.js en System Preferences → Security
# Linux: Verificar iptables
# Windows: Verificar Windows Firewall
```

### No se puede conectar a proveedores

**Problema:** El login OAuth falla o la API key es inválida

**Solución 1: Verifica la conexión a internet**

```bash
ping google.com
```

**Solución 2: Verifica el estado del proveedor**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**Solución 3: Regenera la API key**

```
Dashboard → Provider → Disconnect → Reconnect
```

### Uso alto de memoria

**Problema:** Vela usa demasiada RAM

**Solución: Reinicia el servidor**

```bash
# Detener
pkill -f Vela

# Iniciar
Vela
```

**O usa PM2 para auto-reinicio:**

```bash
npm install -g pm2
pm2 start Vela --name Vela
pm2 save
```

---

## Opciones de despliegue

### Desarrollo local

```bash
npm install -g vela
Vela
```

**Caso de uso:** Codificación personal, pruebas

### Servidor VPS/Cloud

```bash
# Instalar
npm install -g vela

# Configurar
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# Iniciar con PM2
npm install -g pm2
pm2 start Vela --name Vela
pm2 save
pm2 startup
```

**Caso de uso:** Acceso de equipo, codificación remota

### Docker

```bash
docker pull Vela/Vela:latest

docker run -d \
  -p 32060:32060 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v Vela-data:/root/.Vela \
  --name Vela \
  Vela/Vela:latest
```

**Caso de uso:** Despliegue containerizado, Kubernetes

### Proxy reverso (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:32060;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**Caso de uso:** HTTPS, dominio personalizado, balanceo de carga

---

## Desinstalación

### Eliminar instalación global

```bash
npm uninstall -g Vela
```

### Eliminar el directorio de datos

```bash
rm -rf ~/.Vela
```

### Eliminar la configuración

```bash
# Eliminar variables de entorno del archivo de configuración del shell
nano ~/.bashrc  # o ~/.zshrc
# Eliminar exports relacionados con Vela
```

---

## Próximos pasos

- [Guía para empezar](../getting-started.md) - Conecta proveedores y comienza a codificar
- [Características](../features/) - Explora seguimiento de cuota, combos, despliegue
- [Solución de problemas](../troubleshooting.md) - Resuelve problemas comunes

---

## ¿Necesitas ayuda?

- **Sitio web**: [vela.ai](https://vela.ai)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
