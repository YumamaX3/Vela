# Nhà cung cấp giá rẻ - Dự phòng siêu rẻ

Khi quota subscription cạn, một model giá rẻ tốt chỉ tốn vài đô mỗi ngày thay vì vài đô mỗi giờ. Trang này bao quát ba nhà cung cấp giá rẻ đi kèm Vela, đúng những mức giá Vela dùng để ước tính chi phí, và cách đặt chúng phía sau các subscription của bạn.

> **Về các con số.** Mọi mức giá trên trang này đều đến từ `open-sse/providers/pricing.js` trong bản phát hành này (Vela 1.2.4). Đó là mức Vela dùng để tính chi phí trong các ước tính của nó. Hoá đơn từ nhà cung cấp của bạn vẫn là tiếng nói cuối cùng — giá do thượng nguồn đặt ra và thay đổi mà không báo trước.

---

## Tổng quan

Tầng giá rẻ nằm **giữa** subscription và các nhà cung cấp miễn phí:

- 💰 **GLM-4.7** — $0.60 input / $2.20 output mỗi 1M tokens (`glm/glm-4.7`)
- 💰 **MiniMax M2.1** — $0.30 input / $1.20 output mỗi 1M tokens (`minimax/MiniMax-M2.1`)
- 💰 **Kimi** — các gói subscription, cho việc dùng ngữ cảnh dài ổn định (`kimi/...`)

**Ý tưởng:** khi một cửa sổ subscription đóng lại, tầng giá rẻ giữ cho bạn tiếp tục làm việc với một phần nhỏ giá API bán lẻ — và một nhà cung cấp miễn phí vẫn đứng cuối hàng cho khi ngay cả thế cũng là quá nhiều.

---

## GLM-4.7

### Giá

| Hạng mục | Mức giá |
|------|------|
| Input | $0.60 mỗi 1M tokens |
| Output | $2.20 mỗi 1M tokens |
| Input đã cache | $0.11 mỗi 1M tokens |

Đó là mức Vela ghi nhận: khoảng một phần mười bốn của một API bán lẻ $20 mỗi 1M điển hình ở đầu vào, và khoảng một phần mười ở đầu ra.

**Ví dụ tính sẵn — 10M tokens, nửa đọc nửa viết:**

```
Input:   5M × $0.60 = $3.00
Output:  5M × $2.20 = $11.00
Total:              $14.00
```

**Ví dụ tính sẵn — một ngày lập trình điển hình, 8M tokens ở tỉ lệ đọc/viết 3:1:**

```
Input:   6M × $0.60 = $3.60
Output:  2M × $2.20 = $4.40
Total:              $8.00
```

### Thiết lập

**Bước 1: lấy một key**

Tạo một tài khoản tại nhà cung cấp GLM của bạn (Zhipu / Z.ai, tuỳ khu vực) và tạo một API key.

**Bước 2: thêm vào Vela**

```
Dashboard → Providers → GLM → Add API key → paste → Save
```

**Bước 3: dùng nó**

```
Model: glm/glm-4.7
```

### Các model trên tầng này

| Model | Tốt cho |
|-------|----------|
| `glm/glm-4.7` | con ngựa thồ giá trị: lập trình và các tác vụ chung |
| `glm/glm-4.6v` | thị giác — đọc ảnh chụp màn hình và sơ đồ |
| `glm/glm-5`, `glm/glm-5.2`, `glm/glm-5.3` | mới hơn, mạnh hơn, và đắt hơn |
| `glm/glm-5.3-flash` | thị giác, với giá thấp hơn |

### Ghi chú thực hành

- **Định tuyến có ý thức về cache sẽ có lợi.** Mức giá input đã cache của GLM chỉ một phần năm giá input mới; những cuộc trò chuyện dài giữ prefix ổn định tốn ít hơn nhiều.
- **GLM có các cửa sổ quota riêng.** Trang **Quota** của dashboard hiển thị hạn mức còn lại và đồng hồ đếm ngược reset cho tài khoản của bạn.
- **Giữ nó ở vị trí thứ hai, không phải thứ nhất**, trừ khi bạn cố ý tối ưu chi phí — Claude và Codex giỏi hơn trên những bài toán thực sự khó.

---

## MiniMax M2.1

### Giá

| Hạng mục | Mức giá |
|------|------|
| Input | $0.30 mỗi 1M tokens |
| Output | $1.20 mỗi 1M tokens |
| Input đã cache | $0.03 mỗi 1M tokens |

Đây là tầng trả phí rẻ nhất đi kèm Vela, và là lựa chọn ưa thích cho công việc ngữ cảnh dài.

**Ví dụ tính sẵn — 10M tokens, nửa đọc nửa viết:**

```
Input:   5M × $0.30 = $1.50
Output:  5M × $1.20 = $6.00
Total:              $7.50
```

**Ví dụ tính sẵn — một ngày lập trình điển hình, 8M tokens ở tỉ lệ 3:1:**

```
Input:   6M × $0.30 = $1.80
Output:  2M × $1.20 = $2.40
Total:              $4.20
```

### Thiết lập

**Bước 1: lấy một key** từ nền tảng của MiniMax.

**Bước 2: thêm nó**

```
Dashboard → Providers → MiniMax → Add API key → paste → Save
```

**Bước 3: dùng nó**

```
Model: minimax/MiniMax-M2.1
```

### Các model trên tầng này

| Model | Ghi chú |
|-------|-------|
| `minimax/MiniMax-M2.1` | lựa chọn giá trị, $0.30 / $1.20 |
| `minimax/MiniMax-M2.5`, `minimax/MiniMax-M2.7` | các thế hệ mới hơn, cùng mức giá nổi bật |
| `minimax/MiniMax-M2.5-highspeed` | tầng nhanh hơn, $0.60 / $2.40 |
| `minimax/MiniMax-M3` | chiếc flagship hiện tại |
| `minimax/minimax-image-01`, `minimax/speech-2.8-hd` | dịch vụ hình ảnh và giọng nói |

