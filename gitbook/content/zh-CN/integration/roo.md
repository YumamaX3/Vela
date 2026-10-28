# Roo AI 助手集成

Roo 是一个住在侧边栏里的 VS Code 智能体。把它指向 Vela，它就能用一把密钥、一个地址，触达你连接的所有模型。

## 前提条件

- 已在 VS Code 中安装 Roo
- 本地运行着 Vela，或有一个可访问的云端端点
- 来自 Vela 仪表盘的 API Key（**端点与密钥 → 创建密钥**）

## 配置步骤

### 1. 打开 Roo 的设置

启动 Roo，从侧边栏打开其设置面板。

### 2. 选择提供商类型

在 **API Provider** 下，选择 **OpenAI Compatible**。Vela 讲的是 OpenAI API，因此这是正确的形状 —— Roo 会要求填写基础 URL、密钥和模型 id。

### 3. 填写三个字段

**本地 Vela：**

```
Base URL:  http://localhost:32060/v1
API Key:   vela-v1-<id>-<checksum>
Model:     cc/claude-opus-5
```

**已部署的 Vela：**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-opus-5
```

### 4. 测试它

发送：

```
Hello! Can you confirm you're connected through Vela?
```

然后查看仪表盘中的 **用量** —— 这次请求应当出现在那里，并归属于那把密钥。

## 选择模型

| 模型 | 通道 | 用于 |
|-------|------|------------|
| `cc/claude-opus-5` | Claude 订阅 | 最难的任务 |
| `cc/claude-sonnet-5` | Claude 订阅 | 均衡的日常工作 |
| `cc/claude-haiku-4-5-20251001` | Claude 订阅 | 快速编辑 |
| `cx/gpt-5.6-sol` | Codex 订阅 | 编码密集的问题 |
| `glm/glm-4.7` | 低价 | 预算内的长会话 |
| `kr/claude-sonnet-4.5` | 免费 | 付费通道耗尽时 |

> **关于 `cc/` 通道的说明。** 本版本中，Claude Code 提供商（`claude`，别名 `cc`）带有**已弃用**标记与风险提示：它依赖一个未公开的 Claude Code 接口，可能在没有预告的情况下变化。它今天仍然可用，也是 Anthropic 订阅的自然之选 —— 如果它失效，请留意 `cx/` 以及免费的 `kr/` Claude 模型。

## 用法示例

```
快速任务       : cc/claude-haiku-4-5-20251001  或  glm/glm-4.7
均衡工作       : cc/claude-sonnet-5  或  cx/gpt-5.6-sol
困难推理       : cc/claude-opus-5
成本敏感       : glm/glm-4.7  →  kr/claude-sonnet-4.5
```

## 模型选择建议

- **快而便宜**的，用于重命名、修注释和小改动。
- **Sonnet 级**的，用于普通功能开发。
- **Opus 级**的，当任务横跨许多文件或逻辑微妙时。
- **一个组合**，当会话可能超出配额窗口时 —— 那决定了能否完成。

## 故障排查

### 连接失败

1. `curl http://localhost:32060/api/health` → `{"ok":true}`。
2. 检查基础 URL 以 `/v1` 结尾。
3. 检查密钥是否完整。
4. 重新加载 VS Code 窗口。

### 模型不可用

- id 必须完全匹配，包括大小写。
- 确认该提供商已在 **提供商** 中连接。
- 查看网关自己的列表：`curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。

### 响应缓慢

- 换用更轻的模型（`cc/claude-haiku-4-5-20251001`、`glm/glm-4.7`）。
- 裁剪上下文 —— 少附加一些文件。
- 检查提供商是否性能下降。

## 进阶

### 简短别名

如果 Roo 允许保存命名的模型预设，请按任务而非模型来命名：

```
"fast"  → cc/claude-haiku-4-5-20251001
"smart" → cc/claude-opus-5
"cheap" → glm/glm-4.7
"chain" → never-stuck
```

### 独立配置档

为不同类型的工作使用不同配置档 —— 编码、写作、研究 —— 各自拥有自己的模型和自己的 Vela 密钥，让用量落在正确的桶里。

## 下一步

- [Cursor](cursor.md) 用于 IDE 集成
- [Continue](continue.md) 用于 VS Code
- [组合](../features/combos.md) 了解值得使用的回退链
