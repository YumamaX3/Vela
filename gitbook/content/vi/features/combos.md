# Combos - Chuỗi Fallback tùy chỉnh

Một combo là một cái tên cho một chuỗi model. Đặt tên cho nó một lần, và mọi công cụ có thể yêu cầu cái tên ấy thay vì một model cụ thể — và khi một model trong chuỗi nằm ngoài tầm với, model kế tiếp sẽ trả lời.

Combos là năm phút hữu ích nhất bạn sẽ dành cho Vela.

---

## Combo là gì

```
Name: premium-coding
Models:
  1. cc/claude-opus-5          ← try first
  2. glm/glm-4.7               ← if #1 is out
  3. kr/claude-sonnet-4.5      ← if #2 is out too
```

Sau đó bất kỳ công cụ nào yêu cầu `premium-coding` như thể nó là một tên model. Vela phân giải tên combo **trước** mọi thứ khác, nên `premium-coding` sẽ không bao giờ đụng với một tiền tố nhà cung cấp.

### Khi nào chuỗi chuyển tiếp

Một combo rơi sang model kế tiếp khi một request **thất bại**:

- nhà cung cấp báo lỗi quota hoặc rate-limit
- request bị timeout
- nhà cung cấp từ chối prompt vì lý do chính sách
- id model không xác định hoặc không khả dụng

### Khi nào nó không chuyển

- Một hạn mức ngày chỉ đang cạn dần **không** kích hoạt việc chuyển. Vela sẽ không âm thầm đưa bạn sang một model trả phí chỉ vì bạn gần chạm giới hạn — làm vậy là tiêu tiền của bạn thay bạn.
- Một ngưỡng chi tiêu cứng thuộc về API key (**Endpoint & Key → budget**); khi chạm ngưỡng, Vela từ chối bằng 429 thay vì lái đi nơi khác.

---

## Tại sao dùng chúng

### 1. Lấy giá trị từ subscription
```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```
Dùng những gì bạn đã trả tiền trước, giá rẻ thứ hai, miễn phí cuối cùng.

### 2. Giữ chi phí thấp
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/qwen3-coder-plus
```
$0.60 → $0.30 → miễn phí, mỗi 1M token input.

### 3. Không bao giờ bế tắc
```
cc/claude-opus-5 → cx/gpt-5.6-sol → glm/glm-4.7 → if/qwen3-coder-plus
```
Luôn kết thúc chuỗi bằng một thứ miễn phí, nếu không bạn chỉ cách một quota cạn kiệt là một buổi chiều đình trệ.

### 4. Giữ chất lượng khi điều đó quan trọng
```
cc/claude-opus-5 → cx/gpt-5.6-sol → ag/gemini-4-argon-high
```
Toàn model cao cấp. Tốn hơn, không bao giờ mờ nhạt.

---

## Tạo một combo

### Bước 1: mở dashboard

```
http://localhost:32060/dashboard → Combos
```

### Bước 2: tạo

```
Combos → Create
  Combo Name: premium-coding
  Models:     add them one at a time, in priority order
```

Kéo các hàng để sắp xếp lại. Model ở đầu được thử trước.

### Bước 3: lưu

Combo xuất hiện ngay lập tức, và gateway sẽ phân giải nó ở request kế tiếp — không cần khởi động lại.

### Bước 4: dùng nó

```
Model: premium-coding
```

Đó là toàn bộ giao diện. Bất kỳ công cụ nào nhận một tên model đều nhận được một tên combo.

### Một chiến lược khác: round-robin

Một combo cũng có thể luân chuyển giữa các thành viên thay vì rơi xuống theo thứ tự. Đặt điều đó toàn cục trong **Settings → Routing → Combo round robin**, nếu mục tiêu của bạn là trải tải (ví dụ qua nhiều tài khoản) thay vì fallback.

---

## Ví dụ đã tính sẵn

### Ví dụ 1: cao cấp nhưng tiết kiệm

```
premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

Một tháng điển hình ở 100M tokens:

```
80M via the Claude subscription : $0
15M via GLM-4.7                 : about $9
 5M via MiniMax M2.1            : about $1
```

Model đắt làm công việc thật; các model rẻ hứng phần tràn.

### Ví dụ 2: chỉ ngân sách

```
budget-combo
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/qwen3-coder-plus
```

Ở 100M tokens mỗi tháng, chia 70 / 20 / 10:

```
70M via GLM          : about $42
20M via MiniMax      : about $4
10M via iFlow        : $0
```

Tốn tiền, nhưng không gì giống một hoá đơn API bán lẻ.

### Ví dụ 3: không tốn phí

```
free-combo
  1. kr/claude-sonnet-4.5
  2. if/qwen3-coder-plus
  3. qwen/qwen-plus
```

Chi phí: $0. Ràng buộc: bất cứ gì các tầng miễn phí nghĩ về bạn hôm nay.

### Ví dụ 4: chất lượng trước

```
quality-first
  1. cc/claude-opus-5
  2. cx/gpt-5.6-sol
  3. ag/gemini-4-argon-high
```

