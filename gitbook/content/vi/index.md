# Chào mừng đến với Vela

**Dùng Claude, Codex và Gemini qua một endpoint duy nhất — rồi tiếp tục lập trình trên các phương án dự phòng giá rẻ hoặc miễn phí khi subscription của bạn cạn dần.**

Vela là một cổng nhỏ nằm giữa các công cụ lập trình của bạn và các nhà cung cấp AI. Bạn chỉ mọi công cụ về cùng một địa chỉ, và Vela quyết định nhà cung cấp nào sẽ trả lời mỗi request — trước tiên là nhà cung cấp có quota bạn đã trả tiền, sau đó là một nhà cung cấp giá rẻ, rồi đến một nhà cung cấp miễn phí.

Nếu bạn từng nhìn một tháng quota Claude Code trôi qua mà không dùng đến, hoặc mất cả tiếng đồng hồ vì rate limit ngay giữa một lần refactor, thì Vela được sinh ra cho đúng buổi chiều như thế.

---

## Vela là gì, nói một cách giản dị?

Các công cụ lập trình của bạn (Cursor, Cline, Continue, Claude Code, Codex, và hàng chục công cụ khác) đều nói cùng một thứ tiếng "tương thích OpenAI": cho chúng một base URL và một key, chúng sẽ trò chuyện với bất cứ thứ gì trả lời ở đó.

Vela trả lời ở đó. Phía sau nó là những nhà cung cấp mà bạn kết nối — tài khoản đăng nhập Claude Code của bạn, tài khoản Codex, một key GLM, một tài khoản Kiro miễn phí — và Vela định tuyến mỗi request đến nhà cung cấp phù hợp để phục vụ nó.

**Điều này sửa được những gì:**
- ❌ Quota subscription hết hạn mỗi tháng mà không dùng đến
- ❌ Rate limit chặn bạn ngay giữa câu
- ❌ Nhiều API trả phí, mỗi cái một hoá đơn hàng tháng
- ❌ Tự tay chuyển đổi công cụ giữa các nhà cung cấp

**Bạn nhận được gì thay vào đó:**
- ✅ **Subscription được dùng đến token cuối cùng** — Claude Code, Codex, Copilot và các tài khoản tương tự, được theo dõi theo thời gian thực
- ✅ **Dự phòng giá rẻ** — GLM-4.7 với $0.60 / $2.20 mỗi 1M tokens, MiniMax M2.1 với $0.30 / $1.20
- ✅ **Fallback miễn phí** — iFlow, Qwen và Kiro, không tốn một đồng
- ✅ **Fallback tự động** — khi một cái cạn, cái kế tiếp tiếp quản mà bạn không hề hay biết

---

## Tính năng chính

### 🔄 Ba tầng, một endpoint

Bạn chỉ đặt thứ tự một lần rồi tiếp tục lập trình:

```
Tier 1 (SUBSCRIPTION): Claude Code → Codex → Copilot
  ↓ quota exhausted
Tier 2 (CHEAP):        GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ spend cap reached
Tier 3 (FREE):         iFlow → Qwen → Kiro

→ The next one answers. You keep typing.
```

Tầng 2 và tầng 3 không tự có — trừ khi bạn dựng chúng nên. Một **combo** chính là cách bạn đặt tên cho chuỗi ấy; [hướng dẫn Combos](features/combos.md) dẫn qua từng bước dựng một combo chỉ trong vài cú nhấp.

### 📊 Theo dõi quota

- Lượng token tiêu thụ theo từng nhà cung cấp, theo thời gian thực
- Đếm ngược thời điểm reset (theo giờ, ngày, tuần, tháng)
- Ước tính chi phí cho các tầng trả phí
- Ngưỡng ngân sách cho mỗi API key, nếu bạn muốn những giới hạn cứng

### 🎯 Hoạt động với mọi công cụ tương thích OpenAI

✅ **Cursor** • **Cline** • **Claude Code** • **Codex CLI** • **Roo** • **Continue** • **bất kỳ công cụ nào khác nhận base URL**

### 💰 Một tháng thực tế

Một lập trình viên dùng 100M tokens mỗi tháng, phần lớn qua quota họ đã sở hữu sẵn:

```
60M via Gemini CLI        : $0   (free allowance, upstream figure)
30M via Claude Code       : $0   (subscription you already pay for)
 8M via GLM-4.7            : about $4.80
 2M via MiniMax M2.1       : about $0.40
```

[Trang các nhà cung cấp giá rẻ](providers/cheap.md) đi qua từng con số này theo từng dòng.

---

## Vela hỗ trợ bao nhiêu nhà cung cấp?

Câu trả lời trung thực là ba con số, bởi chúng đo ba thứ khác nhau. Cả ba được đo vào ngày 2026-10-28 tại phiên bản 1.2.5, và bạn có thể tự suy ra chúng bất cứ lúc nào:

| Số lượng | Ý nghĩa | Cách tự kiểm tra |
|-|-|-|
| **189** | tệp nhà cung cấp trong registry — mọi thứ ai đó từng viết | `ls open-sse/providers/registry/*.js \| grep -v index.js \| wc -l` |
| **186** | các mục ứng dụng thực sự nhìn thấy (ba tệp cố ý không được import) | `node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"` |
| **145** | các transport mà một request thực sự có thể chạm tới | `node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"` |

