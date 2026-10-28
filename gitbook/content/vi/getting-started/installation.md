# Cài đặt

Mọi thứ bạn cần để chạy Vela: các yêu cầu, bốn cách cài đặt, cách xác minh nó hoạt động, và cách gỡ nó ra. Nếu bạn chỉ muốn nó chạy trong hai phút, [Bắt đầu nhanh](quick-start.md) là con đường ngắn hơn.

---

## Yêu cầu

### Yêu cầu hệ thống

- **Node.js**: phiên bản 20 trở lên nếu bạn cài qua npm. Ảnh Docker chính thức đóng gói sẵn Node 22, nên người dùng Docker có thể bỏ qua mục này.
- **npm**: phiên bản 10 trở lên (đi kèm Node.js).
- **Hệ điều hành**: macOS, Linux, hoặc Windows (Windows chạy gốc; WSL cũng dùng được).
- **Ổ đĩa**: khoảng 500MB cho ứng dụng, nhiều hơn cho dữ liệu khi lịch sử dùng tăng lên.
- **Bộ nhớ**: khoảng 1GB là thoải mái. Ảnh Docker mặc định đặt trần heap 1GB.

Kiểm tra những gì bạn đang có:

```bash
node --version
# v20.x.x or newer

npm --version
# 10.x.x or newer
```

