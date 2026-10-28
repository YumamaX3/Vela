# Cline 集成

Cline 是一个为你读取、编辑和运行代码的 VS Code 扩展。把它指向 Vela，它就能使用你连接的任何模型 —— 并且在任务中途配额关闭时获得一条回退链。

## 前提条件

- 已安装 VS Code
- 已从 VS Code 应用市场安装 Cline 扩展
- 本地运行着 Vela，或有一个可访问的云端端点
- 来自 Vela 仪表盘的 API Key（**端点与密钥 → 创建密钥**）

## 配置

### 1. 打开 Cline 的设置

点击 VS Code 侧边栏中的 Cline 图标，再点击 Cline 面板中的齿轮图标。

### 2. 选择 OpenAI Compatible 提供商

在 **API Provider** 下拉菜单中，选择 **OpenAI Compatible**。这是使用 Vela 的正确选择 —— 它接受 OpenAI 形状的基础 URL 和密钥。

### 3. 设置基础 URL

```
http://localhost:32060/v1
```

包含 `/v1`。云端部署形状相同，只是主机不同：

```
https://your-domain.example/v1
```

### 4. 粘贴你的密钥

你的 Vela 密钥形如 `vela-v1-<id>-<checksum>`。它在创建时只显示一次，如果你弄丢了，请在 **端点与密钥** 下新建一个。

### 5. 设置模型 id

Cline 接受自由文本的模型 id。请使用 Vela 能解析的：

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding            ← 组合名称同样可用
```

### 6. 保存

关闭设置面板；Cline 会随输入自动保存。发送一条简短消息确认，然后查看 Vela 仪表盘中的 **用量**。

## 配置示例

```
API Provider:  OpenAI Compatible
Base URL:      http://localhost:32060/v1
API Key:       vela-v1-xxxxxxxx-xxxxxxxx
Model:         cc/claude-opus-5
```

### 仪表盘写入的内容

Cline 把设置保存在磁盘上的两个文件里。仪表盘的 Quick Connect 会打印完全相同的形状，如果你更愿意编辑文件而不是点击界面，也可以手动粘贴：

```json
// ~/.cline/data/globalState.json
{ "openAiBaseUrl": "http://localhost:32060", "actModeApiProvider": "openai" }
```

```json
// ~/.cline/data/secrets.json
{ "openAiApiKey": "vela-v1-<id>-<checksum>" }
```

注意它与上面那个字段的差别：**这里的 `openAiBaseUrl` 省略了 `/v1`** —— Cline 会自己追加路径。在该字段中填入 `http://localhost:32060/v1` 会产生 `/v1/v1/chat/completions` 和一个 404。请使用仪表盘的片段，或通过 Cline 自己的设置面板输入 URL，它会替你处理后缀。

## 可用模型

网关列出的任何模型：`curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。

| 模型 | 通道 | 适合 |
|-------|------|----------|
| `cc/claude-opus-5` | Claude 订阅 | 复杂的多文件工作 |
| `cc/claude-sonnet-5` | Claude 订阅 | 日常编辑 |
| `cx/gpt-5.6-sol` | Codex 订阅 | 棘手的编码问题 |
| `glm/glm-4.7` | 低价 | 预算内的长时间运行 |
| `minimax/MiniMax-M2.1` | 最便宜 | 超长上下文 |
| `kr/claude-sonnet-4.5` | 免费 | 付费通道枯竭时 |

> **关于 `cc/` 通道的说明。** 本版本注册表中，Claude Code 提供商（`claude`，别名 `cc`）被标记为**已弃用，并附风险提示**。它仍然可用，也是大多数人对其 Anthropic 订阅的首选 —— 但它依赖一个未公开的 Claude Code 接口，可能在没有预告的情况下变化。如果它开始失败，免费的 `kr/` Claude 模型和 `cx/` 通道是稳妥的替代方案。

## 用法

### 聊天

在 Cline 面板中输入并按回车。Cline 会通过 Vela 发送对话，以及它选择读取的任何文件。

### 代码生成

请求一项改动（"为这个端点添加分页"）。Cline 会提出编辑；在接受前请审阅 —— 就像你对任何智能体那样谨慎。

### 文件操作

Cline 可以创建、修改和删除文件。Vela 不会改变这一行为；它只决定由哪个模型来规划和执行。这里的回退确实有用：步骤之间的模型切换能让长任务继续推进。

## 故障排查

### "Connection failed"

1. `curl http://localhost:32060/api/health` → 应当有应答。
2. 确认基础 URL 以 `/v1` 结尾。
3. 检查 32060 端口的防火墙。
4. 重新加载 VS Code 窗口（`Cmd/Ctrl + Shift + P` → "Reload Window"）。

### "Invalid API key"

- 密钥必须以 `vela-v1-` 开头。旧式 `sk-...` 格式的密钥会被拒绝。
- 完整复制它，不要带上末尾的换行。
- 如果旧密钥曾被公开粘贴，请新建一个 —— 旧密钥无法再次显示。

### "Model not found"

- 使用 `/v1/models` 中的精确 id。
- 确认该提供商已在 **提供商** 中连接。
- 模型 id 会随上游变化；已下线的 id 无论怎么拼写都无法解析。

### Cline 在任务中途停止

这常常是配额窗口关闭或速率限制所致。使用一个组合（`cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`）可以让下一步在下一个模型上继续，而不是停下。

## 进阶

### 使用组合

```
Model: never-stuck
```

配合一条以免费提供商收尾的链。长时间运行的智能体受益最大 —— 它们正是那种半小时左右就会撞上配额墙的工作负载。

### 按任务切换模型

常备两三个 id，随工作变化而更换字段：

- 重度推理与重构 → `cc/claude-opus-5`
- 日常编辑 → `glm/glm-4.7`
- 实验 → `kr/claude-sonnet-4.5`

### 超时

带长上下文的大规模编辑可能超过 Cline 的请求超时。如果 Cline 提供该选项，请在 VS Code 设置中调高它，或者拆分任务 —— Vela 会以提供商的速度进行流式输出。

## 最佳实践

1. **给 Cline 一把专属密钥**，并设置支出上限。反复循环的智能体会以惊人的速度烧掉预算；一个上限能让那变成一次停止，而不是一张账单。
2. **让对话保持聚焦** —— 上下文是主要的成本来源。
3. **绝不要提交密钥。** 它活在 VS Code 设置中，而不是仓库里。
4. **在使用链条时，于 Routed by Combo 中留意是哪个模型应答的**：它会告诉你回退是否在发挥作用。
