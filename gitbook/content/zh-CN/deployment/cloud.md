# ☁️ 云端部署

在服务器上运行 Vela 只改变了一件事，而且只改变一件事：它现在对其他机器可达，这也意味着它需要一个密码和一扇前门。其他一切 —— 提供商、组合、密钥 —— 都与本地运行时完全一样。

本指南涵盖已发布的 Docker 镜像（推荐路线）、VPS 安装、反向代理，以及打开端口之前要紧的安全清单。

---

## 🖥️ 在 VPS 上

### 前提条件

- Ubuntu 22.04 或更新版本，或任何相当的 Linux
- Node.js 20 或更新版本（使用 Docker 则跳过此项）
- `git`
- 拥有 `sudo` 权限的用户

### 第 1 步：安装 Node.js，然后安装 Vela

```bash
# Node.js 20+ —— 官方 NodeSource 脚本是一种选择
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vela
npm install -g vela
```

如果你更想从源码构建：

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

仓库根目录**就是**应用。没有嵌套的 `app/` 目录。

### 第 2 步：配置环境

把它们放进 shell 配置、systemd 单元，或应用旁的 `.env` 文件：

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # 为仪表盘会话签名
export INITIAL_PASSWORD="set-me-by-you"       # 占位符，不是密钥
export DATA_DIR="/var/lib/vela"
export NODE_ENV="production"
export PORT="32060"
```

`JWT_SECRET` 必须是新生成的，且至少 32 个字符；占位符会让 Vela 拒绝启动。

| 变量 | 作用 |
|----------|--------------|
| `JWT_SECRET` | 为仪表盘会话签名。请自行生成；绝不照抄教程里的。 |
| `INITIAL_PASSWORD` | 仪表盘的首次登录密码。可选，但在服务器上是应有之义。它是一份凭据：在运行时提供，绝不提交。 |
| `DATA_DIR` | 数据库所在的位置。默认为 `~/.vela`。 |
| `NODE_ENV` | 任何真实部署都设为 `production`。 |
| `ENABLE_REQUEST_LOGS` | 默认 `false`；只在调试时开启。 |
| `REQUIRE_API_KEY` | 开启时，没有有效密钥的请求会被拒绝。 |
| `VELA_BACKUP_*` | 可选的加密备份引擎；默认全部关闭。 |

完整列表见仓库中的 `.env.example` 与 `docs/ENVIRONMENT.md`。

### 第 3 步：数据目录

```bash
sudo mkdir -p /var/lib/vela
sudo chown $USER:$USER /var/lib/vela
```

### 第 4 步：在进程管理器下运行

```bash
sudo npm install -g pm2

pm2 start vela --name vela
pm2 save
pm2 startup      # 按它打印的那行操作，使其能在重启后存活
```

常用的 PM2 命令：

```bash
pm2 logs vela          # 跟踪输出
pm2 restart vela
pm2 stop vela
pm2 status
pm2 monit
```

### 第 5 步：设置仪表盘密码

**从服务器上**打开仪表盘 —— 例如通过 SSH 隧道（见下文）—— 前往 **设置 → 访问**，设置一个密码。在你这样做之前，远程浏览器会被拒绝，这是设计使然。

---

## 🐳 Docker 部署

已发布的镜像是最近的路，也是最该走的路。

### 已发布的镜像

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="set-me-by-you" \
  ghcr.io/yumamax3/vela:1.2.4
```

- `ghcr.io/yumamax3/vela` 是一个**公开**镜像。任何人都可以在不登录的情况下拉取；无需令牌。它不包含任何密钥 —— 每一个密钥都在运行时以环境变量提供，这正是它公开也安全的原因。
- **固定标签**（`:1.2.4`）。`:latest` 跟随发布变化，可能在某次重启后悄悄改变。
- **发布到 `127.0.0.1`**，当反向代理才是预期的入口时。这样原始端口根本不暴露在互联网上。
- **挂载 `/app/data`。** 没有这个卷，容器一旦被替换，一切都会消失。

### Docker Compose

仓库附带一个带文档的模板 `docker-compose.example.yml`。复制它、填入占位符，然后启动：

```bash
cp docker-compose.example.yml docker-compose.yml
# 编辑 docker-compose.yml：每一个 `set-me` 和每一个密钥
docker compose up -d
```

你自己的一份最小配置看起来像这样：

```yaml
services:
  vela:
    image: ghcr.io/yumamax3/vela:1.2.4
    container_name: vela
    restart: unless-stopped
    ports:
      - "127.0.0.1:32060:32060"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/app/data
      - JWT_SECRET=set-me-from-openssl-rand-hex-32   # 占位符，不是密钥
      - INITIAL_PASSWORD=set-me-by-you               # 占位符，不是密钥
    volumes:
      - vela-data:/app/data
    stop_grace_period: 30s

volumes:
  vela-data:
```

```bash
docker compose up -d          # 启动
docker compose logs -f        # 跟踪
docker compose down           # 停止
docker compose pull && docker compose up -d   # 更新
```

> 示例配置还提供一个可选的 MariaDB"双生"服务，用于 `mysql` / `mirror` 存储模式，以及一个可选的压缩 sidecar。两者都被注释掉或仅供内部使用；运行 Vela 并不需要任何一个。

