# Claude Code 集成

把 Claude Code 指向 Vela 只需两个环境变量。此后，你终端发出的每一个 Claude 请求都会经过网关 —— 这意味着它可以被路由、被跟踪，并被回退链覆盖。

## 前提条件

- 已安装 Claude Code CLI（`claude --version` 应输出版本号）
- 本地运行着 Vela，或有一个你能访问的云端端点
- 已在 Vela 仪表盘中创建 API Key（**端点与密钥 → 创建密钥**）

## 配置

### 1. 配置环境变量

把它们加入你的 shell 配置文件（`~/.zshrc`、`~/.bashrc` 或 `~/.bash_profile`）：

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

- `ANTHROPIC_BASE_URL` —— Claude Code 发送请求的地址。保留 `/v1`。
- `ANTHROPIC_AUTH_TOKEN` —— 你的 Vela 密钥。Claude Code 会把它作为 bearer token 发送；Vela 会将其作为 API Key 接受。

如果你希望默认由另一个模型应答，也请设置别名目标：

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. 重新加载 shell

```bash
source ~/.zshrc     # or ~/.bashrc
```

### 3. 验证

```bash
echo $ANTHROPIC_BASE_URL
curl -s http://localhost:32060/api/health      # → {"ok":true}
```

然后运行一个小提示词：

```bash
claude --model sonnet "Say hello in five words."
```

经由 Vela 收到回复，就说明已经接通。你可以在仪表盘中确认：**用量** 会显示这次请求。

## 模型别名

Claude Code 的简称会映射到上面环境变量所指向的模型：

| 别名 | 含义 | 由谁设置 |
|-------|---------|--------|
| `opus` | 你最重的模型 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | 你日常使用的模型 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | 你的快速模型 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

如果没有设置，Claude Code 会请求它通常使用的上游名称，由 Vela 在你已连接的提供商中解析。

## 用法示例

### 配合别名

```bash
claude --model opus   "Explain the trade-offs of an append-only log"
claude --model sonnet "Write a Python function that retries with backoff"
claude --model haiku  "Review this diff for typos"
```

### 使用完整的 Vela 模型名

```bash
claude --model cc/claude-opus-5 "Refactor this module"
```

### 使用组合

这正是 Vela 大显身手之处：如果订阅窗口在下午中途关闭，链条会继续前行。

```bash
claude --model premium-coding "Plan the migration"
```

配合 `cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5` 的组合。

## 设置文件

Claude Code 也会读取 `~/.claude/settings.json`，同样的值可以放在 `env` 块下：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:32060/v1",
    "ANTHROPIC_AUTH_TOKEN": "[your Vela key]"
  }
}
```

仪表盘可以替你写入：**CLI 工具 → Claude Code** 会填好基础 URL 与密钥，并在保存前向你展示结果。

## 故障排查

### 连接问题

1. `curl http://localhost:32060/api/health` → 应为 `{"ok":true}`。
2. `echo $ANTHROPIC_BASE_URL` → 应以 `/v1` 结尾。
3. 检查是否有东西挡住了 32060 端口，以及 Vela 是否绑定在你预期的位置（`vela --host 127.0.0.1` 会让它保持本地）。

### 找不到模型

1. 询问网关它有什么：`curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。
2. 检查该模型的提供商是否已在 **提供商** 中连接。
3. 记住模型 id 会随上游变化 —— 今天是 `cc/claude-opus-5`，下个季度可能是别的。

### 未授权 / 401

- 确认 `ANTHROPIC_AUTH_TOKEN` 中装的是 Vela 密钥（`vela-v1-...`），而不是 Claude 订阅令牌。
- 密钥只在创建时显示一次。如果你已经没有了，请在 **端点与密钥** 下再创建一个。

## 云端端点

要使用已部署的 Vela 而非 localhost：

```bash
export ANTHROPIC_BASE_URL="https://your-domain.example/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

项目自己托管的实例在旧文档中显示为 `https://vela.my.id` —— 那是项目所有者自己的部署，是一个上游事实，而不是这些文档所能承诺的服务。请使用你实际拥有凭据的端点。
