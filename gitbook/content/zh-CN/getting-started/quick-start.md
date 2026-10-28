# 快速开始

五分钟，一个端点，所有工具都指向它。本页是快速通道；更详细的说明与故障排查见[安装](../getting-started/installation.md)。

---

## 快速开始

### 1. 安装

```bash
npm install -g vela
```

你需要 Node.js 20 或更新版本。`vela` 命令是一个小巧的启动器：它会启动网关并打开浏览器。

### 2. 启动

```bash
vela
```

仪表盘会在 **http://localhost:32060/dashboard** 打开。

首次运行时，有几点值得知道：

- **没有默认密码**。在运行 Vela 的这台机器上，仪表盘可以直接进入。在你于 **设置 → 访问** 中设置密码之前，来自其他机器的登录会被拒绝。
- 在 macOS 和 Linux 上，你的数据位于 `~/.vela`；在 Windows 上位于 `%APPDATA%\vela`。
- 默认情况下，网关监听所有网络接口（`0.0.0.0`）。如果你只在本机使用，请用 `vela --host 127.0.0.1` 启动。

### 3. 连接提供商

提供商共有三类，你可以自由混用。

#### 方案 A —— OAuth 订阅

**最适合：** Claude Code、Codex、GitHub Copilot、Antigravity —— 任何你已经在付费或登录的服务。

```
仪表盘 → 提供商 → 选择一个提供商 → 连接
→ 在浏览器窗口中登录 → 完成
```

此后 token 会自动刷新，配额跟踪即刻开始。

**示例：Claude Code**
1. 打开 **提供商**，选择 **Claude**。
2. 点击 **连接**，登录你的 Claude 账户并授权。
3. 使用模型的完整名称调用，例如 `cc/claude-opus-5`。

#### 方案 B —— API Key

**最适合：** GLM、MiniMax、Kimi、OpenRouter，以及任何其他按量付费的提供商。

```
仪表盘 → 提供商 → 选择一个提供商 → 添加 API Key
→ 粘贴密钥 → 保存
```

**示例：GLM-4.7**
1. 在你的 GLM 提供商处创建账户并生成密钥。
2. 在 Vela 中：**提供商 → GLM → 添加 API Key**，粘贴并保存。
3. 使用 `glm/glm-4.7`。

#### 方案 C —— 免费提供商

**最适合：** 付费配额耗尽时的最后一道防线。

```
仪表盘 → 提供商 → 连接一个免费提供商
→ 设备码或 OAuth → 完成
```

**示例：Kiro**
1. 打开 **提供商**，选择 **Kiro**。
2. 使用 AWS Builder ID 或社交账户登录。
3. 使用 `kr/` 模型 —— Claude 系列，零成本。

### 4. 为你的工具创建 API Key

```
仪表盘 → 端点与密钥 → 创建密钥 → 复制
```

密钥形如 `vela-v1-<id>-<checksum>`。它只显示一次 —— 请复制到安全的地方，若丢失只能稍后重新创建。每个密钥都可以单独设置提供商范围、速率限制、token 预算和支出上限。

### 5. 让工具指向 Vela

每个工具都需要同样的两样东西：端点和密钥。

**Cursor**

```
设置 → 模型 → OpenAI API
  基础 URL：http://localhost:32060/v1
  API Key： [你的 Vela 密钥]
  模型：    cc/claude-opus-5     （作为自定义模型添加）
```

**Cline / Continue / Roo**

```
提供商：OpenAI Compatible
基础 URL：http://localhost:32060/v1
API Key： [你的 Vela 密钥]
模型：    cc/claude-opus-5
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

**Codex CLI**

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

每个工具在[集成](../integration/claude-code.md)下都有自己的页面，列出确切的字段和常见坑。

---

## 6. 构建回退链（可选，但推荐）

单一模型就是单一故障点。**组合**让你为一条模型链命名，Vela 会沿着它逐级尝试，直到有一个应答。

```
仪表盘 → 组合 → 创建
  名称：  premium-coding
  模型：  1. cc/claude-opus-5      （订阅优先）
          2. glm/glm-4.7           （低价备用）
          3. kr/claude-sonnet-4.5  （免费兜底）
