# ☁️ Cloud Deployment

Running Vela on a server changes one thing and one thing only: it is now reachable by other machines, which means it needs a password and a front door. Everything else — providers, combos, keys — works exactly as it does locally.

This guide covers the published Docker image (the recommended path), a VPS install, a reverse proxy, and the security checklist that matters before you open the port.

---

## 🖥️ On a VPS

### Prerequisites

- Ubuntu 22.04 or newer, or any comparable Linux
- Node.js 20 or newer (skip this if you use Docker)
- `git`
- A user with `sudo`

### Step 1: install Node.js, then Vela

```bash
# Node.js 20+ — the official NodeSource script is one option
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vela
npm install -g vela
```

If you would rather build from source:

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

The repository root **is** the app. There is no nested `app/` directory.

### Step 2: configure the environment

Put these in a shell profile, a systemd unit, or a `.env` file beside the app:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="set-me-by-you"       # placeholder, not a secret
export DATA_DIR="/var/lib/vela"
export NODE_ENV="production"
export PORT="32060"
```

`JWT_SECRET` must be freshly generated and at least 32 characters; a placeholder makes Vela refuse to boot.

| Variable | What it does |
|----------|--------------|
| `JWT_SECRET` | Signs dashboard sessions. Generate it; never reuse one from a tutorial. |
| `INITIAL_PASSWORD` | The first dashboard login password. Optional, but expected on a server. It is a credential: supply it at run time, never commit it. |
| `DATA_DIR` | Where the database lives. Default `~/.vela`. |
| `NODE_ENV` | Set to `production` for anything real. |
| `ENABLE_REQUEST_LOGS` | `false` by default; turn on only while debugging. |
| `REQUIRE_API_KEY` | When on, requests without a valid key are rejected. |
| `VELA_BACKUP_*` | The optional encrypted backup engine; all off by default. |

The complete list is in the repository's `.env.example` and `docs/ENVIRONMENT.md`.

### Step 3: the data directory

```bash
sudo mkdir -p /var/lib/vela
sudo chown $USER:$USER /var/lib/vela
```

### Step 4: run it under a process manager

```bash
sudo npm install -g pm2

pm2 start vela --name vela
pm2 save
pm2 startup      # follow the line it prints, so it survives a reboot
```

Useful PM2 commands:

```bash
pm2 logs vela          # follow the output
pm2 restart vela
pm2 stop vela
pm2 status
pm2 monit
```

### Step 5: set the dashboard password

Open the dashboard **from the server** — for example through an SSH tunnel (see below) — go to **Settings → Access**, and set a password. Until you do, remote browsers are refused, by design.

---

## 🐳 Docker deployment

The published image is the shortest road, and it is the one to prefer.

### The published image

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="set-me-by-you" \
  ghcr.io/yumamax3/vela:1.2.5
```

- `ghcr.io/yumamax3/vela` is a **public** image. Anybody can pull it without logging in; no token is required. It contains no secrets — every secret is supplied as environment at run time, which is exactly why it is safe to be public.
- **Pin the tag** (`:1.2.5`). `:latest` follows releases and can change under a restart.
- **Publish to `127.0.0.1`** when a reverse proxy is the intended entrance. That way the raw port is not on the internet at all.
- **Mount `/app/data`.** Without the volume, everything vanishes when the container is replaced.

### Docker Compose

The repository ships a documented template, `docker-compose.example.yml`. Copy it, fill in the placeholders, and start:

```bash
cp docker-compose.example.yml docker-compose.yml
# edit docker-compose.yml: every `set-me` and every secret
docker compose up -d
```

A minimal chart of your own looks like this:

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

> The example chart also offers an optional MariaDB "twin" for the `mysql` / `mirror` storage modes and an optional compression sidecar. Both are commented or internal-only; you do not need either to run Vela.

### Building your own image

Only if you need to modify the code:

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

Building from source is slower and larger than the published image, and it inherits whatever is on your machine. The published image is built from tagged commits; your own image is built from yours.

---

## 🌐 A reverse proxy (Nginx)

