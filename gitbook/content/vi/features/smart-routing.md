# Định tuyến thông minh & Fallback tự động

Vela không đoán. Mỗi request đều đi đến đâu đó vì một lý do: model bạn yêu cầu, tài khoản nên phục vụ nó, và — nếu thế thất bại — cái kế tiếp trong hàng.

Trang này giải thích từng mảnh, để khi một request rơi vào một chỗ không như bạn nghĩ, bạn biết chính xác núm vặn nào để xoay.

---

## Hình dạng của một request

```
Your tool
   ↓  POST /v1/chat/completions, model: "premium-coding"
Vela
   ↓  is "premium-coding" a combo?      → yes: walk its chain
   ↓  otherwise: is it prefix/model?    → resolve provider + model
   ↓  which account for that provider?  → connection order, or round-robin
   ↓  does the API key allow it?        → key scope
   ↓  is the key within budget?         → 429 if not
   ↓  call the upstream
   ↓  failed?                           → next model in the chain (combos)
Reply
```

Không có gì trên đường đi ấy âm thầm sắp xếp lại các ưu tiên của bạn. Nếu bạn yêu cầu một model subscription, bạn nhận được nó hoặc nhận một lỗi — trừ khi bạn đang dùng một combo, khi ấy bạn nhận model kế tiếp bạn đã liệt kê.

---

## Fallback của combo

Một combo là cơ chế duy nhất đưa một request sang một *model khác*:

```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```

Nó chuyển tiếp khi một request thất bại — lỗi quota, rate limit, timeout, từ chối theo chính sách, model không xác định — và đứng yên khi một request chỉ *có thể* thất bại về sau. Toàn bộ quy tắc, cùng cách dựng một combo, nằm trong [Combos](combos.md).

## Luân chuyển tài khoản

Trong một nhà cung cấp, nhiều kết nối có thể chia nhau công việc. **Settings → Routing** đưa ra round-robin (trải đều qua các kết nối) hoặc fill-first (dùng một cái cho đến khi nó kêu ca), cùng một giới hạn sticky giữ một cuộc trò chuyện trên cùng một tài khoản trong một lúc. Đây là cách bạn dùng hai tài khoản Claude, hoặc ba, mà không phải nghĩ ngợi.

## Phạm vi key và ngân sách

Mỗi API key có thể bị giới hạn trong một số nhà cung cấp, model hay combo nhất định, và được gán một ngân sách token cùng ngưỡng chi tiêu. Khi chạm ngưỡng, request bị từ chối bằng một `429` mang mã `budget_exceeded` — một điểm dừng rõ ràng thay vì một lần hạ cấp lặng lẽ.

---

## Mỗi tầng để làm gì

**Subscription — dùng trước, nếu chất lượng quan trọng**
- Claude Code, Codex, Copilot, Antigravity, Kimi
- Bạn đã trả tiền cho những cái này; mục tiêu là dùng hết hạn mức trước khi nó hết hạn

**Giá rẻ — tầng giữa**
- GLM-4.7 ($0.60 / $2.20 mỗi 1M), MiniMax M2.1 ($0.30 / $1.20), các gói Kimi
- Một phần nhỏ giá API bán lẻ, và đủ tốt cho phần lớn công việc

**Miễn phí — lớp cuối cùng**
- iFlow, Qwen, Kiro
- Bị giới hạn tốc độ và thất thường, nhưng không tốn gì

---

## Nhìn nó diễn ra

```
Dashboard → Usage        a live view of requests, tokens and cost
Dashboard → Quota        per provider: used, remaining, reset countdown
Dashboard → Routed by Combo   which model actually answered
Dashboard → Log Harbor   the request ledger, when you need the detail
```

Nếu một combo lần nào cũng rơi vào bậc cuối, **Quota** sẽ cho bạn thấy lý do trong vài giây.

---

## Cấu hình quan trọng

### Chiến lược định tuyến

```
Dashboard → Settings → Routing
  Round robin            spread requests across connections
  Sticky limit           how long one conversation stays on one connection
  Combo round robin      rotate through a combo's members instead of falling through
```

### Quy tắc fallback

Ngoài combos, Vela có **Fallback Rules** — những quy tắc do người vận hành định nghĩa, dựa trên điều gì đã hỏng:

