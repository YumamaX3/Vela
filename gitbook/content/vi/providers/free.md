# Nhà cung cấp miễn phí - Fallback không tốn phí

Tầng miễn phí là lớp cuối cùng. Khi subscription đã hết và tầng giá rẻ đã chạm trần, các nhà cung cấp này vẫn trả lời — không tốn của bạn một đồng.

Ba trong số đó đi kèm sẵn để kết nối: iFlow, Qwen và Kiro. Cả ba đều dùng những tài khoản bạn có thể tạo miễn phí, và cả ba đều có giới hạn của riêng chúng do nhà cung cấp đặt ra, không phải Vela.

---

## Tổng quan

- 🆓 **iFlow** — một tài khoản miễn phí với thực đơn model rộng: Qwen3, Kimi K2, DeepSeek, GLM, và hơn thế nữa
- 🆓 **Qwen** — các model của chính Qwen, trên nền tảng của chính Qwen
- 🆓 **Kiro** — dòng Claude thông qua một AWS Builder ID hoặc đăng nhập mạng xã hội

**Ý tưởng:** đặt một trong số này ở cuối mọi combo. Khi ấy, "mọi thứ đều hết quota" không còn là một sự cố khẩn cấp nữa, mà chỉ là một buổi chiều chậm hơn một chút.

> **Trung thực về chữ "miễn phí".** Các tầng miễn phí bị giới hạn tốc độ, thỉnh thoảng không khả dụng, và thay đổi mà không báo trước. Các nhà cung cấp công bố hạn mức của họ; Vela hiển thị những gì tài khoản của bạn thực sự còn lại trên trang **Quota**. Bất cứ điều gì khác — một tiêu đề như "180K requests một tháng" — là một con số thượng nguồn có thể dịch chuyển.

---

## iFlow

### Bạn nhận được gì

Một lần đăng nhập, một thực đơn. Nhà cung cấp mà bản phát hành này đi kèm:

| Model | Tốt cho |
|-------|----------|
| `if/qwen3-coder-plus` | sinh mã nguồn |
| `if/qwen3-max` | model đa dụng Qwen3 mạnh nhất |
| `if/qwen3-235b-a22b-thinking-2507` | các tác vụ nặng về suy luận |
| `if/kimi-k2` | lập trình ngữ cảnh dài |
| `if/deepseek-r1` | suy luận từng bước |
| `if/deepseek-v3.2` | trò chuyện đa dụng nhanh |
| `if/glm-4.7` | cùng model với tầng giá rẻ, không tốn phí |
| `if/qwen3-vl-plus` | thị giác |

### Thiết lập

**Bước 1: kết nối**

```
Dashboard → Providers → iFlow → Connect
```

**Bước 2: đăng nhập**

Trình duyệt mở trang đăng nhập của iFlow. Tạo một tài khoản nếu bạn chưa có, phê duyệt kết nối, và Vela từ đó giữ token luôn mới.

Một số tài khoản iFlow xác thực bằng session cookie thay vì OAuth; nếu dashboard đưa ra một trường cookie, hãy dán giá trị nó yêu cầu.

**Bước 3: dùng nó**

```
Model: if/qwen3-coder-plus
```

### Tại sao nó là lựa chọn miễn phí đầu tiên

Sự đa dạng. Một tài khoản chạm tới model của nhiều nhà cung cấp khác nhau, khiến nó là mặc định tốt khi bạn không muốn phải nghĩ xem nên thử nhà cung cấp miễn phí nào.

---

## Qwen

### Bạn nhận được gì

Các model của chính Qwen, do Qwen phục vụ:

| Model | Tốt cho |
|-------|----------|
| `qwen/qwen-max` | model đa dụng mạnh nhất |
| `qwen/qwen-plus` | cân bằng |
| `qwen/qwen-turbo` | tác vụ nhanh, nhẹ |
| `qwen/qwen-long` | tài liệu rất dài |

### Thiết lập

```
Dashboard → Providers → Qwen → Connect or Add API key
```

Tuỳ tài khoản của bạn, đó là một lần đăng nhập hoặc một key từ console của Qwen. Sau đó dùng model như `qwen/qwen-plus`.

### Khi nào nên dùng nó

- Khi iFlow bị rate limit và bạn cần gì đó ngay bây giờ.
- Cho công việc trên tài liệu dài, nơi `qwen/qwen-long` có lợi thế.
- Như bậc thứ hai của một combo chỉ-miễn-phí.

---

## Kiro (Claude không mất phí)

### Bạn nhận được gì

Dòng Claude qua Kiro, môi trường lập trình của AWS:

| Model | Tốt cho |
|-------|----------|
| `kr/claude-sonnet-5` | sự cân bằng thường ngày |
| `kr/claude-sonnet-4.5` | một lựa chọn đã được chứng minh ổn định |
| `kr/claude-opus-4.8`, `kr/claude-opus-5` | những bài toán khó |
| `kr/claude-haiku-4.5` | tác vụ nhanh |

Mỗi model còn có các biến thể `-thinking` và `-agentic` (`kr/claude-sonnet-4.5-thinking`, và tương tự) khi bạn muốn thấy rõ quá trình suy luận.

### Thiết lập

**Bước 1: kết nối**

```
Dashboard → Providers → Kiro → Connect
```

**Bước 2: chọn một cách đăng nhập**

AWS Builder ID là lựa chọn thường lệ; đăng nhập Google và GitHub cũng được nhà cung cấp cung cấp.

