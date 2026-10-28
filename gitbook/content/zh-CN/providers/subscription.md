# 订阅提供商 —— 最大化你的价值

你已经在为 Claude Code、Codex 或 Copilot 付费。订阅通道要做的，是把它们全部用出来：知道还剩多少、在重置前用掉，并在耗尽时干净利落地继续前行。

本页介绍人们最先连接的五个提供商、它们各自在上游的花费、今天可以调用的模型，以及如何让它们为你工作。

> **这里日期很重要。** 订阅档位、价格和模型名称由 Anthropic、OpenAI、GitHub 和 Google 决定 —— 而不是 Vela。本页的数字是截至 **2026-10-28**（Vela 1.2.5）的上游事实。提供商会频繁更改它们。

---

## 概览

订阅通道排在**最前**，因为钱已经花出去了：

- ✅ **Claude Code**（Pro/Max）—— 通过你的 Anthropic 订阅使用 Claude 家族
- ✅ **OpenAI Codex**（Plus/Pro）—— 通过你的 ChatGPT 套餐使用 GPT-5.x 家族
- ✅ **GitHub Copilot** —— 一份订阅，多家厂商的模型
- ✅ **Antigravity**（Google）—— 在你的 Google 账户上使用 Gemini 与 Claude 模型
- ✅ **Kimi** —— Moonshot 自有的编码套餐，通过 API Key 或登录添加

**思路：** 先用这些，实时盯着配额，并让一个低价或免费的提供商在它们身后待命。

---

## Claude Code（Pro/Max）

### 上游花费

| 档位 | 典型月费 | 配额形态 | 模型 |
|------|----------------------|-------------|--------|
| Pro | 约 $20 | 滚动窗口加每周刷新 | Opus、Sonnet、Haiku |
| Max | 约 $100 | 更大的滚动窗口加每周刷新 | Opus、Sonnet、Haiku |

这些是 Anthropic 公布的消费者价格；请查看你自己的套餐页面以了解适用于你的内容。

### 配置

> ⚠️ **一个值得事先说明的警示。** 本版本注册表中，Claude Code 提供商（`claude`，别名 `cc`）被标记为**已弃用，并附风险提示**。它依赖一个未公开的 Claude Code 接口，Anthropic 可能在没有预告的情况下更改。它今天可用 —— 但请把它视作一条可能需要修补的通道，而非保证。

**第 1 步：连接**

```
仪表盘 → 提供商 → Claude → 连接
```

**第 2 步：登录**

浏览器窗口会在 Claude 的登录页面打开。批准连接。此后 token 会自动刷新，配额跟踪立即开始。

**第 3 步：使用它**

模型名为 `cc/<model-id>`。本版本中包含的：

| 模型 | 适合 |
|-------|----------|
| `cc/claude-opus-5` | 困难问题、架构、大型重构 |
| `cc/claude-sonnet-5` | 日常工作，明智的默认值 |
| `cc/claude-fable-5` | 写作密集的任务 |
| `cc/claude-haiku-4-5-20251001` | 快速编辑、小问题 |

> 模型列表的变化比文档快。运行 `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` —— 或打开 **提供商 → Claude** —— 查看你的安装今天究竟提供什么。

### 充分利用它

- 生产工作中把 Opus 放在组合首位，其他一切把 Sonnet 放在首位。
- 如果你有多个账户，请都添加进去；Vela 可以在它们之间轮换。
- 在 **配额** 页面查看重置倒计时，而不是猜测。

---

## OpenAI Codex（Plus/Pro）

### 上游花费

| 档位 | 典型月费 | 配额形态 | 模型 |
|------|----------------------|-------------|--------|
| Plus | 约 $20 | 滚动窗口加每周刷新 | GPT-5.x 家族 |
| Pro | 约 $200 | 大得多的额度 | GPT-5.x 家族 |

### 配置

**第 1 步：连接**

```
仪表盘 → 提供商 → Codex → 连接
```

**第 2 步：登录**

OAuth 流程会在你的浏览器中打开（走回环地址；如果无头服务器上浏览器起不来，请复制 URL 在笔记本上完成，然后把回调粘贴回来）。token 会自动刷新。

**第 3 步：使用它**

| 模型 | 适合 |
|-------|----------|
| `cx/gpt-5.6-sol` | 当前编码旗舰 |
| `cx/gpt-5.6-terra` | 另一种现代选择 |
| `cx/gpt-5.6-luna` | 快速、更轻的工作 |
| `cx/gpt-5.5`、`cx/gpt-5.4` | 稳定的回退项 |

每个模型还有一个 `-review` 兄弟（例如 `cx/gpt-5.6-sol-review`），它消耗一个独立的配额族；在主通道紧张时值得了解。

### 充分利用它

- Codex 和 Claude 各自擅长不同类型的问题。`cc/claude-opus-5 → cx/gpt-5.6-sol` 的组合是一对强搭档。
- Pro 档大约是 Plus 额度的十倍 —— 只有在你经常耗尽 Plus 时才值得。

---

## GitHub Copilot

### 上游花费

| 档位 | 典型月费 | 重置 | 模型 |
|------|----------------------|-------|--------|
| Individual | 约 $10 | 每月 | 多家厂商 |
| Business | 约每位 $19 | 每月 | 多家厂商 |

### 配置

**第 1 步：连接**

```
仪表盘 → 提供商 → GitHub → 连接
```

**第 2 步：授权**

登录 GitHub 并批准 Copilot 授权。Vela 会保持 token 新鲜。

**第 3 步：使用它**

模型名为 `gh/<model-id>`，例如：

