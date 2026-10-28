# OpenAI Codex CLI 集成

只需在 `~/.codex/config.toml` 中加入一小段配置，就能让 Codex CLI 指向 Vela。这与仪表盘 **CLI 工具 → Codex** 页面为你写出的内容形状相同，因此你可以自己粘贴，也可以交给仪表盘完成。

## 前提条件

- 已安装 Codex CLI
- 本地运行着 Vela，或有一个你能访问的云端端点
- 来自 Vela 仪表盘的 API Key（**端点与密钥 → 创建密钥**）

## 配置

### 1. 编辑 `~/.codex/config.toml`

```toml
model = "cx/gpt-5.6-sol"
model_provider = "Vela"

[model_providers.Vela]
name = "Vela"
base_url = "http://localhost:32060/v1"
wire_api = "responses"
http_headers = { Authorization = "Bearer [your Vela key]" }
```

Codex 中的自定义提供商**只**通过上面这一行 `http_headers` 认证 —— `auth.json` 里的 `OPENAI_API_KEY` 属于内置的 `openai` 提供商，对于这样定义的提供商不会被读取。请把密钥放在这里，而不是那里。

### 2. 检查

```bash
curl -s http://localhost:32060/api/health      # → {"ok":true}
codex "Write a function that reverses a linked list"
```

然后查看仪表盘中的 **用量**；这次请求应当出现在那里。

### 3. 如果你更偏好环境变量

有些配置更偏好环境变量而非文件。对任何讲 OpenAI API 的工具来说，这也同样可行：

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

`config.toml` 是仪表盘生成的方式，也是更推荐的方式 —— 它能在一个新的 shell 中继续生效。

## 可用模型

| 模型 | 适合 |
|-------|----------|
| `cx/gpt-5.6-sol` | 当前编码旗舰 |
| `cx/gpt-5.6-terra` | 另一种现代选择 |
| `cx/gpt-5.6-luna` | 更轻、更快的工作 |
| `cx/gpt-5.5`、`cx/gpt-5.4` | 稳定的回退项 |

任何其他模型或组合同样可用 —— Codex 并不关心 id 的含义，只要 Vela 能解析它即可。

## 用法示例

```bash
# 写代码
codex --model cx/gpt-5.6-sol "Create a REST endpoint that paginates results"

# 解释代码
codex --model cx/gpt-5.6-terra "Explain what this does: $(cat myfile.js)"

# 使用回退链
codex --model quality-first "Plan the refactor"
```

## 故障排查

### 认证错误

1. 密钥必须位于 `[model_providers.Vela]` 内的 `http_headers` 中 —— `auth.json` 中的密钥不会用于自定义提供商。
2. 检查密钥是否完整、是否以 `vela-v1-` 开头。
3. 如有疑问，请在 **端点与密钥** 下新建一个；密钥创建后无法找回。

### 连接问题

1. `curl http://localhost:32060/api/health`。
2. 确认 `base_url` 以 `/v1` 结尾。
3. 检查是否有东西挡住了 32060 端口。

### 模型不可用

1. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。
2. 确认 Codex 提供商已在 Vela 中连接（**提供商**）。
3. 模型 id 会随上游变化；请从上面的列表中选择当前可用的。

## 云端端点

将 `base_url` 替换为你部署的地址（保留 `/v1`）：

```toml
base_url = "https://your-domain.example/v1"
```

旧文档提到了项目所有者的托管实例 `https://vela.my.id`；那是关于他们部署的上游事实，而不是这些文档所能承诺的服务。请使用你拥有凭据的端点。