### Ghi chú thực hành

- **Ngữ cảnh dài là lý do để chọn nó.** Các model MiniMax nhận input rất lớn, khiến chúng là chỗ tốt cho những câu hỏi về toàn bộ tệp và toàn bộ repo khi cửa sổ subscription của bạn đã đóng.
- **Để ý các biến thể `-highspeed`** — chúng tốn gấp đôi. Đáng cho công việc tương tác, lãng phí cho các job theo lô.

---

## Kimi (gói cố định)

### Giá

Kimi bán các gói lập trình thay vì giá bán lẻ theo token. Vela có thể chạm tới chúng bằng đăng nhập hoặc API key, tuỳ tài khoản của bạn hỗ trợ cách nào.

**Tại sao nó có chỗ đứng:** với mức dùng ổn định, dự đoán được, một gói hàng tháng cố định thắng cách tính theo token, và các model Kimi mạnh ở ngữ cảnh dài.

### Thiết lập

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

```
Model: kimi/kimi-latest
       kimi/kimi-k2.5
       kimi/k3
```

---

## So sánh cạnh nhau

| Provider | Input /1M | Output /1M | Hình dạng | Tốt nhất cho |
|----------|-----------|------------|-------|----------|
| **GLM-4.7** | $0.60 | $2.20 | tính theo mức dùng, cửa sổ quota riêng | lập trình giá rẻ hàng ngày |
| **MiniMax M2.1** | $0.30 | $1.20 | tính theo mức dùng | rẻ nhất, ngữ cảnh dài |
| **Kimi** | theo gói | theo gói | subscription | khối lượng ổn định |
| Một API bán lẻ để so sánh | khoảng $20 | khoảng $20 (hoặc hơn) | tính theo mức dùng | — |

Hãy đọc bảng ấy như câu "thử cái nào trước khi subscription xong": MiniMax vì chi phí, GLM vì chất lượng trên mỗi đô, Kimi nếu bạn đã có một gói.

---

## Đưa tầng này vào việc

### Cursor, Cline, Continue, Roo

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    glm/glm-4.7        (or minimax/MiniMax-M2.1, or a combo name)
```

### Một combo ưu tiên giá rẻ

```
Dashboard → Combos → Create
  Name:   cheap-backup
  Models: 1. glm/glm-4.7
          2. minimax/MiniMax-M2.1
          3. if/qwen3-coder-plus      ← free last line
```

Dùng `cheap-backup` ở bất cứ đâu cần một tên model. Giá rẻ trước, rẻ hơn sau, miễn phí ở cuối.

### Một combo ưu tiên subscription

```
  Models: 1. cc/claude-opus-5
          2. glm/glm-4.7
          3. minimax/MiniMax-M2.1
          4. kr/claude-sonnet-4.5     ← free last line
```

---

## Tiền thực sự đi đâu

### Một tháng thực tế, 100M tokens

```
60M via a free allowance    : $0     (upstream allowance, not Vela's)
30M via a subscription      : $0     (already paid)
 8M via GLM-4.7             : about $4.80  (input-weighted)
 2M via MiniMax M2.1        : about $0.40  (input-weighted)
```

Tầng giá rẻ hiếm khi là hoá đơn. Nó là bảo hiểm giúp bạn tiếp tục lập trình khi subscription đã khô.

### Đặt một ngưỡng

Nếu bạn giao một API key cho công cụ chạy không người trông, hãy gán cho key ấy một ngưỡng chi tiêu:

```
Dashboard → Endpoint & Key → Create Key (or edit an existing one)
→ budget: daily / weekly / monthly token budget and spend cap
```

Khi chạm ngưỡng, Vela từ chối request bằng một 429 nói rõ điều đó. Nó sẽ **không** lặng lẽ chuyển bạn sang một model rẻ hơn — một ngưỡng chi tiêu là một điểm dừng cứng, theo thiết kế.

---

## Khắc phục sự cố

### "Quota exhausted" trên một tầng giá rẻ

Mỗi nhà cung cấp có các cửa sổ riêng. Xem **Quota** cho đồng hồ đếm ngược reset, hoặc để combo rơi sang tầng miễn phí.

### "API key invalid"

- Dán lại key — khoảng trắng thừa ở cuối là thủ phạm thường gặp.
- Kiểm tra tài khoản thực sự có credit; một tài khoản số dư bằng không thường trả lời bằng một lỗi trông giống lỗi xác thực.
- Tạo lại key nếu nó từng bị dán ở đâu đó công khai.

### "My bill is higher than the estimate"

- Vela ước tính theo các mức giá trong `pricing.js`; một nhà cung cấp có thể đổi giá bán lẻ trước khi Vela cập nhật.
- Ngữ cảnh dài và công việc nặng về output tốn nhiều hơn hẳn các prompt ngắn — output có giá gấp 3–4× input trên tầng này.
- Các biến thể `-highspeed` và `glm-5.x` đắt hơn rõ rệt so với các model nổi bật.

### "I want the cheapest possible"

Đặt MiniMax M2.1 trước, GLM thứ hai, và một nhà cung cấp miễn phí ở cuối — và cân nhắc xem Antigravity (miễn phí) có nên đứng đầu luôn hay không.

---

## Bước tiếp theo

- **Thêm một lớp cuối miễn phí:** [Nhà cung cấp miễn phí](free.md)
- **Bắt đầu với subscription:** [Nhà cung cấp Subscription](subscription.md)
- **Dựng và tinh chỉnh một chuỗi:** [Combos](../features/combos.md)
