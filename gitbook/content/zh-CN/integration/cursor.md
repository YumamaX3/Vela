# Cursor 集成

Cursor 可以使用自定义的 OpenAI 兼容端点。把它指向 Vela，每一次聊天、行内编辑和自动补全调用都会经过网关 —— 被路由、被跟踪，并受你的密钥与预算约束。

## 前提条件

- 已安装 Cursor
- 本地运行着 Vela，或有一个可访问的云端端点
- 来自 Vela 仪表盘的 API Key（**端点与密钥 → 创建密钥**）

## ⚠️ 事先值得了解的事

> **自定义端点可能需要付费的 Cursor 套餐。** Cursor 在不同版本和套餐之间变动过这项能力。如果你的构建中没有提供基础 URL 字段，那是 Cursor 的限制，而不是 Vela 的。

> **localhost 可能不够用。** 某些 Cursor 配置会通过 Cursor 自己的服务器发送请求，而那些服务器眼中的 `localhost` 是 Cursor 的机器，而不是你的。如果当浏览器能访问仪表盘时请求却以连接错误失败，原因就在这里 —— 请把 Vela 部署到 Cursor 能访问的地方（参见[云端部署](../deployment/cloud.md)），并改用那个地址。

> **在 HTTPS 下使用域名，而不是裸 IP。** 如果你把 Vela 放在反向代理之后，请给它一张 TLS 证书 —— API Key 是随请求一起传输的。

## 配置

### 1. 打开 Cursor 的模型设置

**设置**（`Cmd/Ctrl + ,`）→ **Models**。

### 2. 启用自定义 OpenAI 端点

打开 **OpenAI API key**，寻找 **Override OpenAI Base URL** 字段。如果你的构建中有它，那就没问题了。

### 3. 设置基础 URL

```
http://localhost:32060/v1
```

保留 `/v1`。没有它的 URL 会访问到仪表盘而不是 API，并以令人困惑的 HTML 响应失败。

### 4. 粘贴你的密钥

密钥形如 `vela-v1-<id>-<checksum>`。如果你还没有，请从 **端点与密钥 → 创建密钥** 获取一个新的 —— 密钥只显示一次。

### 5. 添加模型

在 **View All Models → Add custom model** 下，按 Vela 解析模型的精确 id 添加：

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding          ← 组合名称在这里同样可用
```

### 6. 选择它

在 Cursor 的聊天模型选择器中选中该模型并发送一条消息。在 Vela 仪表盘的 **用量** 下确认它已经到达。

## 配置示例

```
OpenAI API:        ✓ 已启用
Base URL:          http://localhost:32060/v1
API key:           vela-v1-xxxxxxxx-xxxxxxxx
Custom models:     cc/claude-opus-5, cc/claude-sonnet-5, glm/glm-4.7
```

## 可用模型

网关列出的任何模型 —— 运行 `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` 查看你的。常用选择：

| 模型 | 通道 |
|-------|------|
| `cc/claude-opus-5` | Claude 订阅 |
| `cc/claude-sonnet-5` | Claude 订阅 |
| `cx/gpt-5.6-sol` | Codex 订阅 |
| `glm/glm-4.7` | 低价 |
| `minimax/MiniMax-M2.1` | 最便宜 |
| `kr/claude-sonnet-4.5` | 免费 |

组合在这里同样有效，也正是用 Cursor 搭配 Vela 的理由：当一个模型的配额关闭时，下一个会在对话中途接手。

## 用法

- **聊天**（`Cmd/Ctrl + L`）—— 选择 Vela 模型并提问。
- **行内编辑**（`Cmd/Ctrl + K`）—— 选中代码，输入提示，接受。
- **解释** —— 选中代码，提问，如果你在使用链条，可在 **Routed by Combo** 下查看是由哪个模型应答的。

## 故障排查

### "Invalid API key"

1. 在 **端点与密钥** 下确认该密钥存在且已启用。
2. 复制完整的密钥 —— 从 `vela-v1-` 一直到末尾的校验和。
3. 旧式 `sk-...` 格式的密钥早于当前方案，会被拒绝；请新建一个。

### "Model not found"

1. 使用 `/v1/models` 中的精确 id。
2. 检查该提供商是否已在 **提供商** 中连接。
3. 记住提供商已下线的模型无法解析，无论怎么拼写。

### 连接失败

1. 确认 Vela 有应答：`curl http://localhost:32060/api/health`。
2. 确认基础 URL 以 `/v1` 结尾。
3. 如果 Cursor 的服务器处在链路中，`localhost` 就无法工作 —— 请使用已部署的端点。

### 字段缺失

某些 Cursor 构建与套餐不提供自定义基础 URL。Vela 这一侧无法添加它。替代方案：在 VS Code 中使用 Cline、Roo 或 Continue，它们都接受基础 URL。

## 云端端点

在带证书的服务器上：

```
Base URL:  https://your-domain.example/v1
API key:   [your Vela key]
```

这样无论 Cursor 在哪里运行，都能访问 Vela。速率限制与提供商轮换完全相同；只是地址变了。

## 最佳实践

1. **每台机器或每个人一把密钥** —— 用量报告会告诉你谁花了多少。
2. **给它设置上限**，如果 Cursor 是无人值守运行的；支出上限是唯一能阻止失控循环的东西。
3. **在笔记本丢失或密钥被粘贴到不该去的地方时轮换密钥**。
4. **使用组合**，让配额之墙不会终结你的下午。
