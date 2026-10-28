# Theo dõi Quota & Giám sát mức dùng

Vela giữ lại một biên lai cho mọi thứ. Trang này nói về việc đọc những biên lai ấy: còn bao nhiêu hạn mức mỗi loại, khi nào nó reset, tiền đang đi đâu, và cách đặt một ngưỡng cứng lên đó.

---

## Tổng quan

- **Tiêu thụ trực tiếp** — token và chi phí theo từng request, từng model, từng key
- **Quota và phần còn lại** — bạn đã dùng bao nhiêu trong hạn mức của mỗi nhà cung cấp
- **Đồng hồ đếm ngược reset** — khi nào cửa sổ mở lại
- **Ước tính chi phí** — tính từ các mức giá đi kèm Vela
- **Ngưỡng ngân sách** — điểm dừng cứng, theo từng API key
- **Lịch sử** — hôm nay, 7, 14, 30, 60 ngày, hoặc toàn bộ thời gian

---

## Các phòng của dashboard

```
Quota     per-provider allowances and reset times
Usage     requests, tokens, cost, by period, model, combo and key
Log Harbor   the request ledger, for when you need a single request
```

### Trang Quota hiển thị gì

Với mỗi nhà cung cấp đã kết nối, một hàng gồm:

- **Đã dùng / tổng** — dưới dạng thanh và phần trăm, khi nhà cung cấp công bố một giới hạn
- **Reset** — một đồng hồ đếm ngược đến cửa sổ kế tiếp
- **Chi phí đến nay** — cho các tầng tính theo mức dùng

Dữ liệu quota đến từ từng nhà cung cấp. Ở nơi nhà cung cấp không công bố một con số dùng được, Vela hiển thị những gì nó đo được (mức dùng của chính bạn) và nói rõ điều đó, thay vì bịa ra một phần trăm.

### Trang Usage hiển thị gì

- Các request và token của khoảng thời gian đã chọn
- Chi phí chia theo model, combo và API key
- Model nào thực sự đã trả lời (qua **Routed by Combo**)

---

## Theo dõi từng request

Mọi request được ghi lại cùng model, số token, thời lượng, kết quả và chi phí. Khi một hoá đơn làm bạn bất ngờ, đây là nơi bạn tìm thấy request đã gây ra nó.

Nếu bạn muốn toàn văn các request và phản hồi, hãy bật `ENABLE_REQUEST_LOGS` — nó mặc định tắt vì dung lượng lớn và chứa bất cứ thứ gì bạn đã gửi.

---

## Các hình dạng quota hành xử thế nào

Quota không phải một thứ duy nhất. Các nhà cung cấp dùng nhiều hình dạng, và chúng reset khác nhau:

| Hình dạng | Nhà cung cấp điển hình | Cách reset |
|-------|-------------------|---------------|
| **Cửa sổ cuốn chiếu** | Claude Code, Codex | cửa sổ trượt; hạn mức trở lại khi mức dùng cũ già đi |
| **Ngày cố định** | một số tầng giá rẻ | vào một giờ cố định, theo múi giờ của nhà cung cấp |
| **Hàng tháng** | Copilot, các gói | vào một ngày, thường là ngày 1 hoặc ngày thanh toán của bạn |
| **Credit tính theo mức dùng** | GLM, MiniMax, phần lớn API key | không bao giờ "reset" — nó là một số dư |

Hệ quả thực tế: trên một cửa sổ cuốn chiếu, chờ một giờ có thể đủ; trên một cửa sổ ngày cố định, có thể đáng đi ngủ; trên một số dư, chỉ việc trả tiền mới giúp.

---

## Ước tính chi phí

Vela ước tính chi phí từ `open-sse/providers/pricing.js`. Hai mức giá quan trọng nhất ở đây:

| Model | Input /1M | Output /1M |
|-------|-----------|------------|
| `glm/glm-4.7` | $0.60 | $2.20 |
| `minimax/MiniMax-M2.1` | $0.30 | $1.20 |

Bởi output có giá gấp ba đến bốn lần input, một cuộc trò chuyện nặng về output tốn nhiều hơn hẳn một prompt dài với câu trả lời ngắn. Khi một con số có vẻ cao, hãy nhìn vào tỉ lệ chia trước khi đi tìm lỗi.

Ước tính vẫn chỉ là ước tính: một nhà cung cấp có thể đổi giá bán lẻ trước khi bảng của Vela theo kịp. Hoá đơn của bạn là thẩm quyền.

---

## Ngân sách và ngưỡng

Có hai loại điều khiển khác nhau, và chúng hành xử khác nhau. Đáng biết bạn đã bật cái nào.

### Ngân sách theo key (điểm dừng cứng)

```
Dashboard → Endpoint & Key → Create Key (or edit one)
  token budget:  daily / weekly / monthly / yearly
  spend cap:     in currency
```

Khi một key chạm ngưỡng của nó, các request qua key đó bị từ chối:

```
HTTP 429 — "Monthly spend cap exceeded: $20.00 of $20.00 used (budget_exceeded)"
```