**Bước 3: dùng nó**

```
Model: kr/claude-sonnet-4.5
```

### Tại sao nó là lựa chọn chất lượng

Đó là cùng họ model bạn vẫn phải trả tiền, nhưng không tốn gì. Điều đó khiến `kr/...` trở thành mục "miễn phí nhưng vẫn tốt" tự nhiên trong một combo — cái bạn dùng cho công việc thật thay vì thử nghiệm.

---

## So sánh cạnh nhau

| Provider | Tiền tố | Model đi kèm | Đăng nhập | Giỏi nhất ở |
|----------|--------|-----------------|-------|---------|
| **iFlow** | `if/` | 15 | OAuth hoặc cookie | sự đa dạng |
| **Qwen** | `qwen/` | 4 | đăng nhập hoặc key | tài liệu dài |
| **Kiro** | `kr/` | 44 | AWS Builder ID / mạng xã hội | chất lượng Claude |

---

## Dùng chúng trong các công cụ của bạn

### Một model miễn phí, trực tiếp

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    kr/claude-sonnet-4.5
```

### Một combo chỉ-miễn-phí

```
Dashboard → Combos → Create
  Name:   zero-cost
  Models: 1. kr/claude-sonnet-4.5      ← quality first
          2. if/qwen3-coder-plus        ← variety
          3. qwen/qwen-plus             ← last resort
```

Chi phí: không, mãi mãi. Tốc độ và tính khả dụng: bất cứ gì các tầng miễn phí cho phép hôm nay.

### Combo đủ ba tầng

```
Dashboard → Combos → Create
  Name:   never-stuck
  Models: 1. cc/claude-opus-5          ← subscription
          2. cx/gpt-5.6-sol            ← second subscription
          3. glm/glm-4.7               ← cheap
          4. minimax/MiniMax-M2.1      ← cheaper
          5. kr/claude-sonnet-4.5      ← free, still good
          6. if/qwen3-coder-plus       ← free, variety
```

Đây là chuỗi mà toàn bộ thiết kế đang hướng tới: dùng những gì bạn đã trả tiền, fallback sang những gì rẻ, và không bao giờ kết thúc bằng hư không.

**Cơ chế fallback hoạt động thế nào:** một combo chuyển sang model kế tiếp khi một request *thất bại* — lỗi quota, rate limit, timeout, prompt bị từ chối, model không xác định. Nó không chủ động chuyển chỉ vì hạn mức ngày đang cạn dần. Nếu bạn muốn một ngưỡng cứng, hãy đặt trên API key (**Endpoint & Key → budget**); khi ấy Vela từ chối bằng 429 thay vì lặng lẽ tiêu tiền.

---

## Tận dụng tối đa các tầng miễn phí

### 1. Đặt chúng ở cuối, và thật lòng

Một model miễn phí đứng đầu sẽ hút hết công việc của bạn và để quota trả phí hết hạn mà chẳng dùng đến. Một model miễn phí đứng cuối không tốn gì mà cứu được cả ngày.

### 2. Ghép model với công việc

```
Reasoning / tricky code : if/qwen3-235b-a22b-thinking-2507, kr/claude-opus-4.8
Everyday coding         : kr/claude-sonnet-4.5, if/qwen3-coder-plus
Fast and cheap          : qwen/qwen-turbo, if/deepseek-v3.2
Long documents          : qwen/qwen-long
Vision                  : if/qwen3-vl-plus
```

### 3. Đừng xây production chỉ trên chúng

Các tầng miễn phí thay đổi mà không báo trước: một model biến mất, một giới hạn siết lại, một nhà cung cấp có một buổi chiều tồi tệ. Hãy dùng chúng như sàn của một chuỗi, không phải toàn bộ mặt bằng.

### 4. Để ý độ ưu tiên, không chỉ quota

Các tầng miễn phí thường điều tiết bằng độ ưu tiên thay vì từ chối thẳng: request của bạn xếp sau các khách hàng trả phí. Nếu phản hồi có vẻ chậm, đó thường là lý do, và chuyển sang một nhà cung cấp miễn phí khác chính là cách sửa.

---

## Khắc phục sự cố

### "OAuth failed"

- Kiểm tra bạn đang có mạng và trang của nhà cung cấp tải được trong một trình duyệt bình thường.
- Thử một trình duyệt khác, hoặc một cửa sổ riêng tư đã tắt tiện ích mở rộng.
- Ngắt kết nối rồi kết nối lại từ **Providers**.

### "Model not available"

- Xác nhận nhà cung cấp hiển thị là đã kết nối trong **Providers**.
- Xác nhận id model đúng y như gateway liệt kê: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### "Slow responses"

Các tầng miễn phí có độ ưu tiên thấp nhất. Hãy thử một nhà cung cấp miễn phí khác, làm việc vào những giờ yên ắng hơn, hoặc để combo đi tiếp.

### "It worked yesterday and stopped today"

Đó là bản chất của một tầng miễn phí. Hãy kết nối lại, thử một model khác trên cùng nhà cung cấp, hoặc dựa vào một nhà cung cấp miễn phí khác cho đến khi nó trở lại.

---

## Bước tiếp theo

- **Bắt đầu với subscription:** [Nhà cung cấp Subscription](subscription.md)
- **Thêm một tầng giữa giá rẻ:** [Nhà cung cấp giá rẻ](cheap.md)
- **Dựng và tinh chỉnh một chuỗi:** [Combos](../features/combos.md)