Why bother: TLS, a real domain name, and a single well-configured entrance that can cap request sizes and add headers.

### Install

```bash
sudo apt update
sudo apt install -y nginx
```

### Configure

Create `/etc/nginx/sites-available/vela`:

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

Both the dashboard and `/v1` live on the same port, so one `location` covers them.

### Enable it and get a certificate

```bash
sudo ln -s /etc/nginx/sites-available/vela /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

Then point your tools at `https://your-domain.com/v1`.

---

## 🔒 Security checklist

Everything on this list takes a minute and prevents the worst day.

### 1. A real `JWT_SECRET`, and a real password

```bash
openssl rand -hex 32        # paste into JWT_SECRET
```

Then set a dashboard password under **Settings → Access** and turn on **Require dashboard login**. Also consider **Require API key** so that anything reaching `/v1` must present a key.

### 2. A firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# only if you are NOT behind a proxy:
# sudo ufw allow 32060/tcp
sudo ufw enable
```

### 3. Keep the raw port private

If Nginx is the front door, Vela should listen only on loopback — publish with `127.0.0.1:32060:32060` as in the examples above. To reach the dashboard on a box that has no public proxy:

```bash
ssh -L 32060:localhost:32060 you@your-server
# then open http://localhost:32060/dashboard on your own machine
```

### 4. Per-key spend ceilings

Hand out one API key per person or per tool (**Endpoint & Key → Create Key**) and set a token budget or spend cap on each. When a cap is reached, Vela answers with a clear `429` rather than quietly spending more.

### 5. Update deliberately

```bash
# Packages you depend on
sudo apt update && sudo apt upgrade -y

# From a git checkout
cd Vela && git pull && npm install && npm run build && pm2 restart vela

# Docker
docker compose pull && docker compose up -d
```

### 6. Back up the data directory

```bash
tar -czf vela-backup-$(date +%Y%m%d).tar.gz -C /var/lib vela
```

Add it to cron for a nightly copy. If you enable the built-in encrypted backups, remember that losing `VELA_BACKUP_ENCRYPTION_KEY` loses the backups too.

---

## 📊 Monitoring

```bash
pm2 status
pm2 logs vela --lines 100
pm2 monit

docker compose logs -f --tail 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

curl -s http://127.0.0.1:32060/api/health      # {"ok":true}
```

The container ships with a health check that polls `/api/health`, so `docker ps` will show `healthy` once it is up.

---

## 🚨 Troubleshooting

### It will not start

```bash
pm2 logs vela          # or: docker compose logs
ss -tlnp | grep 32060  # is something else on the port?
```

A refusal to boot that mentions `JWT_SECRET` means exactly that: generate a long random secret.

### Nginx returns 502

Nginx cannot reach Vela. Check Vela is running (`curl`, above), that the `proxy_pass` port matches, and the error log:

```bash
sudo tail -f /var/log/nginx/error.log
```

### Streaming does not stream

`proxy_buffering off` is missing, or a CDN or WAF in front is buffering. Both must pass events through.

### Remote login is refused

That is the password gate. Set a password from the Vela machine (**Settings → Access**), or provide `INITIAL_PASSWORD` and restart.

### Permission denied on the data directory

```bash
sudo chown -R $USER:$USER /var/lib/vela
chmod 755 /var/lib/vela
```

In Docker, make sure the mounted host directory is writable by the container's `node` user (uid 1000).

---

## 📱 About the hosted endpoints

You may see `https://vela.my.id` and `https://vela.ai` mentioned in older pages of this documentation as a hosted Vela instance. Those are **the project owner's own deployments**, noted here as an upstream fact, not a service this documentation can promise you. Treat anything you read about them with a date in mind.

For anything you care about, self-host (this page) — or reach the hosted instance your provider gave you, with the API key they issued. The tool configuration is identical either way; only the base URL changes.

---

## 🔗 Next steps

- [Connect providers](../providers/subscription.md)
- [Build combos](../features/combos.md)
- [Point Cursor at your server](../integration/cursor.md)
- [Troubleshooting](../troubleshooting.md)