Đó là một lần từ chối, không phải một lần chuyển hướng. Vela không đưa bạn sang một model rẻ hơn để ở dưới ngưỡng; nó dừng lại, bởi "dừng" chính là điều bạn đã yêu cầu.

### Ngân sách gateway (ngưỡng mềm và trần cứng)

Ngân sách mức dùng có thể được đặt ở phạm vi gateway, key hoặc model, với các cửa sổ ngày, tuần hoặc tháng. Chúng phát cảnh báo ở 50%, 80% và 100%, và từ chối thẳng một khi vượt trần cứng — bằng một mã nêu rõ phạm vi.

### Khác biệt với fallback

Một combo chuyển sang model kế tiếp khi một request **thất bại**. Một ngân sách từ chối khi bạn đã **tiêu đủ**. Không cái nào xảy ra ngoài ý muốn, và không cái nào đoán thay bạn.

---

## Đọc mức dùng của chính bạn qua API

Dashboard đọc từ chính những endpoint mà bạn cũng dùng được:

```bash
# Usage summary
curl "http://localhost:32060/api/usage/stats?period=7d" \
  -H "Authorization: Bearer <key>"

# Request metrics over time (for charts)
curl "http://localhost:32060/api/usage/metrics/timeseries?period=7d" \
  -H "Authorization: Bearer <key>"

# Budget definitions
curl "http://localhost:32060/api/usage/budgets" \
  -H "Authorization: Bearer <key>"
```

Các khoảng thời gian hợp lệ: `today`, `24h`, `7d`, `14d`, `30d`, `60d`, `all`. Đây chính là những cửa sổ mà bộ chọn khoảng thời gian của dashboard dùng, khiến chúng tiện cho một script hàng tuần.

---

## Cảnh báo

Các bản ghi cảnh báo được tạo ra khi một ngân sách vượt một ngưỡng, và có thể được gửi đến một banner trong dashboard, một webhook Discord hoặc một webhook n8n, tuỳ vào những gì bạn đã cấu hình.

Một email tóm tắt hàng tháng không phải thứ Vela tự gửi; nếu bạn muốn, API trên cùng một cron job là một script mười dòng.

---

## Thói quen tốt

### 1. Nhìn một lần mỗi ngày

Trang **Quota** mất mười giây. Nó cho bạn biết nhiều về tuần của bạn hơn bất kỳ công cụ năng suất nào.

### 2. Đặt ngưỡng cho các key chạy không người trông

Agent, job nền, bất cứ thứ gì lặp đi lặp lại. Một ngưỡng bạn đặt một lần tốt hơn một hoá đơn bạn đọc một lần.

### 3. Mỗi công cụ một key riêng

Khi ấy báo cáo mức dùng theo key mới thực sự có nghĩa.

### 4. Ưu tiên model rẻ hơn cho công việc nhàm chán

Một combo đặt GLM trước cho "viết một commit message" tốn ít hơn nhiều so với một combo gửi nó cho Opus, và trả lời tốt y như vậy.

### 5. Xem các ước tính đúng như chúng là

Chúng được suy ra từ những mức giá được công bố và số token. Đủ chính xác để lập ngân sách, không đủ chính xác để cãi với một hoá đơn.

---

## Khắc phục sự cố

### Quota hiển thị đã dùng, nhưng request thất bại

Nhà cung cấp có thể đang áp một giới hạn Vela không nhìn thấy (một trần cấp tài khoản, một rate limit theo phút). Con số quota là một chỉ dẫn, không phải một lời hứa. Hãy thử một model khác hoặc kiểm tra trang trạng thái của nhà cung cấp.

### Chi phí có vẻ sai

1. Kiểm tra các mức giá: **Nhà cung cấp giá rẻ** liệt kê những mức Vela đi kèm.
2. Kiểm tra tỉ lệ chia — token output chiếm phần lớn.
3. Kiểm tra model — các biến thể `-highspeed` và lớn hơn tốn nhiều hơn.
4. Nếu một nhà cung cấp đã đổi giá, ước tính sẽ lệch cho đến khi bảng được cập nhật.

### Đồng hồ đếm ngược reset có vẻ đứng yên

Tải lại trang; dữ liệu quota được lấy khi trang tải. Nếu bản thân đồng hồ đếm ngược sai với một nhà cung cấp có công bố thời điểm reset, đó là một chi tiết thượng nguồn mà Vela đang hiển thị, không phải đang tính toán.

### Đã chạm ngân sách, nhưng tôi muốn tiếp tục

Sửa ngân sách của key trong **Endpoint & Key**, hoặc dùng một key khác. Việc từ chối chính là ngưỡng đang làm đúng việc của nó.

---

## Liên quan

- [Định tuyến thông minh](smart-routing.md) — request đi đâu, và tại sao
- [Combos](combos.md) — những chuỗi đằng sau các chi phí
- [Nhà cung cấp giá rẻ](../providers/cheap.md) — các mức giá chi tiết
