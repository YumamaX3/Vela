# 常见问题

人们最先问的问题，用大白话作答。如果这里没有对得上的，下一站是[故障排查](troubleshooting.md)。

---

## 什么是 Vela？

**你编码工具与 AI 提供商之间的网关。**

你把每个工具都指向同一个地址 —— `http://localhost:32060/v1` —— Vela 会把每个请求路由到你已连接的一个提供商。它跟踪配额、保持 OAuth token 新鲜，并能在某个模型拒绝时回退到另一个模型。

它不是模型，也不会让模型变得免费。它是你已经能访问的那些模型之间的交换机。

---

## Vela 是免费的吗？

**Vela 本身是免费且开源的（MIT）。**

花钱的是上游发生的事：Claude Code 订阅、Codex 套餐，或 GLM、MiniMax 这类按 token 付费的提供商。Vela 不会在上面加收任何费用。

如果你接受它们的限制，完全可以只靠免费提供商运行 —— iFlow、Qwen、Kiro、Antigravity。这个组合零成本。

---

## 路由是如何工作的？

有两种机制，它们各不相同：

1. **组合**是你定义的链：模型 1，然后模型 2，然后模型 3。当对某个模型的请求*失败*时 —— 配额错误、速率限制、超时、被拒绝的提示词、未知模型 —— Vela 会尝试下一个。
2. **轮询**（按提供商，或按组合）把请求分摊到同一提供商的多个账户上，避免一个账户被反复冲击。

两者都不会仅仅因为每日额度即将耗尽就把你切换到更便宜的模型。那会花掉你并未同意花的钱。

要设置硬性上限，请使用按密钥的预算：触达时，Vela 会以 429 拒绝并说明情况。

参见[智能路由](features/smart-routing.md)与[组合](features/combos.md)。

---

## Vela 支持多少提供商？

三个诚实的数字，于 2026-10-28 在 1.2.5 版本上测得：

- 注册表中 **189** 个提供商文件
- 由索引导入的 **186** 个（有三个被刻意注释掉：`devin-cli`、`trae`、`windsurf`）
- **145** 个拥有请求实际能够抵达的传输

你可以在自己的克隆中重新推导它们：

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

本文档逐条通道记载的：

- **订阅：** Claude Code、Codex、GitHub Copilot、Antigravity、Kimi
- **低价：** GLM、MiniMax、Kimi
- **免费：** iFlow、Qwen、Kiro

---

## 今天可以使用哪些模型？

模型 id 的格式为 `prefix/model`。本版本中几个可靠的：

| 模型 | 通道 |
|-------|------|
| `cc/claude-opus-5`、`cc/claude-sonnet-5` | Claude Code 订阅 |
| `cx/gpt-5.6-sol`、`cx/gpt-5.5` | Codex 订阅 |
| `gh/claude-sonnet-4.6`、`gh/gpt-5.4` | GitHub Copilot |
| `ag/gemini-4-argon-high` | Antigravity（免费） |
| `glm/glm-4.7` | 低价 —— 每 1M 输入 $0.60 / 输出 $2.20 |
| `minimax/MiniMax-M2.1` | 低价 —— 每 1M 输入 $0.30 / 输出 $1.20 |
| `kr/claude-sonnet-4.5` | 免费 |
| `if/qwen3-coder-plus` | 免费 |
| `qwen/qwen-plus` | 免费 |

不要相信文档胜过正在运行的网关：

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

那张列表才是你安装的真相。

---

## 可以同时使用多个提供商吗？

**可以 —— 这正是重点。** 构建一个组合：

```
仪表盘 → 组合 → 创建
  名称：   premium-coding
  模型：   1. cc/claude-opus-5       ← 订阅
          2. glm/glm-4.7            ← 低价
          3. kr/claude-sonnet-4.5   ← 免费
```

然后在任何工具中把 `premium-coding` 当作模型名使用。组合名称会在其他一切之前被解析，因此在网络上它看起来就像一个普通模型。

---

## Vela 能配合 Cursor 使用吗？

**可以。** Cursor 接受 OpenAI 兼容的基础 URL 和密钥。如果 Vela 运行在你的机器上：

```
Cursor → 设置 → 模型 → OpenAI API
  基础 URL：http://localhost:32060/v1
  API Key： [你的 Vela 密钥]
  模型：    你的模型或组合名称（作为自定义模型添加）
```

某些 Cursor 版本把自定义端点限制在付费套餐，某些配置会经由 Cursor 自己的服务器路由，那种情况下 `localhost` 从它们那一侧无法访问。在这种情形下，请把 Vela 部署在一台有公网地址的服务器上（参见[云端部署](deployment/cloud.md)），并改用 `https://your-domain/v1`。