### 构建你自己的镜像

仅当你需要修改代码时：

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
docker build -t vela-local:1.2.4 .
docker run -d --name vela -p 127.0.0.1:32060:32060 \
  -v vela-data:/app/data \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  vela-local:1.2.4
```

从源码构建比已发布镜像更慢、更大，而且会继承你机器上的一切。已发布的镜像由带标签的提交构建；你自己的镜像则由你自己的构成。

---

## 🌐 反向代理（Nginx）

为什么要费这个事：TLS、一个真正的域名，以及一个配置良好的单一入口，可以限制请求大小并添加请求头。

### 安装

```bash
sudo apt update
sudo apt install -y nginx
```

### 配置

创建 `/etc/nginx/sites-available/vela`：

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

    # Vela 默认将请求体上限设为 32 MB
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

        # 流式传输（SSE）—— 没有这些，回复会在最后一股脑到达
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

仪表盘与 `/v1` 都在同一个端口上，所以一个 `location` 就能覆盖它们。

### 启用并获取证书

```bash
sudo ln -s /etc/nginx/sites-available/vela /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

然后让你的工具指向 `https://your-domain.com/v1`。

---

## 🔒 安全清单

这份清单上的每一项都只需一分钟，却能避免最糟糕的一天。

### 1. 一个真正的 `JWT_SECRET`，和一个真正的密码

```bash
openssl rand -hex 32        # 粘贴到 JWT_SECRET
```

然后在 **设置 → 访问** 中设置仪表盘密码并开启 **要求仪表盘登录**。也请考虑 **要求 API Key**，让任何抵达 `/v1` 的东西都必须出示密钥。

### 2. 防火墙

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 仅当你不在代理之后时：
# sudo ufw allow 32060/tcp
sudo ufw enable
```

### 3. 让原始端口保持私密

如果 Nginx 是前门，Vela 应当只监听回环地址 —— 像上面示例那样以 `127.0.0.1:32060:32060` 发布。要在没有公网代理的机器上访问仪表盘：

```bash
ssh -L 32060:localhost:32060 you@your-server
# 然后在你自己的机器上打开 http://localhost:32060/dashboard
```

### 4. 按密钥的支出上限

每人或每个工具分发一把 API Key（**端点与密钥 → 创建密钥**），并为每一把设置 token 预算或支出上限。触达上限时，Vela 会给出明确的 `429`，而不是悄悄多花钱。

### 5. 有意识地更新

```bash
# 你所依赖的软件包
sudo apt update && sudo apt upgrade -y

# 从 git 检出
cd Vela && git pull && npm install && npm run build && pm2 restart vela

# Docker
docker compose pull && docker compose up -d
```

### 6. 备份数据目录

```bash
tar -czf vela-backup-$(date +%Y%m%d).tar.gz -C /var/lib vela
```

把它加入 cron，每夜复制一次。如果你启用了内置的加密备份，请记住丢失 `VELA_BACKUP_ENCRYPTION_KEY` 也就丢失了备份。

---

## 📊 监控

```bash
pm2 status
pm2 logs vela --lines 100
pm2 monit

docker compose logs -f --tail 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

curl -s http://127.0.0.1:32060/api/health      # {"ok":true}
```

容器自带一个轮询 `/api/health` 的健康检查，因此启动后 `docker ps` 会显示 `healthy`。

---

## 🚨 故障排查

### 它启动不了

```bash
pm2 logs vela          # 或：docker compose logs
ss -tlnp | grep 32060  # 端口上是不是有别的东西？
```

提到 `JWT_SECRET` 的启动拒绝，意思正是如此：生成一个长的随机密钥。

### Nginx 返回 502

Nginx 无法访问 Vela。检查 Vela 是否在运行（上面的 `curl`），`proxy_pass` 的端口是否匹配，以及错误日志：

```bash
sudo tail -f /var/log/nginx/error.log
```

### 流式传输不流式

缺少 `proxy_buffering off`，或者前面的 CDN 或 WAF 正在缓冲。两者都必须让事件通过。

### 远程登录被拒绝

那就是密码门。从 Vela 所在的机器设置密码（**设置 → 访问**），或提供 `INITIAL_PASSWORD` 并重启。

### 数据目录权限被拒绝

```bash
sudo chown -R $USER:$USER /var/lib/vela
chmod 755 /var/lib/vela
```

在 Docker 中，请确保挂载的宿主机目录对容器的 `node` 用户（uid 1000）可写。

---

## 📱 关于托管端点

你可能会在本文档较旧的页面中看到 `https://vela.my.id` 与 `https://vela.ai` 被提及为一个托管的 Vela 实例。它们是**项目所有者自己的部署**，在此作为上游事实记录，而不是本文档能够向你承诺的服务。阅读关于它们的任何内容时，请带着日期来理解。

对于你在意的任何事，请自行托管（本页）—— 或者使用你的提供商提供给你的托管实例，以及他们签发的 API Key。两种情况下工具配置一致；改变的只是基础 URL。

---

## 🔗 下一步

- [连接提供商](../providers/subscription.md)
- [构建组合](../features/combos.md)
- [让 Cursor 指向你的服务器](../integration/cursor.md)
- [故障排查](../troubleshooting.md)