Nếu chưa có Node.js, hãy cài từ [nodejs.org](https://nodejs.org/) hoặc bằng một trình quản lý phiên bản như `nvm`.

---

## Các phương thức cài đặt

### Phương thức 1: cài toàn cục qua npm (khuyến nghị)

```bash
npm install -g vela
vela
```

Lệnh `vela` là một trình khởi chạy. Nó khởi động gateway, chờ cổng trả lời, và mở dashboard. Những cờ đáng biết:

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

**Tại sao đây là lựa chọn mặc định:**
- ✅ Chạy được từ bất kỳ thư mục nào
- ✅ Một lệnh duy nhất: `vela`
- ✅ `npm update -g vela` giữ nó luôn mới
- ✅ Trình khởi chạy tự khởi động lại server bị crash và giữ các binary runtime trong `~/.vela/runtime`, tách khỏi thư mục cài đặt

### Phương thức 2: chạy mà không cần cài

Nếu bạn chỉ muốn thử:

```bash
npx vela
```

Lệnh này tải trình khởi chạy vào cache của npm và chạy nó. Không có gì được cài toàn cục, nhưng thư mục dữ liệu (`~/.vela`) vẫn được tạo, và các cài đặt của bạn còn nguyên giữa các lần chạy.

### Phương thức 3: Docker

Tốt cho một server, một NAS, hoặc bất cứ nơi nào bạn không muốn cài Node.js.

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.4
```

Sau đó mở **http://localhost:32060/dashboard**.

- Ảnh này là **công khai**. Bạn không cần đăng nhập GitHub, personal access token, hay bất kỳ thông tin xác thực nào để kéo nó.
- Ảnh hỗ trợ nhiều kiến trúc: nó chạy gốc trên cả server thông thường (`linux/amd64`) lẫn các máy ARM như Raspberry Pi hay máy chủ Docker Apple Silicon (`linux/arm64`).
- **Ghim thẻ phiên bản.** `ghcr.io/yumamax3/vela:1.2.4` là bản phát hành hiện tại. `:latest` di chuyển mỗi khi một phiên bản mới được phát hành, và một lần khởi động lại có thể lặng lẽ đưa bạn sang một phiên bản bạn không chọn.
- **Luôn mount `/app/data`.** Không có volume, cơ sở dữ liệu của bạn sống trong container và biến mất cùng nó.

[Hướng dẫn triển khai cloud](../deployment/cloud.md) bao quát Compose, reverse proxy và các biến môi trường một cách sâu sắc.

### Phương thức 4: từ mã nguồn

Cho phát triển, vá lỗi, hoặc tự build ảnh của riêng bạn.

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

Dự án nằm ngay gốc bản clone — không có thư mục `app/` lồng bên trong. Các script là:

```bash
npm run dev        # development server with hot reload, port 32060
npm run build      # production build
npm run start      # run the production build
```

`npm run dev` để làm việc trên chính Vela. `npm run build` rồi `npm run start` là thứ một bản triển khai nên chạy.

> ⚠️ **Một lưu ý về phiên bản:** nếu bản bạn build có hành vi khác với tài liệu này, hãy kiểm tra `package.json` — trường `version` của nó là sự thật. Tài liệu này mô tả **1.2.4**.

---

## Lần chạy đầu tiên

### Khởi động server

```bash
vela
```

Điều gì xảy ra:

1. Gateway khởi động tại `http://localhost:32060`.
2. Dashboard mở trong trình duyệt tại `/dashboard`.
3. Một thư mục dữ liệu được tạo — `~/.vela` trên macOS và Linux, `%APPDATA%\vela` trên Windows — hoặc thư mục do `DATA_DIR` chỉ định nếu bạn có đặt.
4. Không gì khác. **Không có mật khẩu mặc định** và không có key nào được tạo sẵn.

### Mật khẩu dashboard

Đây là chỗ các hướng dẫn cũ mâu thuẫn với Vela hiện đại, nên cần nói thẳng:

- **Không có mật khẩu mặc định.** Không phải `123456`, không phải `admin`, không phải bất cứ thứ gì khác.
- **Truy cập cục bộ đang mở.** Từ chính máy đang chạy Vela, dashboard tải mà không hỏi gì. Đó là chủ ý: bạn không nên phải đăng nhập vào chiếc laptop của chính mình.
- **Truy cập từ xa bị từ chối cho đến khi bạn đặt một mật khẩu.** Nếu ai đó mở dashboard từ một máy khác trên mạng, Vela sẽ không cho họ vào bằng một mật khẩu chưa từng được chọn.

Để đặt mật khẩu: mở dashboard **từ máy đang chạy Vela**, vào **Settings → Access**, và đặt mật khẩu ở đó. Cùng màn hình ấy cho phép bạn bắt buộc đăng nhập dashboard, bật/tắt việc các request API phải mang theo key, và nhìn thấy ngay gateway có "gated" (đã đóng cổng) hay chưa — dấu tích bạn muốn có trước khi phơi nó ra một mạng lưới.

Cách khác, hãy đặt `INITIAL_PASSWORD` trong môi trường trước lần khởi động đầu tiên; Vela sẽ chấp nhận nó làm mật khẩu đăng nhập.

### Lấy một API key cho các công cụ của bạn

```
Dashboard → Endpoint & Key → Create Key
→ copy the key that appears (it is shown once)
```

Một key có dạng `vela-v1-<random>-<checksum>`. Trong cùng hộp thoại, bạn có thể thu hẹp phạm vi của nó: được chạm tới những nhà cung cấp, model hay combo nào; một rate limit; một ngân sách token theo ngày/tuần/tháng; và một ngưỡng chi tiêu. Với một thiết lập dùng chung hoặc chạy lâu dài, hãy đặt một ngưỡng — Vela trả lời bằng một mã 429 rõ ràng khi chạm ngưỡng thay vì lặng lẽ tiêu tiền.

---

## Xác minh bản cài đặt

### Kiểm tra server còn sống

```bash
curl http://localhost:32060/api/health
```

Mong đợi:

```json
{"ok":true}
```

Route health được cố ý để không cần xác thực, nên nó vẫn trả lời ngay cả khi `REQUIRE_API_KEY` đang bật.

### Liệt kê các model bạn chạm tới được

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer vela-v1-your-key-here"
```

Bạn sẽ nhận được mọi model từ mọi nhà cung cấp đã kết nối. Nếu danh sách trống, chưa có nhà cung cấp nào được kết nối — xem bước 3 của [Bắt đầu nhanh](quick-start.md).

### Gửi một request thật

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer vela-v1-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm/glm-4.7",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

Một phản hồi nghĩa là mọi thứ — gateway, key, nhà cung cấp, định tuyến — đang hoạt động. Nếu nó thất bại, nội dung lỗi nói rõ nguyên nhân; [Khắc phục sự cố](../troubleshooting.md) ánh xạ những lỗi phổ biến sang cách sửa.

---

## Cấu hình

### Biến môi trường

Bạn có thể đặt chúng trong shell, trong một tệp `.env` cạnh ứng dụng, hoặc như môi trường container. Những cái quan trọng trước tiên:

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

`JWT_SECRET` xứng đáng một lời cảnh báo: kể từ tháng Mười năm 2026, Vela **từ chối khởi động** nếu nó còn là một giá trị giữ chỗ hoặc ngắn hơn 32 ký tự. Hãy tạo một cái thật. Danh sách đầy đủ các biến nằm trong `.env.example` của repository và `docs/ENVIRONMENT.md`.

### Thư mục dữ liệu

Mặc định: `~/.vela` (macOS/Linux) hoặc `%APPDATA%\vela` (Windows).

```text
~/.vela/
  db/
    data.sqlite        # providers, combos, keys, settings
    backups/           # pre-migration safety copies and scheduled backups
  logs/                # request logs, if enabled
  runtime/             # launcher-managed binaries
```

Để di chuyển nó:

```bash
export DATA_DIR="/srv/vela-data"
vela
```

Trên Windows, một đường dẫn kiểu Unix (bắt đầu bằng `/`) bị bỏ qua kèm cảnh báo và đường dẫn mặc định được dùng — đường dẫn ấy không thể tồn tại ở đó.

### Cấu hình cổng

Mặc định là `32060`. Đổi bằng cờ hoặc biến môi trường:

```bash
vela --port 8080
# or
PORT=8080 vela
```

Nếu bạn dùng cổng khác, hãy cập nhật mọi công cụ trỏ đến `/v1` — và giữ lại đoạn `/v1` ở cuối base URL.

---

## Khắc phục sự cố cài đặt

### Cổng đã bị dùng

```
Error: listen EADDRINUSE: address already in use :::32060
```

Tìm và dừng tiến trình, hoặc chọn cổng khác:

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

### Permission denied

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'
```

Cách sửa là cho npm một thư mục do nó sở hữu, không phải dùng `sudo`:

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Node.js quá cũ

```
Error: The engine "node" is incompatible with this module
```

Cập nhật Node.js — bằng `nvm` nếu bạn có, nếu không thì từ [nodejs.org](https://nodejs.org/):

```bash
nvm install 20
nvm use 20
```

### Dashboard không mở

Hãy tự mở `http://localhost:32060/dashboard`. Nếu nó cũng không tải, kiểm tra tiến trình đang chạy (`vela --log` hiển thị đầu ra của nó), và kiểm tra tường lửa của bạn: trên macOS, cho phép tiến trình Node trong System Settings → Network → Firewall; trên Linux, kiểm tra `ufw` hoặc `iptables`; trên Windows, cho phép nó qua Windows Defender Firewall.

### Một nhà cung cấp không kết nối được

- Kiểm tra bạn đang có mạng (`ping 1.1.1.1`).
- Kiểm tra trang trạng thái của nhà cung cấp trước khi cho rằng lỗi nằm ở máy bạn.
- Với các nhà cung cấp OAuth, thử **Providers → [provider] → Disconnect → Connect** lại lần nữa; một phiên đã hết hạn thường trông y hệt một bản cài đặt hỏng.

### Dùng nhiều bộ nhớ

Khởi động lại gateway (`Ctrl+C`, rồi `vela`). Với một bản cài chạy lâu dài, hãy dùng một trình quản lý tiến trình:

```bash
npm install -g pm2
pm2 start vela --name vela
pm2 save
```

---

## Các lựa chọn triển khai

### Trên máy của bạn

```bash
npm install -g vela
vela
```

**Tốt cho:** lập trình cá nhân, thử nhà cung cấp, giữ mọi thứ cục bộ.

### Trên một server

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="choose-a-password" \
  ghcr.io/yumamax3/vela:1.2.4
```

Gắn vào `127.0.0.1` nghĩa là chỉ một reverse proxy trên cùng máy mới chạm tới dashboard — mặc định an toàn cho một máy chủ phơi ra internet. [Triển khai cloud](../deployment/cloud.md) có cấu hình Nginx đầy đủ, với các thiết lập streaming quan trọng.

### Phía sau một reverse proxy

Các phản hồi streaming (server-sent events) cần tắt buffering, nếu không chúng sẽ về một cục vào cuối:

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

## Gỡ cài đặt

```bash
npm uninstall -g vela      # remove the launcher
rm -rf ~/.vela             # remove data, keys and settings — this is irreversible
```

Trên Windows, thư mục dữ liệu là `%APPDATA%\vela`. Sau đó xoá mọi export bạn đã thêm vào hồ sơ shell.

Nếu bạn đã chạy Docker thay vào đó:

```bash
docker stop vela && docker rm vela
docker rmi ghcr.io/yumamax3/vela:1.2.4
# and remove the volume or host directory you mounted
```

---

## Bước tiếp theo

- [Bắt đầu nhanh](quick-start.md) — kết nối nhà cung cấp và hướng công cụ về Vela
- [Nhà cung cấp](../providers/subscription.md) — dùng tầng nào vào lúc nào
- [Tính năng](../features/smart-routing.md) — định tuyến, combos, theo dõi quota
- [Khắc phục sự cố](../troubleshooting.md) — khi có thứ gì đó không kết nối được

---

## Cần giúp đỡ?

- **Website**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
