# Khắc phục sự cố

Phần lớn vấn đề với Vela là một trong năm thứ: nó không chạy, key sai, tên model không tồn tại, một nhà cung cấp hết quota, hoặc một mạng lưới nào đó ở giữa cản đường.

Trang này đi qua chúng theo thứ tự bạn có thể gặp. Mỗi cách sửa đều là thứ bạn có thể kiểm tra trong dưới một phút.

---

## Trước tiên, hai phép kiểm tra giải quyết một nửa mọi chuyện

```bash
# 1. Is the gateway alive?
curl http://localhost:32060/api/health
# → {"ok":true}

# 2. Can it see any models?
curl http://localhost:32060/v1/models -H "Authorization: Bearer <your key>"
```

- **Không có phản hồi nào** → nó không chạy, hoặc đang ở cổng khác. Xem [Connection refused](#connection-refused).
- **Có phản hồi, nhưng danh sách model trống** → chưa có nhà cung cấp nào được kết nối. Xem [Model not found](#model-not-found).
- **Một `401`** → key. Xem [API key invalid](#api-key-invalid).
- **Một `429`** → quota, rate limit hoặc một ngân sách bạn đã đặt. Xem [Rate limiting](#rate-limiting).

---

## "Language model did not provide messages"

**Nghĩa là gì:** request đã đến một nhà cung cấp và quay về rỗng hoặc bị từ chối.

**Nguyên nhân:** quota đã cạn, một kết nối đã hết hạn, hoặc một model mà thượng nguồn không còn phục vụ.

**Cách sửa:**

1. **Kiểm tra hạn mức** — **Quota**, xem số còn lại và đồng hồ đếm ngược reset của nhà cung cấp này.
2. **Kiểm tra kết nối** — **Providers**: một kết nối OAuth đã hết hạn hiển thị là cần chú ý. Ngắt kết nối, rồi Connect lại.
3. **Dùng một combo** để model kế tiếp trả lời trong khi bạn điều tra:

   ```
   cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
   ```

---

## Rate limiting

**Nghĩa là gì:** `429 Too Many Requests`, thường kèm một gợi ý thử lại.

**Nguyên nhân:** cửa sổ subscription đã đóng, một giới hạn theo phút bị chạm do bùng nổ, hoặc một ngưỡng ngân sách trên key của bạn đã bị chạm.

**Cách sửa:**

1. **Đọc mã trong phản hồi.** Một mã `budget_exceeded` nghĩa là bạn đã đặt một ngưỡng và chạm nó — sửa nó trong **Endpoint & Key**. Một rate limit trần trụi nghĩa là chờ đợi hoặc chuyển đổi.
2. **Xem đồng hồ đếm ngược reset** trên **Quota**.
3. **Trải tải** — **Settings → Routing → Round robin** qua nhiều tài khoản của cùng nhà cung cấp.
4. **Dùng tầng giá rẻ** trong khi subscription hồi phục: `glm/glm-4.7`, `minimax/MiniMax-M2.1`.
5. **Thử lại với backoff** trong mã của bạn — tôn trọng gợi ý thử lại, đừng dồn dập.

---

## OAuth token expired

**Nghĩa là gì:** `Unauthorized`, hoặc một nhà cung cấp hôm qua chạy được mà hôm nay thì không.

**Nguyên nhân:** việc làm mới đã thất bại (nhà cung cấp đã vô hiệu hoá phiên, mạng sập giữa lúc làm mới, hoặc bạn đã đổi mật khẩu của tài khoản).

**Cách sửa:**

1. **Kết nối lại:** **Providers → [provider] → Disconnect → Connect**, và hoàn tất lại lần đăng nhập.
2. Nếu nhà cung cấp hiển thị nhiều tài khoản, kiểm tra tài khoản đúng đang được bật.
3. Với một server không giao diện, hoàn tất luồng OAuth trên máy khác và dán callback trở lại, nếu nhà cung cấp cho phép.

---

## Connection refused

**Nghĩa là gì:** `ECONNREFUSED`, hoặc "Cannot connect to localhost:32060".

**Nguyên nhân:** Vela không chạy, nó ở cổng khác, hoặc một tường lửa đang cản đường.

**Cách sửa:**

```bash
# Start it
vela

# or, if it is running elsewhere
vela --port 8080

# Is anything listening?
lsof -i :32060            # macOS / Linux
netstat -ano | findstr :32060   # Windows
```

Kiểm tra base URL của công cụ bạn kết thúc bằng `/v1` — `http://localhost:32060` không có nó sẽ chạm vào dashboard, không phải API.

Nếu bạn đang kết nối từ máy khác, hãy nhớ bind mặc định là `0.0.0.0` nhưng một tường lửa vẫn có thể chặn; và nếu bạn khởi động với `--host 127.0.0.1`, chỉ máy đó mới chạm tới được.

---

## Dashboard doesn't open

**Nghĩa là gì:** `http://localhost:32060/dashboard` trắng trơn, quay vòng, hoặc không chạm tới được.

**Nguyên nhân:** cổng bị chiếm, Vela bị crash, hoặc cache trình duyệt đã cũ.

**Cách sửa:**

1. **Kiểm tra tiến trình** — `vela --log` hiển thị đầu ra của nó. Nếu không có gì đang chạy, hãy khởi động nó.
2. **Kiểm tra cổng**:
   ```bash
   lsof -i :32060                               # macOS / Linux
   lsof -ti:32060 | xargs kill -9               # stop the squatter
   netstat -ano | findstr :32060                # Windows
   taskkill /PID <PID> /F
   ```
3. **Thử một cửa sổ riêng tư** để loại trừ cache hoặc một tiện ích mở rộng.
4. **Từ máy khác?** Đó là cổng mật khẩu. Truy cập cục bộ đang mở; truy cập từ xa bị từ chối cho đến khi bạn đặt một mật khẩu trong **Settings → Access**.

---

## Model not found

**Nghĩa là gì:** `404` hoặc "model not found".

**Nguyên nhân:** một lỗi đánh máy, một nhà cung cấp chưa kết nối, hoặc một id model đã bị đổi tên ở thượng nguồn.

**Cách sửa:**

1. **Hỏi gateway xem nó có gì:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
2. **Kiểm tra định dạng** — `prefix/model`, ví dụ `glm/glm-4.7`, không phải `glm-4.7` đứng một mình.
3. **Kết nối nhà cung cấp** mà model thuộc về.
4. **Danh sách model luôn di chuyển.** Nếu một model chạy được tháng trước mà không chạy hôm nay, nhà cung cấp có lẽ đã khai tử id ấy. Hãy chọn một cái hiện hành từ danh sách trên.

---

## Slow responses

**Nghĩa là gì:** request mất một lúc lâu mới bắt đầu stream, hoặc bị timeout.

**Nguyên nhân:** độ trễ nhà cung cấp, ngữ cảnh lớn, độ ưu tiên của tầng miễn phí, hoặc một proxy đang buffer stream.

**Cách sửa:**

1. **Thử một model nhanh hơn** — `cc/claude-haiku-4-5-20251001`, `minimax/MiniMax-M2.5-highspeed`, `qwen/qwen-turbo`.
2. **Giảm ngữ cảnh** — cắt bớt lịch sử, gửi tệp liên quan thay vì cả repository.
3. **Các tầng miễn phí chậm khi tải cao**, theo thiết kế. Hãy tiến lên một tầng nếu điều đó quan trọng.
4. **Ở sau một proxy?** Streaming cần tắt buffering:
   ```nginx
   proxy_buffering off;
   proxy_read_timeout 86400;
   ```
5. **Kiểm tra mạng** giữa bạn và nhà cung cấp.

---

## API key invalid

**Nghĩa là gì:** `401 Unauthorized`.

**Nguyên nhân:** một key sai, một lần dán bị cắt cụt, một key đã bị xoá, hoặc `REQUIRE_API_KEY` đang bật mà không gửi key.

**Cách sửa:**

1. **Tạo một key mới:** **Endpoint & Key → Create Key**. Key chỉ được hiển thị một lần khi tạo và chỉ được lưu dưới dạng hash; không có cách nào tra một key cũ.
2. **Kiểm tra định dạng** — key Vela có dạng `vela-v1-<id>-<checksum>`. Một key kiểu `sk-...` cũ có trước định dạng này và không còn được chấp nhận.
3. **Kiểm tra header** — `Authorization: Bearer <key>`, không có khoảng trắng hay ký tự xuống dòng thừa.
4. **Thử nó:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
5. **Nếu key có phạm vi**, xác nhận model bạn đang yêu cầu nằm trong đó.

---

## "Invalid API key" từ nhà cung cấp, không phải từ Vela

**Nghĩa là gì:** Vela đã chấp nhận key của bạn, nhưng thượng nguồn từ chối thông tin xác thực của nhà cung cấp.

**Cách sửa:**

1. Kiểm tra lại API key hoặc thông tin đăng nhập của nhà cung cấp trong **Providers**.
2. Xác nhận tài khoản thượng nguồn còn credit.
3. Tạo lại key thượng nguồn nếu nó có thể đã bị lộ.

---

## Mọi thứ chạy được hôm qua

Đây là hình dạng phổ biến nhất của sự cố, và gần như luôn ở thượng nguồn:

- một tầng miễn phí đã siết giới hạn của nó
- một nhà cung cấp đã khai tử một id model
- một phiên OAuth đã bị vô hiệu hoá
- một nhà cung cấp gặp sự cố

Kiểm tra trang trạng thái của nhà cung cấp, kết nối lại nó trong **Providers**, và để một combo chở bạn đi cho đến khi nó hồi phục.

---

## Vẫn còn bế tắc

- Xác nhận phiên bản của bạn: `npm list -g vela` (tài liệu này bao quát 1.2.4).
- Xem **Log Harbor** cho đúng request và lỗi của nó.
- Tìm trong [issues](https://github.com/YumamaX3/Vela/issues), và mở một issue kèm phiên bản của bạn, nội dung lỗi, và các bước đã tạo ra nó.

---

## Cần thêm trợ giúp?

- **GitHub Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Documentation:** [vela.my.id/docs](https://vela.my.id/docs)
- **FAQ:** [faq.md](faq.md)