- `gh/claude-sonnet-4.6`、`gh/claude-opus-4.7`、`gh/claude-haiku-4.5`
- `gh/gpt-5.4`、`gh/gpt-5.3-codex`、`gh/gpt-5.2-codex`
- `gh/gemini-3.1-pro-preview`、`gh/gemini-3-flash-preview`

### 充分利用它

- Copilot 是那个异类：**一份订阅，多家厂商**。当你想要多样性又不想多一张账单时，它是组合里不错的第二或第三位。
- 每月重置意味着最好把它留作月底的储备，那时其他通道已经枯竭。

---

## Antigravity（Google 账户）

### 上游花费

Antigravity 是 Google 的智能体编码环境。它用 Google 账户即可免费使用，有自己的配额，同时提供 Gemini 和 Claude 模型。

### 配置

**第 1 步：连接**

```
仪表盘 → 提供商 → Antigravity → 连接
```

**第 2 步：使用 Google 登录**

批准连接，然后使用名为 `ag/<model-id>` 的模型：

- `ag/gemini-4-argon-high`（以及 `-medium`、`-low` 这些更便宜、更快的变体）
- `ag/gemini-3.8-flash`、`ag/gemini-3.7-flash`，以及其他 Gemini 代际
- Claude 模型（如果你的账户提供的话）

### 充分利用它

- `-high`/`-medium`/`-low` 后缀是真实的成本杠杆：同一模型家族，token 花费差别很大。
- 因为它是免费的，所以在任何实验性质的组合里都应排在最前面。

---

## Kimi（Moonshot）

### 上游花费

Moonshot 直接销售编码套餐。Vela 可以通过登录或 API Key 访问它们，取决于你的账户支持哪一种。

### 配置

```
仪表盘 → 提供商 → Kimi → 连接（登录）   —— 或 ——   添加 API Key
```

模型名为 `kimi/<model-id>`：`kimi/kimi-latest`、`kimi/kimi-k2.5`、`kimi/k3`、`kimi/kimi-for-coding`。

---

## 并排对比

| 提供商 | 月费（上游） | 登录方式 | 重置 | 亮点 |
|----------|--------------------|----------------|-------|----------|
| **Claude Code Pro** | 约 $20 | OAuth | 滚动 + 每周 | 最佳的长篇代码质量 |
| **Claude Code Max** | 约 $100 | OAuth | 滚动 + 每周 | 最大的 Claude 额度 |
| **Codex Plus** | 约 $20 | OAuth | 滚动 + 每周 | 最强的单一用途编码模型 |
| **Codex Pro** | 约 $200 | OAuth | 滚动 + 每周 | 约为 Plus 的 10 倍 |
| **GitHub Copilot** | 约 $10–19 | OAuth | 每月 | 多家厂商，一张账单 |
| **Antigravity** | **免费** | Google OAuth | 自有节奏 | Gemini + Claude 零成本 |
| **Kimi** | 视套餐而定 | 登录或密钥 | 每月 | 长上下文编码 |

---

## 一个完整示例

**Cursor、Cline，或任何 OpenAI 兼容工具。**

如果你有一个名为 `premium-coding` 的组合（Claude 第一、GLM 第二、Kiro 最后）：

```
设置 → 模型
  基础 URL：http://localhost:32060/v1
  API Key： [你的 Vela 密钥]
  模型：    premium-coding
```

如果你只想用订阅，跳过组合，直接使用 `cc/claude-opus-5`。

**构建该组合：**

```
仪表盘 → 组合 → 创建
  名称：   premium-coding
  模型：   1. cc/claude-opus-5      ← 订阅
          2. glm/glm-4.7           ← 低价
          3. kr/claude-sonnet-4.5  ← 免费兜底
```

---

## 观察配额

**配额** 页面按提供商显示：

- 窗口已用多少，以进度条和百分比表示
- 何时重置，以倒计时表示
- 对于付费通道，到目前为止花费了多少

**用量** 页面按模型、组合和 API Key 显示同样的支出，覆盖今天、7、14、30 和 60 天，或全部时间。

---

## 最佳实践

### 1. 如果目标是成本，免费与低价优先

```
1. Antigravity（免费的 Claude / Gemini）
2. Claude Code 或 Codex（你已付费）
3. GLM-4.7（低价）
4. iFlow 或 Kiro（免费）
```

如果目标是*在困难问题上追求质量*，那把订阅放在最前 —— 没有放之四海皆准的正确顺序，只有匹配你本周所做之事的顺序。

### 2. 看清重置时间

滚动窗口在首次使用后几小时重置；每日和每月窗口在固定时间重置。每月重置前一天的繁重工作是白白花掉的配额。

### 3. 使用组合，并在末尾放一个免费提供商

以免费通道收尾的组合，永远不会让你在半句话中途卡住。

---

## 故障排查

### "Quota exhausted"

等待重置（查看倒计时），或者让组合落到下一个模型。没有其他东西坏了。

### "OAuth token expired"

Vela 会自动刷新 token；出现过期消息通常意味着刷新本身失败了。前往 **提供商 → [提供商] → 断开**，然后再次 **连接**。

### 配额看起来还有，却被限流

速率限制和配额是两种不同的限制。提供商即使在额度尚存时也可能拒绝突发请求；答案就是回退链，而不是等待。

### 模型名称被拒绝

模型可能已在上游被重命名。询问网关它实际拥有什么：

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>" | grep claude
```

---

## 下一步

- **低价备用：** [低价提供商](cheap.md)
- **免费兜底：** [免费提供商](free.md)
- **构建一条链：** [组合](../features/combos.md)