Vậy là: **145 nhà cung cấp bạn có thể gọi đến**, trong 186 mà ứng dụng nhìn thấy, trong 189 đã được ghi ra.

Những khoảng trống tự giải thích. Ba tệp (`devin-cli`, `trae`, `windsurf`) nằm trên đĩa nhưng bị comment out khỏi index được sinh ra — hai tệp thiếu hỗ trợ tool-calling vững chắc, một tệp khởi chạy một agent cục bộ có quyền truy cập shell — nên không ai nhìn thấy chúng. 41 mục còn lại trong 186 là những mục không khai báo transport nào: media, công cụ, hoặc công việc đang dang dở, không có gì gửi được request chat đến chúng. Mọi tệp, dù được import hay không, vẫn có ý nghĩa với ai đó đang đọc registry; không tệp nào trong số đó là một con số marketing. Hãy chạy ba lệnh trên trong bản clone của bạn và bạn sẽ nhận được con số của hôm nay, không phải của tháng sau.

Xét theo cách xác thực, 186 mục ứng dụng nhìn thấy chia thành 131 nhà cung cấp dùng API key, 23 tài khoản đăng nhập OAuth, 22 tầng miễn phí, 7 nhà cung cấp dùng web cookie và 3 không cần tài khoản nào cả. Bạn không cần nhớ điều đó — phòng **Providers** trong dashboard liệt kê đủ.

---

## Tại sao mọi người chọn Vela

### Nhận trọn giá trị từ những gì bạn đã trả tiền

Đang dùng Claude Code hoặc Codex? Vela theo dõi còn bao nhiêu quota, chuyển đổi giữa các tài khoản và giữ một đồng hồ đếm ngược đến lúc reset. Mục tiêu rất đơn giản: dùng hết những gì bạn đã mua trước khi nó hết hạn.

### Giá rẻ khi những cái tốt đã cạn

| Provider | Per 1M tokens | Typical reset |
|----------|---------------|---------------|
| **GLM-4.7** | $0.60 in / $2.20 out | daily |
| **MiniMax M2.1** | $0.30 in / $1.20 out | rolling window |
| **Kimi** | subscription plans | monthly |

Đây là mức giá chính Vela dùng để ước tính chi phí (`open-sse/providers/pricing.js`); hoá đơn từ nhà cung cấp của bạn là tiếng nói cuối cùng.

### Miễn phí khi mọi thứ khác đã tiêu hết

- **iFlow** — tài khoản miễn phí, nhiều model (Qwen3, Kimi K2, GLM 4.7, DeepSeek và hơn thế nữa)
- **Qwen** — các model Qwen trên chính tài khoản Qwen
- **Kiro** — các model Claude thông qua một AWS Builder ID

Các tầng miễn phí có rate limit, và chúng thay đổi mà không báo trước. Chúng là lớp cuối cùng, không phải lớp đầu tiên.

---

## Bắt đầu nhanh

Hai phút, nếu Node.js 20 trở lên đã được cài:

```bash
# The launcher installs itself and starts the gateway
npm install -g vela
vela
```

Dashboard tự mở tại **http://localhost:32060/dashboard**. Không có mật khẩu mặc định: trình duyệt cục bộ đi thẳng vào, còn các phiên đăng nhập từ xa vẫn đóng cho đến khi bạn đặt mật khẩu trong **Settings → Access**.

Sau đó, trong bất kỳ công cụ lập trình nào:

```
Endpoint: http://localhost:32060/v1
API Key:  [create one under Dashboard → Endpoint & Key → Create Key]
Model:    cc/claude-opus-5        (or any model, or a combo name)
```

[→ Hướng dẫn bắt đầu đầy đủ](getting-started/quick-start.md)

---

## Mọi người dùng nó để làm gì

### Lập trình viên độc lập
Chạy mọi công cụ qua một endpoint, để subscription đi trước, và ngừng trả tiền cho credit API thêm "phòng khi cần".

### Đội nhóm nhỏ
Chạy Vela một lần trên một server nhỏ, phát cho mỗi người một API key riêng với ngưỡng chi tiêu của chính nó, và theo dõi mức dùng chung ở một nơi.

### Lập trình từ nhiều máy
Triển khai Vela trên một VPS hoặc container và kết nối đến nó từ laptop, tablet hay điện thoại. [Hướng dẫn triển khai cloud](deployment/cloud.md) bao quát phần này, kể cả reverse proxy mà bạn sẽ cần.

---

## Đi đâu tiếp theo

- [Bắt đầu nhanh](getting-started/quick-start.md) — chạy được trong năm phút
- [Cài đặt](getting-started/installation.md) — mọi phương thức cài đặt, chi tiết
- [Nhà cung cấp](providers/subscription.md) — ba tầng được giải thích: subscription, giá rẻ, miễn phí
- [Tính năng](features/smart-routing.md) — định tuyến, combos, theo dõi quota
- [Tích hợp](integration/claude-code.md) — nối các công cụ của bạn
- [Triển khai](deployment/localhost.md) — cục bộ, cloud, Docker
- [FAQ](faq.md) — câu trả lời ngắn cho những câu hỏi thường gặp

---

<div align="center">
  <sub>Built for developers who would rather code than babysit their API bills.</sub>
</div>