- một mã HTTP cụ thể
- một prompt bị từ chối (chính sách nội dung)
- một cửa sổ ngữ cảnh quá nhỏ
- một timeout
- bất kỳ lỗi nào

Các quy tắc có thể được xâu chuỗi và thử trong một bảng dry-run trước khi áp dụng thật. Chúng là công cụ đúng khi "thử model khác khi *điều kia* xảy ra" là một chính sách, không phải một sở thích. Tìm chúng dưới mục **Fallback Rules** ở thanh bên.

### Ngưỡng theo từng key

```
Dashboard → Endpoint & Key → Create Key / Edit
  rate limit, token budget, spend cap, provider/model scope
```

Đây là cơ chế duy nhất chặn được việc tiêu tiền. Hãy dùng nó trên mọi key chạy không người trông.

---

## Ví dụ

### Ví dụ 1: subscription trước

```
Model: premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. if/qwen3-coder-plus
```

Buổi sáng: Claude trả lời. Buổi chiều, khi cửa sổ cuốn chiếu đóng lại: GLM trả lời. Buổi tối, khi thẻ bị từ chối: iFlow trả lời. Bạn vẫn tiếp tục gõ.

### Ví dụ 2: với một ngưỡng chi tiêu

Gán cho key một trần $20 mỗi tháng. Làm việc qua GLM và MiniMax cho đến khi chạm trần; từ đó mọi request trả phí bị từ chối bằng `429`, và các tầng miễn phí vẫn trả lời. Hoá đơn dự đoán được, không có hoá đơn bất ngờ.

### Ví dụ 3: chỉ subscription

Một model duy nhất và không combo. Nếu cửa sổ đóng, bạn nhận lỗi của nhà cung cấp. Đó là chủ ý: có người thà chờ còn hơn tiêu tiền.

---

## Thói quen tốt

### 1. Để công việc khó đi đến subscription

Opus và các model hạng GPT-5.6 xứng đáng với giá của chúng ở kiến trúc và gỡ lỗi. Các model giá rẻ xứng đáng ở tám mươi phần trăm còn lại.

### 2. Kết thúc bằng một tầng miễn phí

Một chuỗi kết thúc bằng một model trả phí là một chuỗi kết thúc bằng một cánh cửa đóng.

### 3. Xem thời điểm reset, không chỉ phần trăm

Các cửa sổ cuốn chiếu và cửa sổ cố định hành xử khác nhau. Làm việc nặng ngay trước ngày reset tháng là hạn mức ném đi.

### 4. Mỗi công cụ hoặc mỗi người một key

Phạm vi và ngân sách tính theo key. Một key dùng chung nghĩa là một trần chung và không cách nào biết ai đã tiêu bao nhiêu.

---

## Khắc phục sự cố

### "No available provider" / "quota exhausted"

Xem **Quota** cho một đồng hồ đếm ngược, rồi kiểm tra combo có kết thúc bằng một model miễn phí không. Nếu có mà nhà cung cấp miễn phí cũng đã cạn, đó là một ngày tồi tệ thật sự ở thượng nguồn, không phải lỗi cục bộ.

### Nó cứ fallback liên tục

- Nhìn vào bậc đầu tiên: một token OAuth đã hết hạn là nguyên nhân phổ biến nhất.
- Kiểm tra trang trạng thái của nhà cung cấp.
- Xác nhận id model vẫn tồn tại (`/v1/models`).

### Chi phí cao hơn combo gợi ý

- Đọc **Routed by Combo**: nó đã rơi xa hơn xuống chuỗi so với bạn tưởng.
- Nhớ rằng token output tốn gấp vài lần input trên mọi tầng.
- Kiểm tra xem trong chuỗi có model `-highspeed` hoặc `glm-5.x` lớn hơn không.

### Một request bị từ chối bằng 429

Đọc mã trong phản hồi: rate limit, phạm vi key, hay ngân sách. Mỗi mã nói rõ nó đã từ chối điều gì và vì sao.

---

## Liên quan

- [Combos](combos.md) — dựng các chuỗi
- [Theo dõi Quota](quota-tracking.md) — đọc các con số
- [Nhà cung cấp giá rẻ](../providers/cheap.md) — các mức giá