其他接受基础 URL 的工具同理：Cline、Roo、Continue、Claude Code、Codex CLI，以及任何其他 OpenAI 兼容工具。参见[集成](integration/claude-code.md)。

---

## 我可以自行托管 Vela 吗？

**可以，而且这正是它本来的运行方式。** 三条路线：

**在你的机器上：**
```bash
npm install -g vela
vela
# 仪表盘：http://localhost:32060/dashboard
# API：   http://localhost:32060/v1
```

**使用 Docker，在任何服务器上：**
```bash
docker run -d --name vela \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.5
```

镜像是公开的 —— 拉取无需登录或令牌 —— 且支持多架构（amd64 与 arm64）。请固定标签，而不是使用 `:latest`。

**从源码：**
```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

仓库根目录就是应用；没有嵌套的 `app/` 目录。可用的脚本是 `dev`、`build`、`start`（以及它们的 Bun 变体）—— 没有测试脚本，也没有 Cloudflare 部署脚本。

完整细节：[本地](deployment/localhost.md) · [云端](deployment/cloud.md)。

---

## 我的数据安全吗？

**默认情况下，它留在你的机器上。**

- 一切都活在数据目录中 —— macOS/Linux 上是 `~/.vela`，Windows 上是 `%APPDATA%\vela`，或 `DATA_DIR` 指定的任何位置。
- 已连接提供商的 OAuth token 与 API Key 就存储在那个本地数据库中。
- Vela 只向你连接的提供商发送请求；不会向 Vela 项目回报任何东西。

**它保留什么：** 提供商连接与 token、你的 API Key（以哈希形式存储 —— 完整密钥只在创建时显示一次）、用量统计、组合、设置以及请求日志（仅在你启用时）。

**它不保留什么：** 在请求日志之外，不会保留你的提示词或生成代码的副本 —— 而请求日志默认关闭。

**在把它暴露到网络之前：** 在 **设置 → 访问** 中设置仪表盘密码，开启 **要求仪表盘登录**，考虑 **要求 API Key**，并把它放在 HTTPS 之后。清单见[云端部署](deployment/cloud.md)。

---

## 默认密码是什么？

**没有默认密码。**

老教程提到 `123456`；那个默认值早已退役。当前 Vela 完全没有默认密码：

- 在运行 Vela 的机器上，仪表盘无需询问即可打开。
- 从其他任何地方，在你于 **设置 → 访问** 中设置密码之前，登录都会被**拒绝**。

一旦这些控制就位，同一屏幕会显示绿色的"已设防"判定 —— 值得在开放端口前检查一下。

---

## 如何更新 Vela？

```bash
# npm install
npm update -g vela
npm list -g vela        # 你正在运行的版本

# Docker —— 刻意固定更新的标签
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# 用新标签重新运行你的 docker run 命令

# 从 git 检出
cd Vela && git pull && npm install && npm run build && npm run start
```

大版本升级前请先备份数据目录。数据库迁移会在启动时自动运行，并在运行前先做一份安全副本。

---

## 我可以如何贡献？

非常欢迎。

1. **报告 Bug** —— [GitHub Issues](https://github.com/YumamaX3/Vela/issues)，附上错误、复现步骤和你的版本。
2. **请求功能** —— [GitHub Discussions](https://github.com/YumamaX3/Vela/discussions)。
3. **提交代码：**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Vela.git
   cd Vela
   git checkout -b feature/your-feature
   npm install
   npm run dev
   ```
   在提交拉取请求之前，请运行仓库自带的检查套件，并保持提交小而具描述性。
4. **改进文档** —— 更正与翻译和功能一样有用。
5. **添加提供商** —— 适配器示例位于 `open-sse/providers/registry/` 下。

---

## Vela 使用哪些端口？

- **32060** —— 一切：仪表盘（`/dashboard`）与 API（`/v1`），由一个进程服务。
- 浏览器里的 **32060** 就是 `http://localhost:32060`；仪表盘在下一层，位于 `/dashboard`。

如果别的程序需要那个端口，请用 `vela --port 8080` 或 `PORT=8080` 更改。

---

## 出问题了我该去哪里？

1. `http://localhost:32060/api/health` 应当应答 `{"ok":true}`。如果没有，说明 Vela 没有在运行。
2. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` 应当列出模型。列表为空意味着没有连接任何提供商。
3. [故障排查](troubleshooting.md)把常见错误 —— 连接被拒绝、密钥无效、找不到模型、回复缓慢 —— 映射到对应的修复方法。

---

## 需要更多帮助？

- **文档：** [vela.my.id/docs](https://vela.my.id/docs)
- **GitHub：** [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues：** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **故障排查：** [troubleshooting.md](troubleshooting.md)