Không có fallback giá rẻ, có chủ ý: nếu cả ba đều cạn, nó thất bại ầm ĩ thay vì lặng lẽ tạo ra công việc yếu hơn.

### Ví dụ 5: mọi tầng, theo thứ tự

```
never-stuck
  1. ag/gemini-4-argon-high     ← free, surprisingly strong
  2. cc/claude-opus-5           ← subscription
  3. cx/gpt-5.6-sol             ← second subscription
  4. gh/claude-sonnet-4.6       ← third
  5. glm/glm-4.7                ← cheap
  6. minimax/MiniMax-M2.1       ← cheaper
  7. kr/claude-sonnet-4.5       ← free, good quality
  8. if/qwen3-coder-plus        ← free, variety
```

Tám bậc, mỗi bậc tốn ít hơn bậc trên, không bậc nào là chẳng-còn-gì-để-mất.

---

## Dùng một combo trong mọi công cụ

### Cursor

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding   (add as a custom model)
```

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
claude --model premium-coding
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
codex --model premium-coding "your prompt"
```

### Cline / Roo / Continue

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    premium-coding
```

### Từ một script

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer [your Vela key]" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [{"role": "user", "content": "Write a function that reverses a linked list."}],
    "stream": true
  }'
```

---

## Thói quen tốt

### 1. Kết thúc bằng một thứ miễn phí

```
✅ cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
❌ cc/claude-opus-5 → glm/glm-4.7
```

Chuỗi thứ hai có một vực thẳm ở cuối.

### 2. Quyết định bạn đang tối ưu cho điều gì

- **Chi phí:** giá rẻ trước, miễn phí cuối.
- **Chất lượng:** cao cấp trước, giá rẻ cuối.
- **Giá trị subscription:** subscription trước, miễn phí cuối.

Không có câu trả lời phổ quát, và thứ tự đúng thay đổi theo từng tuần.

### 3. Ghép combo với công việc

```
production code     : quality-first
everyday edits      : premium-coding
exploration         : budget-combo
other people's work : never-stuck
```

Bạn có thể giữ nhiều combo và chuyển bằng cách đổi một trường trong công cụ.

### 4. Kiểm tra xem chuỗi thực sự đã làm gì

Trang **Routed by Combo** hiển thị model nào đã trả lời từng request, nên một combo lặng lẽ luôn rơi vào bậc cuối là điều nhìn thấy được, chứ không phải một điều bí ẩn.

### 5. Gán một ngưỡng cho các key dùng chung

Với một key được các agent hoặc job nền dùng, hãy đặt một ngưỡng chi tiêu. Một combo có thể đưa bạn xuống chuỗi, nhưng nó không chặn được việc bạn tiêu tiền; một ngân sách thì có.

---

## Nâng cao

### Chiến lược theo từng combo

Một combo có thể ưu tiên round-robin thay vì fallback nghiêm ngặt — hữu ích khi các thành viên ngang chất lượng và bạn muốn trải tải. Đặt trong **Settings → Routing**.

### Tạm thời vô hiệu hoá một model

Hãy vô hiệu hoá một model trên trang nhà cung cấp của nó thay vì xoá nó khỏi mọi combo; combo bỏ qua nó và giữ nguyên hình dạng cho khi bạn bật lại.

### Xuất và nhập

Combos có thể được xuất và nhập từ trang Combos, cách dễ nhất để chuyển một thiết lập đang chạy sang máy thứ hai.

---

## Khắc phục sự cố

### Tên combo không được nhận ra

- Kiểm tra tên được viết đúng y như đã lưu (phân biệt chữ hoa chữ thường).
- Khởi động lại công cụ nếu nó cache danh sách model lúc khởi động.
- Xác nhận combo đã được lưu — nó nên xuất hiện trong danh sách Combos.

### Nó luôn rơi vào model cuối

Điều đó nghĩa là những cái trước đang thất bại. Xem **Quota** và **Providers**: thường là một token đã hết hạn, một hạn mức đã cạn, hoặc một nhà cung cấp đang sập.

### Nó tốn hơn dự kiến

- Xem **Routed by Combo** để biết nó đã rơi xuống bao nhiêu lần.
- Đọc các mức giá trong [Nhà cung cấp giá rẻ](../providers/cheap.md) — token output tốn 3–4× input trên tầng giá rẻ.
- Sắp xếp lại: đặt thành viên rẻ hơn lên trước nếu chất lượng cho phép.

### Một request thất bại thay vì fallback

Một số lỗi không thể thử lại ở nơi khác — một request bị định dạng sai sẽ thất bại y như vậy trên mọi model. Hãy đọc nội dung lỗi trước khi cho rằng chuỗi bị hỏng.

---

## Liên quan

- [Định tuyến thông minh](smart-routing.md) — cách một request chọn nhà cung cấp
- [Theo dõi Quota](quota-tracking.md) — đọc mức dùng và chi phí
- [Nhà cung cấp giá rẻ](../providers/cheap.md) — những con số đằng sau các chuỗi
