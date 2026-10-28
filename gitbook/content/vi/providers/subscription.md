# Nhà cung cấp Subscription - Tối đa hóa Giá trị

Bạn đang trả tiền cho Claude Code, hoặc Codex, hoặc Copilot. Tầng subscription là chuyện lấy lại trọn vẹn: biết còn bao nhiêu, dùng hết trước khi nó reset, và rời đi gọn ghẽ khi nó cạn.

Trang này bao quát năm nhà cung cấp mà người ta kết nối trước tiên, mỗi cái tốn bao nhiêu ở phía thượng nguồn, những model nào bạn có thể gọi hôm nay, và cách đưa chúng vào việc.

> **Ngày tháng quan trọng ở đây.** Các gói subscription, giá và tên model do Anthropic, OpenAI, GitHub và Google đặt ra — không phải Vela. Những con số trên trang này là sự thật phía thượng nguồn tính đến **2026-10-28** (Vela 1.2.4). Các nhà cung cấp thay đổi chúng thường xuyên.

---

## Tổng quan

Tầng subscription đứng **đầu tiên** bởi tiền đã tiêu rồi:

- ✅ **Claude Code** (Pro/Max) — dòng Claude qua subscription Anthropic của bạn
- ✅ **OpenAI Codex** (Plus/Pro) — dòng GPT-5.x qua gói ChatGPT của bạn
- ✅ **GitHub Copilot** — một subscription, model của nhiều nhà cung cấp
- ✅ **Antigravity** (Google) — các model Gemini và Claude trên tài khoản Google của bạn
- ✅ **Kimi** — gói lập trình của chính Moonshot, thêm bằng API key hoặc đăng nhập

**Ý tưởng:** dùng những cái này trước, theo dõi quota theo thời gian thực, và để một nhà cung cấp giá rẻ hoặc miễn phí chờ sẵn phía sau.

---

## Claude Code (Pro/Max)

### Tốn bao nhiêu ở phía thượng nguồn

| Gói | Giá hàng tháng điển hình | Hình dạng quota | Model |
|------|----------------------|-------------|--------|
| Pro | khoảng $20 | cửa sổ cuốn chiếu cộng làm mới hàng tuần | Opus, Sonnet, Haiku |
| Max | khoảng $100 | cửa sổ cuốn chiếu lớn hơn cộng làm mới hàng tuần | Opus, Sonnet, Haiku |

Đó là giá tiêu dùng Anthropic công bố; hãy xem trang gói của chính bạn để biết điều gì áp dụng cho bạn.

### Thiết lập

> ⚠️ **Một lưu ý đáng nói ngay từ đầu.** Trong bản phát hành này, nhà cung cấp Claude Code (`claude`, bí danh `cc`) được đánh dấu **deprecated, kèm thông báo rủi ro** trong registry. Nó dựa trên một giao diện Claude Code không được tài liệu hoá, thứ Anthropic có thể thay đổi mà không báo trước. Nó hoạt động hôm nay — nhưng hãy xem nó là một tầng có thể cần vá, không phải một bảo đảm.

**Bước 1: kết nối**

```
Dashboard → Providers → Claude → Connect
```

**Bước 2: đăng nhập**

Một cửa sổ trình duyệt mở ra ở trang đăng nhập của Claude. Phê duyệt kết nối. Từ đó trở đi token tự làm mới, và việc theo dõi quota bắt đầu ngay lập tức.

**Bước 3: dùng nó**

Các model có dạng `cc/<model-id>`. Những cái có trong bản phát hành này:

| Model | Tốt cho |
|-------|----------|
| `cc/claude-opus-5` | bài toán khó, kiến trúc, refactor dài |
| `cc/claude-sonnet-5` | công việc thường ngày, mặc định hợp lý |
| `cc/claude-fable-5` | các việc nặng về viết lách |
| `cc/claude-haiku-4-5-20251001` | chỉnh sửa nhanh, câu hỏi nhỏ |

> Danh sách model di chuyển nhanh hơn tài liệu. Chạy `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` — hoặc mở **Providers → Claude** — để xem chính xác bản cài của bạn cung cấp gì hôm nay.

### Lấy được nhiều nhất từ nó

- Đặt Opus đầu tiên trong combo cho công việc production, Sonnet đầu tiên cho mọi thứ còn lại.
- Thêm nhiều tài khoản nếu bạn có; Vela có thể luân chuyển giữa chúng.
- Xem đồng hồ đếm ngược reset trên trang **Quota** thay vì đoán.

---

## OpenAI Codex (Plus/Pro)

### Tốn bao nhiêu ở phía thượng nguồn

