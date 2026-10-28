# 🏠 Triển khai Localhost

Chạy Vela trên chính máy của bạn là mặc định, là cách dễ nhất, và là cách ít hỏng nhất. Trang này bao quát những việc thường ngày: khởi động, dừng, di chuyển dữ liệu, cập nhật, và hai ba vấn đề hay gặp nhất.

Nếu bạn chưa cài nó, hãy bắt đầu với [Cài đặt](../getting-started/installation.md).

---

## 📦 Cài đặt

```bash
npm install -g vela
```

**Yêu cầu:**
- Node.js 20 trở lên
- npm 10 trở lên (đi kèm Node.js)

---

## 🚀 Khởi động server

```bash
vela
```

Dashboard tự mở tại **http://localhost:32060/dashboard**.

**Cấu hình mặc định:**

| Hạng mục | Ở đâu |
|-|-|
| **Dashboard** | `http://localhost:32060/dashboard` |
| **API endpoint** | `http://localhost:32060/v1` |
| **Cổng mặc định** | `32060` |
| **Thư mục dữ liệu** | `~/.vela` (macOS/Linux) · `%APPDATA%\vela` (Windows) |
| **Mật khẩu dashboard** | không có mặc định — xem bên dưới |

Một tiến trình phục vụ cả dashboard và API. Không có cổng thứ hai để phải nhớ.

### Về mật khẩu

Vela hiện tại **không có mật khẩu mặc định**. Từ chính máy ấy, dashboard mở mà không cần mật khẩu. Trình duyệt từ xa bị từ chối cho đến khi bạn đặt một mật khẩu trong **Settings → Access** — một câu trả lời thẳng cho tất cả những ai từng phát hành `123456` làm mặc định và hối hận.

Nếu bạn muốn một lần đăng nhập ngay cả khi cục bộ, hãy đặt một cái trong **Settings → Access** (hoặc đặt `INITIAL_PASSWORD` trước lần khởi động đầu tiên) và bật **Require dashboard login**.

### Về mạng

Mặc định trình khởi chạy gắn vào `0.0.0.0`, nghĩa là các máy khác trên mạng của bạn chạm tới được cổng. Với một thiết lập hoàn toàn cục bộ:

```bash
vela --host 127.0.0.1
```

---

## 🔧 Cấu hình

### Một thư mục dữ liệu tuỳ chỉnh

```bash
DATA_DIR=/path/to/data vela
```

Trên Windows, dùng một đường dẫn bản địa như `D:\vela-data`; một đường dẫn kiểu Unix ở đó bị bỏ qua kèm cảnh báo.

### Một cổng tuỳ chỉnh

```bash
vela --port 8080
# or
PORT=8080 vela
```

Khi ấy mọi thứ nói chuyện với Vela — editor, script — phải dùng `http://localhost:8080/v1`.

### Một host tuỳ chỉnh

```bash
vela --host 127.0.0.1    # this machine only
vela --host 0.0.0.0      # all interfaces (the default)
```

---

## 🛑 Dừng server

Nhấn `Ctrl+C` trong terminal đang chạy nó. Gateway xử lý nốt các request đang chạy trước khi thoát, nên một phản hồi streaming hoàn thành thay vì bị cắt ngang.

Nếu nó được khởi động ở nền hoặc qua một trình quản lý tiến trình:

```bash
pm2 stop vela         # if you used PM2
pkill -f vela         # last resort
```

---

## 🔄 Khởi động lại

```bash
vela
```

Các nhà cung cấp, key, combo, ngân sách và lịch sử dùng đều còn nguyên — chúng sống trong thư mục dữ liệu, không phải trong bộ nhớ.

---

## 📊 Cập nhật

```bash
npm update -g vela
```

Kiểm tra bạn đang chạy bản nào:

```bash
npm list -g vela
```

Với cách dùng Docker, hãy kéo thẻ mới hơn một cách tường minh:

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run the same docker run command with the new tag
```

Các migration cơ sở dữ liệu chạy tự động khi khởi động, với một bản sao an toàn được chụp trước trong `~/.vela/db/backups/`. Dù vậy, hãy sao lưu trước một bản cập nhật lớn.

---

## 🔍 Khắc phục sự cố

### Port đã được dùng

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F
```

Hoặc cứ chạy trên cổng khác: `vela --port 8080`.

### Lỗi Permission khi cài

```bash
# Give npm a directory it owns (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Thư mục dữ liệu không ghi được

```bash
ls -la ~/.vela
chmod 755 ~/.vela
```

Nếu vẫn thất bại, hãy trỏ `DATA_DIR` về một thư mục bạn sở hữu.

### Dashboard không tải được từ máy khác

Đó là cổng mật khẩu đang làm đúng việc của nó. Hoặc mở nó trên máy chạy Vela và đặt một mật khẩu trong **Settings → Access**, hoặc giữ nó cục bộ với `vela --host 127.0.0.1` và chạm tới nó qua một đường hầm SSH:

```bash
ssh -L 32060:localhost:32060 you@the-vela-machine
# then open http://localhost:32060/dashboard
```

---

## 📁 Thư mục dữ liệu

```text
~/.vela/
├── db/
│   ├── data.sqlite     # providers, keys, combos, settings, usage
│   └── backups/        # pre-migration copies and any scheduled backups
├── logs/               # request logs, when enabled
└── runtime/            # binaries the launcher manages
```

**Sao lưu chỉ là chép cả thư mục** — lý tưởng nhất là khi Vela đã dừng, để write-ahead log của SQLite đã lắng xuống:

```bash
# While Vela is stopped:
cp -r ~/.vela ~/.vela.backup

# Restore (with Vela stopped):
rm -rf ~/.vela && cp -r ~/.vela.backup ~/.vela
```

Với việc sao lưu theo lịch, được mã hoá, Vela có một engine dựng sẵn — xem các biến sao lưu trong `.env.example` (`VELA_BACKUP_*`). Hãy giữ `VELA_BACKUP_ENCRYPTION_KEY` ở nơi bạn vẫn còn có nó một năm nữa; mất nó khiến các bản sao lưu vĩnh viễn không đọc được.

---

## 🔗 Bước tiếp theo

- [Kết nối nhà cung cấp](../providers/subscription.md)
- [Dựng một chuỗi fallback](../features/combos.md)
- [Hướng editor của bạn về Vela](../integration/cursor.md)
- [Đi xa: triển khai cloud](cloud.md)