```

之后在任何需要填写模型名的地方，使用 `premium-coding` 即可。组合会在其他一切之前按名称查找，因此在任何工具中都能工作。

组合在请求失败时才会回退 —— 配额错误、速率限制、超时、被拒绝的提示词、不存在的模型。它**不会**仅仅因为每日配额偏低就切换；那会悄悄花掉你的钱。如果你想要支出上限，请在 API Key 上设置（**端点与密钥 → 创建/编辑密钥 → 预算**），一旦触达上限，Vela 会以明确的 429 拒绝请求，而不是悄悄降级。

---

## 可用模型

模型名称的格式为 `prefix/model`。以下是起步集合；请在仪表盘的 **提供商** 中查看完整列表 —— 它会随提供商发布新模型而变化。

### 订阅层

**Claude Code（`cc/`）**
- `cc/claude-opus-5` —— 主力担当
- `cc/claude-sonnet-5` —— 日常均衡之选
- `cc/claude-haiku-4-5-20251001` —— 快速轻量

**Codex（`cx/`）**
- `cx/gpt-5.6-sol`、`cx/gpt-5.6-terra`、`cx/gpt-5.6-luna` —— 当前家族
- `cx/gpt-5.5`、`cx/gpt-5.4` —— 仍在，且依然好用

**GitHub Copilot（`gh/`）**
- `gh/claude-sonnet-4.5`、`gh/claude-opus-4.5`、`gh/gpt-5.4`

**Antigravity（`ag/`）**
- `ag/gemini-4-argon-high` 以及 Gemini 家族其余模型，外加 Claude 模型

### 低价层

**GLM（`glm/`）** —— `glm/glm-4.7`，每 1M token $0.60 / $2.20，另有更新的 `glm-5.x` 模型

**MiniMax（`minimax/`）** —— `minimax/MiniMax-M2.1`，每 1M token $0.30 / $1.20，另有 M2.5、M2.7 和 M3

**Kimi（`kimi/`）** —— `kimi/kimi-latest`、`kimi/kimi-k2.5`、`kimi/k3`

### 免费层

**iFlow（`if/`）** —— `if/qwen3-coder-plus`、`if/kimi-k2`、`if/glm-4.7`、`if/deepseek-r1` 等

**Qwen（`qwen/`）** —— `qwen/qwen-plus`、`qwen/qwen-max`、`qwen/qwen-turbo`

**Kiro（`kr/`）** —— `kr/claude-sonnet-4.5`、`kr/claude-opus-4.8`，以及更新的 Claude 模型

> **关于免费额度：** Gemini CLI 所报告的每月 180K 次补全、Meta 或 Google 的每日限额等数字，**都是那些提供商公布的上游数字** —— 并非 Vela 所能控制。它们此前变过，今后也还会变。请以仪表盘上的实时配额读数为准。

---

## 保持低成本

一套实用流程，不需要电子表格：

```
1. 把订阅模型放在组合的最前面。
2. 把 GLM 或 MiniMax 放在第二位 —— 只是任何零售 API 成本的一小部分。
3. 始终以免费提供商收尾，让链条永不断路。
4. 对你交给长期运行工具的 API Key 设置预算上限。
```

[低价提供商](../providers/cheap.md)与[免费提供商](../providers/free.md)页面提供了带算式的工作示例。

---

## 下一步

- [安装](../getting-started/installation.md) —— 环境要求、Docker、源码构建、卸载
- [智能路由](../features/smart-routing.md) —— 请求如何选择提供商
- [组合](../features/combos.md) —— 构建与调优回退链
- [配额跟踪](../features/quota-tracking.md) —— 读懂仪表盘
- [常见问题](../faq.md) —— 所有人最先问的问题
- [故障排查](../troubleshooting.md) —— 当某些东西连不上时

---

## 需要帮助？

- **网站**：[vela.my.id](https://vela.my.id)
- **GitHub**：[github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**：[github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)

Vela 当前版本为 1.2.4。用以下命令查看你运行的版本：

```bash
npm list -g vela
```