| Gói | Giá hàng tháng điển hình | Hình dạng quota | Model |
|------|----------------------|-------------|--------|
| Plus | khoảng $20 | cửa sổ cuốn chiếu cộng làm mới hàng tuần | dòng GPT-5.x |
| Pro | khoảng $200 | hạn mức lớn hơn nhiều | dòng GPT-5.x |

### Thiết lập

**Bước 1: kết nối**

```
Dashboard → Providers → Codex → Connect
```

**Bước 2: đăng nhập**

Luồng OAuth mở ra trong trình duyệt (trên loopback; nếu trình duyệt không mở được trên một server không giao diện, hãy sao chép URL và hoàn tất nó trên laptop của bạn, rồi dán callback trở lại). Token tự làm mới.

**Bước 3: dùng nó**

| Model | Tốt cho |
|-------|----------|
| `cx/gpt-5.6-sol` | chiếc flagship hiện tại cho lập trình |
| `cx/gpt-5.6-terra` | một lựa chọn hiện đại thứ hai |
| `cx/gpt-5.6-luna` | công việc nhẹ, nhanh |
| `cx/gpt-5.5`, `cx/gpt-5.4` | các fallback ổn định |

Mỗi model còn có một người anh em `-review` (ví dụ `cx/gpt-5.6-sol-review`) rút từ một họ quota riêng; điều đáng biết khi tầng chính đang chật.

### Lấy được nhiều nhất từ nó

- Codex và Claude trả lời tốt những loại câu hỏi khác nhau. Một combo `cc/claude-opus-5 → cx/gpt-5.6-sol` là một cặp mạnh.
- Gói Pro có hạn mức xấp xỉ gấp mười lần Plus — chỉ đáng nếu bạn thường xuyên vét sạch Plus.

---

## GitHub Copilot

### Tốn bao nhiêu ở phía thượng nguồn

| Gói | Giá hàng tháng điển hình | Reset | Model |
|------|----------------------|-------|--------|
| Individual | khoảng $10 | hàng tháng | nhiều nhà cung cấp |
| Business | khoảng $19 mỗi ghế | hàng tháng | nhiều nhà cung cấp |

### Thiết lập

**Bước 1: kết nối**

```
Dashboard → Providers → GitHub → Connect
```

**Bước 2: uỷ quyền**

Đăng nhập GitHub và phê duyệt uỷ quyền Copilot. Vela giữ token luôn mới.

**Bước 3: dùng nó**

Các model có dạng `gh/<model-id>`, ví dụ:

- `gh/claude-sonnet-4.6`, `gh/claude-opus-4.7`, `gh/claude-haiku-4.5`
- `gh/gpt-5.4`, `gh/gpt-5.3-codex`, `gh/gpt-5.2-codex`
- `gh/gemini-3.1-pro-preview`, `gh/gemini-3-flash-preview`

### Lấy được nhiều nhất từ nó

- Copilot là cái khác biệt: **một subscription, nhiều nhà cung cấp**. Nó là mục thứ hai hoặc thứ ba tốt trong một combo khi bạn muốn sự đa dạng mà không thêm một hoá đơn nữa.
- Vì reset theo tháng, nó tốt nhất khi được giữ làm dự trữ cho cuối tháng, lúc các tầng khác đã khô.

---

## Antigravity (tài khoản Google)

### Tốn bao nhiêu ở phía thượng nguồn

Antigravity là môi trường lập trình dạng agent của Google. Nó miễn phí với một tài khoản Google, có quota riêng, và nó phơi ra cả model Gemini lẫn Claude.

### Thiết lập

**Bước 1: kết nối**

```
Dashboard → Providers → Antigravity → Connect
```

**Bước 2: đăng nhập bằng Google**

Phê duyệt kết nối, rồi dùng các model có dạng `ag/<model-id>`:

- `ag/gemini-4-argon-high` (và `-medium`, `-low` cho các biến thể rẻ hơn, nhanh hơn)
- `ag/gemini-3.8-flash`, `ag/gemini-3.7-flash`, và các thế hệ Gemini khác
- Các model Claude, nơi tài khoản của bạn có cung cấp

### Lấy được nhiều nhất từ nó

- Hậu tố `-high`/`-medium`/`-low` là một đòn bẩy chi phí thật: cùng một họ model, mức tiêu token rất khác nhau.
- Vì nó miễn phí, nó thuộc về đầu một combo cho bất cứ thứ gì mang tính thử nghiệm.

---

## Kimi (Moonshot)

### Tốn bao nhiêu ở phía thượng nguồn

Moonshot bán các gói lập trình trực tiếp. Vela có thể chạm tới chúng bằng đăng nhập hoặc bằng API key, tuỳ tài khoản của bạn hỗ trợ cách nào.

