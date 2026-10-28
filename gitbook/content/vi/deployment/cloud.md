# ☁️ Triển khai Cloud

Chạy Vela trên một server thay đổi đúng một điều duy nhất: nó giờ có thể được các máy khác chạm tới, nghĩa là nó cần một mật khẩu và một cửa trước. Mọi thứ khác — nhà cung cấp, combos, key — hoạt động y hệt như khi chạy cục bộ.

Hướng dẫn này bao quát ảnh Docker được phát hành (con đường khuyến nghị), một bản cài trên VPS, một reverse proxy, và danh sách kiểm tra bảo mật quan trọng trước khi bạn mở cổng.

---

## 🖥️ Trên một VPS

### Điều kiện tiên quyết

- Ubuntu 22.04 trở lên, hoặc bất kỳ Linux tương đương
- Node.js 20 trở lên (bỏ qua nếu bạn dùng Docker)
- `git`
- Một người dùng có `sudo`

### Bước 1: cài Node.js, rồi cài Vela

```bash
# Node.js 20+ — the official NodeSource script is one option
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vela
npm install -g vela
```

Nếu bạn muốn build từ mã nguồn:

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

Gốc repository **chính là** ứng dụng. Không có thư mục `app/` lồng bên trong.

### Bước 2: cấu hình môi trường

Đặt những dòng này trong một hồ sơ shell, một unit systemd, hoặc một tệp `.env` cạnh ứng dụng:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="set-me-by-you"       # placeholder, not a secret
export DATA_DIR="/var/lib/vela"
export NODE_ENV="production"
export PORT="32060"
```

`JWT_SECRET` phải được tạo mới và dài ít nhất 32 ký tự; một giá trị giữ chỗ khiến Vela từ chối khởi động.

| Biến | Nó làm gì |
|----------|--------------|
| `JWT_SECRET` | Ký các phiên dashboard. Hãy tạo nó; không bao giờ dùng lại một cái từ hướng dẫn. |
| `INITIAL_PASSWORD` | Mật khẩu đăng nhập dashboard đầu tiên. Tuỳ chọn, nhưng được kỳ vọng trên một server. Đó là thông tin xác thực: hãy cấp nó lúc chạy, không bao giờ commit nó. |
| `DATA_DIR` | Nơi cơ sở dữ liệu sống. Mặc định `~/.vela`. |
| `NODE_ENV` | Đặt thành `production` cho mọi thứ thực sự. |
| `ENABLE_REQUEST_LOGS` | Mặc định `false`; chỉ bật khi gỡ lỗi. |
| `REQUIRE_API_KEY` | Khi bật, các request không có key hợp lệ bị từ chối. |
| `VELA_BACKUP_*` | Engine sao lưu mã hoá tuỳ chọn; mặc định đều tắt. |

Danh sách đầy đủ nằm trong `.env.example` của repository và `docs/ENVIRONMENT.md`.

### Bước 3: thư mục dữ liệu

```bash
sudo mkdir -p /var/lib/vela
sudo chown $USER:$USER /var/lib/vela
```

### Bước 4: chạy dưới một trình quản lý tiến trình

```bash
sudo npm install -g pm2

pm2 start vela --name vela
pm2 save
pm2 startup      # follow the line it prints, so it survives a reboot
```

Các lệnh PM2 hữu ích:

```bash
pm2 logs vela          # follow the output
pm2 restart vela
pm2 stop vela
pm2 status
pm2 monit
```

### Bước 5: đặt mật khẩu dashboard

Mở dashboard **từ chính server** — ví dụ qua một đường hầm SSH (xem bên dưới) — vào **Settings → Access**, và đặt một mật khẩu. Cho đến khi bạn làm thế, trình duyệt từ xa bị từ chối, theo thiết kế.

---

## 🐳 Triển khai Docker

Ảnh được phát hành là con đường ngắn nhất, và là con đường nên ưu tiên.

### Ảnh được phát hành

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="set-me-by-you" \
  ghcr.io/yumamax3/vela:1.2.4
```

- `ghcr.io/yumamax3/vela` là một ảnh **công khai**. Bất kỳ ai cũng kéo được mà không cần đăng nhập; không cần token. Nó không chứa bí mật nào — mọi bí mật được cấp như biến môi trường lúc chạy, đó chính là lý do nó an toàn khi công khai.
- **Ghim thẻ phiên bản** (`:1.2.4`). `:latest` đi theo các bản phát hành và có thể thay đổi dưới một lần khởi động lại.
- **Công bố ra `127.0.0.1`** khi một reverse proxy là cửa vào dự định. Như vậy cổng thô hoàn toàn không nằm trên internet.
- **Mount `/app/data`.** Không có volume, mọi thứ biến mất khi container bị thay thế.

### Docker Compose

Repository đi kèm một mẫu có tài liệu, `docker-compose.example.yml`. Hãy sao chép nó, điền các giá trị giữ chỗ, và khởi động:

```bash
cp docker-compose.example.yml docker-compose.yml
# edit docker-compose.yml: every `set-me` and every secret
docker compose up -d
```

Một bảng tối giản của riêng bạn trông như thế này:

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

> Bảng mẫu còn đưa ra một "người anh em song sinh" MariaDB tuỳ chọn cho các chế độ lưu trữ `mysql` / `mirror` và một sidecar nén tuỳ chọn. Cả hai đều bị comment hoặc chỉ dùng nội bộ; bạn không cần cái nào để chạy Vela.

### Tự build ảnh của bạn

Chỉ khi bạn cần sửa mã nguồn:

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

Build từ mã nguồn chậm hơn và lớn hơn ảnh được phát hành, và nó kế thừa mọi thứ trên máy của bạn. Ảnh được phát hành được build từ các commit đã gắn thẻ; ảnh của bạn được build từ commit của bạn.

