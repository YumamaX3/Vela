# Continue VSCode 扩展集成

Continue 是一款面向 VS Code 和 JetBrains 的开源 AI 助手。它读取一个 `config.json`，仅凭这个文件，你就能让它经由 Vela 路由。

## 前提条件

- 已安装 Continue 扩展的 VS Code
- 本地运行着 Vela，或有一个可访问的云端端点
- 来自 Vela 仪表盘的 API Key（**端点与密钥 → 创建密钥**）

## 配置步骤

### 1. 打开 Continue 的配置

- `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`（Windows/Linux）
- 运行 **Continue: Open Config**
- 这会打开 `~/.continue/config.json`

### 2. 添加 Vela 模型

Continue 当前的配置格式使用 `models` 数组：

**单模型：**

```json
{
  "models": [
    {
      "title": "Vela — Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**多模型，便于在下拉菜单中切换：**

```json
{
  "models": [
    {
      "title": "Vela — Opus（困难任务）",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — Sonnet（日常）",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — GLM（低价）",
      "provider": "openai",
      "model": "glm/glm-4.7",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**对于已部署的 Vela**，修改 `apiBase`：

```json
"apiBase": "https://your-domain.example/v1"
```

> 如果你的 Continue 版本仍使用此处所示的旧式 `models`/`apiBase` 结构，它照此书写即可工作。较新的构建可能在首次启动时让你运行一个小型配置向导；同样的三个值 —— 提供商 `openai`、模型 id、基础 URL —— 填写在同样的位置。

### 3. 保存并重新加载

保存文件，然后执行 **Developer: Reload Window**。Continue 会在加载时读取配置。

### 4. 选择一个模型

打开 Continue 侧边栏，从顶部下拉菜单中选择模型。

## 可用模型

网关列出的任何模型 —— 用以下命令查看：

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

| 模型 | 通道 |
|-------|------|
| `cc/claude-opus-5` | Claude 订阅 |
| `cc/claude-sonnet-5` | Claude 订阅 |
| `cc/claude-haiku-4-5-20251001` | Claude 订阅 |
| `cx/gpt-5.6-sol` | Codex 订阅 |
| `cx/gpt-5.4` | Codex 订阅 |
| `glm/glm-4.7` | 低价 |
| `minimax/MiniMax-M2.1` | 最便宜 |
| `kr/claude-sonnet-4.5` | 免费 |

组合也可以作为模型 id 使用。

## 用法示例

- **解释：** 选中代码，打开侧边栏，提问"解释一下这段"。
- **生成：** 请求"一个用于用户资料的 React 卡片组件"。
- **重构：** 选中代码，提问"把这段重构为 async/await"。
- **调试：** 粘贴堆栈跟踪，问哪里出了问题。

## 进阶

### 系统提示词

```json
{
  "models": [
    {
      "title": "Vela — 代码专家",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1",
      "systemMessage": "你是一名资深工程师。偏好小而可审阅的改动，并解释权衡。"
    }
  ]
}
```

### 温度

```json
"temperature": 0.9,
"topP": 0.95
```

对于代码，温度通常越低越好；对于写作，越高越好。

### 上下文提供者

Continue 决定随提示词一并发送什么。对 Continue 用户而言，收紧这一点是成本方面最大的杠杆：

```json
{
  "contextProviders": [
    { "name": "code", "params": { "maxLines": 100 } },
    { "name": "diff", "params": {} }
  ]
}
```

## 键盘快捷键

- `Cmd/Ctrl + L` —— 打开聊天
- `Cmd/Ctrl + I` —— 行内编辑
- `Cmd/Ctrl + Shift + R` —— 重新生成

（快捷键因版本而异；VS Code 的键盘快捷方式面板会列出你当前的。）

## 故障排查

### 模型没有响应

1. `curl http://localhost:32060/api/health` → `{"ok":true}`。
2. 检查 `config.json` 中的密钥。
3. 打开 VS Code 的开发者控制台（**Help → Toggle Developer Tools**）并读取错误。

### 应答的是错误的模型

- 检查侧边栏的下拉菜单 —— Continue 会记住上次的选择。
- 模型 id 区分大小写。

### 配置未加载

- 校验 JSON（多余的尾逗号通常是罪魁祸首）。
- 确认路径是 `~/.continue/config.json`。
- 保存后重新加载窗口。

### 慢

- 使用更轻的模型。
- 裁剪上下文：更少的 `maxLines`、更少的附加文件。
- 检查到 Vela 的网络延迟。

## 最佳实践

1. **三个模型，三档价格** —— Opus 用于思考，Sonnet 用于写作，GLM 用于杂活。切换只需一次点击。
2. **先选中，再提问** —— 发送整个文件是昂贵的习惯。
3. **如果 Continue 运行在共享机器上，请为密钥设置上限**。

## 下一步

- [Cursor](cursor.md) 用于 IDE
- [Roo](roo.md) 用于另一个智能体
- [组合](../features/combos.md) 了解回退链