### Thiết lập

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

Các model có dạng `kimi/<model-id>`: `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`, `kimi/kimi-for-coding`.

---

## So sánh cạnh nhau

| Provider | Hàng tháng (thượng nguồn) | Cách đăng nhập | Reset | Điểm nổi bật |
|----------|--------------------|----------------|-------|----------|
| **Claude Code Pro** | khoảng $20 | OAuth | cuốn chiếu + hàng tuần | chất lượng code dài tốt nhất |
| **Claude Code Max** | khoảng $100 | OAuth | cuốn chiếu + hàng tuần | hạn mức Claude lớn nhất |
| **Codex Plus** | khoảng $20 | OAuth | cuốn chiếu + hàng tuần | model lập trình chuyên dụng mạnh nhất |
| **Codex Pro** | khoảng $200 | OAuth | cuốn chiếu + hàng tuần | ~10× Plus |
| **GitHub Copilot** | khoảng $10–19 | OAuth | hàng tháng | nhiều nhà cung cấp, một hoá đơn |
| **Antigravity** | **miễn phí** | Google OAuth | của riêng nó | Gemini + Claude không mất phí |
| **Kimi** | tuỳ gói | đăng nhập hoặc key | hàng tháng | lập trình ngữ cảnh dài |

---

## Một ví dụ đã tính sẵn

**Cursor, Cline, hay bất kỳ công cụ tương thích OpenAI nào.**

Nếu bạn có một combo tên `premium-coding` (Claude trước, GLM thứ hai, Kiro cuối):

```
Settings → Models
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding
```

Nếu bạn muốn riêng subscription, hãy bỏ qua combo và dùng thẳng `cc/claude-opus-5`.

**Dựng combo:**

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      ← subscription
          2. glm/glm-4.7           ← cheap
          3. kr/claude-sonnet-4.5  ← free last line
```

---

## Theo dõi quota

Trang **Quota** hiển thị, theo từng nhà cung cấp:

- bao nhiêu phần của cửa sổ đã dùng, dưới dạng thanh và phần trăm
- khi nào nó reset, dưới dạng đồng hồ đếm ngược
- với các tầng trả phí, nó đã tốn bao nhiêu từ đầu đến giờ

Trang **Usage** hiển thị cùng khoản chi ấy theo model, combo và API key, trong hôm nay, 7, 14, 30 và 60 ngày, hoặc toàn bộ thời gian.

---

## Thực hành tốt nhất

### 1. Miễn phí và giá rẻ trước, nếu mục tiêu là chi phí

```
1. Antigravity (free Claude / Gemini)
2. Claude Code or Codex (you already pay)
3. GLM-4.7 (cheap)
4. iFlow or Kiro (free)
```

Nếu mục tiêu là *chất lượng trên những bài toán khó*, hãy đặt subscription trước thay vào đó — không có thứ tự đúng phổ quát, chỉ có thứ tự khớp với việc bạn đang làm tuần này.

### 2. Nhìn vào thời điểm reset

Các cửa sổ cuốn chiếu reset vài giờ sau lần dùng đầu tiên; các cửa sổ ngày và tháng reset vào những thời điểm cố định. Làm việc nặng ngay trước ngày reset tháng là quota tiêu đi mà chẳng được gì.

### 3. Dùng một combo, và đặt một nhà cung cấp miễn phí ở cuối

Một combo kết thúc bằng một tầng miễn phí sẽ không bao giờ để bạn kẹt giữa một ý nghĩ.

---

## Khắc phục sự cố

### "Quota exhausted"

Chờ reset (xem đồng hồ đếm ngược), hoặc để combo rơi sang model kế tiếp. Không có gì khác bị hỏng.

### "OAuth token expired"

Vela tự làm mới token; một thông báo hết hạn thường có nghĩa chính việc làm mới đã thất bại. Vào **Providers → [provider] → Disconnect**, rồi **Connect** lại.

### Rate limited trong khi quota trông vẫn còn

Rate limit và quota là hai giới hạn khác nhau. Một nhà cung cấp có thể từ chối các request do bùng nổ dù vẫn còn hạn mức; chuỗi fallback là câu trả lời, không phải chờ đợi.

### Một tên model bị từ chối

Model có thể đã được đổi tên ở phía thượng nguồn. Hãy hỏi gateway xem nó thực sự có gì:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>" | grep claude
```

---

## Bước tiếp theo

- **Dự phòng giá rẻ:** [Nhà cung cấp giá rẻ](cheap.md)
- **Fallback miễn phí:** [Nhà cung cấp miễn phí](free.md)
- **Dựng một chuỗi:** [Combos](../features/combos.md)