---

## 🌐 Một reverse proxy (Nginx)

Vì sao phải bận tâm: TLS, một tên miền thật, và một cửa vào duy nhất được cấu hình tốt, có thể giới hạn kích thước request và thêm header.

### Cài đặt

```bash
sudo apt update
sudo apt install -y nginx
```

### Cấu hình

Tạo `/etc/nginx/sites-available/vela`:

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

Cả dashboard lẫn `/v1` đều nằm trên cùng một cổng, nên một `location` bao trùm cả hai.

### Bật nó và lấy một chứng chỉ

```bash
sudo ln -s /etc/nginx/sites-available/vela /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

Sau đó hướng các công cụ của bạn về `https://your-domain.com/v1`.

---

## 🔒 Danh sách kiểm tra bảo mật

Mọi mục trong danh sách này mất một phút và ngăn được ngày tồi tệ nhất.

### 1. Một `JWT_SECRET` thật, và một mật khẩu thật

```bash
openssl rand -hex 32        # paste into JWT_SECRET
```

Sau đó đặt một mật khẩu dashboard trong **Settings → Access** và bật **Require dashboard login**. Cũng nên cân nhắc **Require API key** để mọi thứ chạm tới `/v1` đều phải xuất trình một key.

### 2. Một tường lửa

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# only if you are NOT behind a proxy:
# sudo ufw allow 32060/tcp
sudo ufw enable
```

### 3. Giữ cổng thô riêng tư

Nếu Nginx là cửa trước, Vela chỉ nên lắng nghe trên loopback — công bố với `127.0.0.1:32060:32060` như trong các ví dụ trên. Để chạm tới dashboard trên một máy không có proxy công khai:

```bash
ssh -L 32060:localhost:32060 you@your-server
# then open http://localhost:32060/dashboard on your own machine
```

### 4. Ngưỡng chi tiêu theo từng key

Phát cho mỗi người hoặc mỗi công cụ một API key riêng (**Endpoint & Key → Create Key**) và đặt một ngân sách token hoặc ngưỡng chi tiêu cho từng cái. Khi chạm ngưỡng, Vela trả lời bằng một `429` rõ ràng thay vì lặng lẽ tiêu thêm.

### 5. Cập nhật một cách có chủ ý

```bash
# Packages you depend on
sudo apt update && sudo apt upgrade -y

# From a git checkout
cd Vela && git pull && npm install && npm run build && pm2 restart vela

# Docker
docker compose pull && docker compose up -d
```

### 6. Sao lưu thư mục dữ liệu

```bash
tar -czf vela-backup-$(date +%Y%m%d).tar.gz -C /var/lib vela
```

Thêm nó vào cron để có một bản sao hằng đêm. Nếu bạn bật các bản sao lưu mã hoá dựng sẵn, hãy nhớ rằng mất `VELA_BACKUP_ENCRYPTION_KEY` là mất luôn các bản sao lưu.

---

## 📊 Giám sát

```bash
pm2 status
pm2 logs vela --lines 100
pm2 monit

docker compose logs -f --tail 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

curl -s http://127.0.0.1:32060/api/health      # {"ok":true}
```

Container đi kèm một health check gọi `/api/health`, nên `docker ps` sẽ hiển thị `healthy` một khi nó đã lên.

---

## 🚨 Khắc phục sự cố

### Nó không khởi động

```bash
pm2 logs vela          # or: docker compose logs
ss -tlnp | grep 32060  # is something else on the port?
```

Một lần từ chối khởi động có nhắc đến `JWT_SECRET` nghĩa đúng như thế: hãy tạo một bí mật ngẫu nhiên dài.

### Nginx trả về 502

Nginx không chạm tới được Vela. Kiểm tra Vela đang chạy (`curl`, ở trên), rằng cổng `proxy_pass` khớp, và error log:

```bash
sudo tail -f /var/log/nginx/error.log
```

### Streaming không stream

Thiếu `proxy_buffering off`, hoặc một CDN hay WAF phía trước đang buffer. Cả hai đều phải cho các event đi qua.

### Đăng nhập từ xa bị từ chối

Đó là cổng mật khẩu. Hãy đặt một mật khẩu từ máy chạy Vela (**Settings → Access**), hoặc cung cấp `INITIAL_PASSWORD` và khởi động lại.

### Permission denied trên thư mục dữ liệu

```bash
sudo chown -R $USER:$USER /var/lib/vela
chmod 755 /var/lib/vela
```

Trong Docker, hãy chắc chắn thư mục trên host được mount là nơi người dùng `node` của container (uid 1000) ghi được.

---

## 📱 Về các endpoint được host

Bạn có thể thấy `https://vela.my.id` và `https://vela.ai` được nhắc đến trong những trang cũ hơn của tài liệu này như một phiên bản Vela được host. Đó là **các bản triển khai của chính chủ dự án**, được ghi ở đây như một sự thật thượng nguồn, không phải một dịch vụ mà tài liệu này có thể hứa với bạn. Hãy xem mọi thứ bạn đọc về chúng kèm một ngày tháng trong đầu.

Với bất cứ thứ gì bạn quan tâm, hãy tự host (trang này) — hoặc chạm tới phiên bản được host mà nhà cung cấp của bạn đã trao, với API key họ đã phát hành. Cấu hình công cụ giống hệt trong cả hai cách; chỉ base URL thay đổi.

---

## 🔗 Bước tiếp theo

- [Kết nối nhà cung cấp](../providers/subscription.md)
- [Dựng combos](../features/combos.md)
- [Hướng Cursor về server của bạn](../integration/cursor.md)
- [Khắc phục sự cố](../troubleshooting.md)
