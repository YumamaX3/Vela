# 安装

让 Vela 跑起来所需的一切：环境要求、四种安装方式、如何验证它正常工作，以及如何把它卸干净。如果你只想两分钟内跑起来，[快速开始](quick-start.md)是更短的路。

---

## 环境要求

### 系统要求

- **Node.js**：通过 npm 安装时，需要 20 或更新版本。官方 Docker 镜像内置 Node 22，Docker 用户可以跳过这一项。
- **npm**：10 或更新版本（随 Node.js 一起安装）。
- **操作系统**：macOS、Linux 或 Windows（Windows 原生可用；WSL 亦可）。
- **磁盘**：应用本身约需 500MB，使用历史增长时数据会占用更多。
- **内存**：约 1GB 即可从容运行。Docker 镜像默认设置 1GB 的堆上限。

检查你现有的环境：

```bash
node --version
# v20.x.x or newer

npm --version
# 10.x.x or newer
```

如果缺少 Node.js，请从 [nodejs.org](https://nodejs.org/) 安装，或使用 `nvm` 之类的版本管理器。

---

## 安装方式

### 方式 1：npm 全局安装（推荐）

```bash
npm install -g vela
vela
```

`vela` 命令是一个启动器。它会启动网关、等待端口应答，然后打开仪表盘。值得了解的参数：

```bash
vela                    # 在默认端口启动，打开浏览器
vela --port 8080        # 换一个端口
vela --host 127.0.0.1   # 仅本机（默认绑定 0.0.0.0）
vela --no-browser       # 不打开浏览器
vela --log              # 在终端显示服务器日志
vela --tray             # 在系统托盘中运行
vela --skip-update      # 启动时跳过更新检查
vela --help             # 其余全部
```

**为什么这是默认选择：**
- ✅ 在任何目录下都能运行
- ✅ 一条命令：`vela`
- ✅ `npm update -g vela` 保持最新
- ✅ 启动器会重启崩溃的服务器，并将其运行时二进制文件保存在 `~/.vela/runtime`，远离安装目录

### 方式 2：无需安装直接运行

如果你只想试一试：

```bash
npx vela
```

这会把启动器下载到 npm 缓存中并运行。不会全局安装任何东西，但数据目录（`~/.vela`）仍会创建，你的设置会在多次运行之间保留。

### 方式 3：Docker

适合服务器、NAS，或任何你不想安装 Node.js 的场景。

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.5
```

然后打开 **http://localhost:32060/dashboard**。

- 镜像**公开**。拉取它不需要 GitHub 登录、个人访问令牌或任何凭据。
- 镜像支持多架构：在普通服务器（`linux/amd64`）和 Raspberry Pi、Apple Silicon 上的 Docker 主机等 ARM 机器（`linux/arm64`）上都能原生运行。
- **固定标签。** `ghcr.io/yumamax3/vela:1.2.5` 是当前版本。`:latest` 会随新版本发布而移动，一次重启就可能悄悄把你换到并未选择的版本上。
- **务必挂载 `/app/data`。** 没有这个卷，你的数据库就生活在容器内部，会随之消失。

[云端部署指南](../deployment/cloud.md)深入讲解了 Compose、反向代理和环境变量。

### 方式 4：从源码构建

用于开发、打补丁，或构建你自己的镜像。

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

项目就位于克隆根目录 —— 没有嵌套的 `app/` 文件夹。脚本如下：

```bash
npm run dev        # 带热重载的开发服务器，端口 32060
npm run build      # 生产构建
npm run start      # 运行生产构建
```

`npm run dev` 用于开发 Vela 本身。部署时应当运行的是 `npm run build` 之后再 `npm run start`。

> ⚠️ **关于版本的说明：** 如果你构建出的版本行为与本文档不符，请查看 `package.json` —— 其中的 `version` 字段才是真相。本文档描述的是 **1.2.5**。

---

## 首次运行

### 启动服务器

```bash
vela
```

会发生什么：

1. 网关在 `http://localhost:32060` 启动。
2. 仪表盘在浏览器中通过 `/dashboard` 打开。
3. 创建数据目录 —— macOS 和 Linux 上为 `~/.vela`，Windows 上为 `%APPDATA%\vela` —— 或者你设置了 `DATA_DIR` 时使用指定的目录。
4. 没有别的了。**没有默认密码**，也没有预先生成的密钥。

### 仪表盘密码

老教程与现代 Vela 在这一点上有分歧，所以值得说清楚：

- **没有默认密码。** 不是 `123456`，不是 `admin`，什么都不是。
- **本地访问是开放的。** 在运行 Vela 的机器上，仪表盘无需任何验证即可加载。这是有意为之：登录自己的笔记本不应当成为负担。
- **在你设置密码之前，远程访问会被拒绝。** 如果有人从网络上的其他机器打开仪表盘，Vela 不会用一个从未被选择过的密码放他们进来。

要设置密码：**从运行 Vela 的机器上**打开仪表盘，进入 **设置 → 访问**，在那里设置。同一个界面还能让你要求仪表盘登录、开关 API 请求是否必须携带密钥，并一眼看出网关是否处于"已设防"状态 —— 这是你在把它暴露到网络之前想要看到的对勾。

或者，在首次启动前通过环境变量设置 `INITIAL_PASSWORD`；Vela 会将它作为登录密码接受。

### 为你的工具获取 API Key

```
仪表盘 → 端点与密钥 → 创建密钥
→ 复制出现的密钥（它只显示一次）
```

密钥形如 `vela-v1-<random>-<checksum>`。在同一个对话框中，你可以为它设定更窄的范围：它能访问哪些提供商、模型或组合；速率限制；每日/每周/每月 token 预算；以及支出上限。对于共享或长期运行的部署，请设置上限 —— 触达上限时 Vela 会以明确的 429 应答，而不是悄悄花钱。

---

## 验证安装

### 检查服务器是否存活

```bash
curl http://localhost:32060/api/health
```

预期结果：

```json
{"ok":true}
```

健康检查路由有意不要求认证，因此即使 `REQUIRE_API_KEY` 已开启，它也会应答。

### 列出你能使用的模型

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer vela-v1-your-key-here"
```

你会得到已连接的所有提供商的每一个模型。如果列表为空，说明还没有连接任何提供商 —— 参见[快速开始](quick-start.md)的第 3 步。

### 发送一次真实请求

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer vela-v1-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm/glm-4.7",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

收到回复，就意味着一切 —— 网关、密钥、提供商、路由 —— 都在正常工作。如果失败，错误文本会指明原因；[故障排查](../troubleshooting.md)把常见错误映射到对应的修复方法。

---

## 配置

### 环境变量

你可以在 shell 中、应用旁的 `.env` 文件中，或作为容器环境来设置它们。最先需要关心的几个：

```bash
# 安全 —— 任何非本地部署都必须设置
export JWT_SECRET="$(openssl rand -hex 32)"   # 为仪表盘会话签名
export INITIAL_PASSWORD="your-password"       # 可选的首次登录密码

# 存储
export DATA_DIR="$HOME/.vela"                 # 数据库所在的位置

# 服务器
export PORT="32060"                           # 默认端口
export NODE_ENV="production"
```

`JWT_SECRET` 值得一句警告：自 2026 年 10 月起，如果它仍是占位符或短于 32 个字符，Vela **拒绝启动**。请生成一个真正的密钥。完整的变量列表见仓库中的 `.env.example` 与 `docs/ENVIRONMENT.md`。

### 数据目录

默认：`~/.vela`（macOS/Linux）或 `%APPDATA%\vela`（Windows）。

```text
~/.vela/
  db/
    data.sqlite        # 提供商、组合、密钥、设置
    backups/           # 迁移前安全副本与定时备份
  logs/                # 请求日志（若启用）
  runtime/             # 由启动器管理的二进制文件
```

要迁移它：

```bash
export DATA_DIR="/srv/vela-data"
vela
```

在 Windows 上，类似 Unix 的路径（以 `/` 开头）会被忽略并给出警告，转而使用默认值 —— 这样的路径在那里并不存在。

### 端口配置

默认是 `32060`。通过参数或环境变量更改：

```bash
vela --port 8080
# or
PORT=8080 vela
```

如果你使用了其他端口，请更新每一个指向 `/v1` 的工具 —— 并保留基础 URL 末尾的 `/v1`。

---

## 安装故障排查

### 端口已被占用

```
Error: listen EADDRINUSE: address already in use :::32060
```

找到并停止该进程，或换一个端口：

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F

# or simply start elsewhere
vela --port 8080
```

### 权限被拒绝

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'
```

解决办法是给 npm 一个它拥有的目录，而不是使用 `sudo`：

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Node.js 版本过旧

```
Error: The engine "node" is incompatible with this module
```

更新 Node.js —— 若已有 `nvm` 就在其中更新，否则从 [nodejs.org](https://nodejs.org/) 安装：

```bash
nvm install 20
nvm use 20
```

### 仪表盘没有打开

请自行打开 `http://localhost:32060/dashboard`。如果它也加载不出来，请检查进程是否在运行（`vela --log` 会显示其输出），并检查防火墙：在 macOS 上，于 系统设置 → 网络 → 防火墙 中允许该 Node 进程；在 Linux 上，检查 `ufw` 或 `iptables`；在 Windows 上，通过 Windows Defender 防火墙允许它。

### 提供商无法连接

- 检查你是否在线（`ping 1.1.1.1`）。
- 在假定是本地故障之前，先查看该提供商的状态页。
- 对于 OAuth 提供商，尝试 **提供商 → [提供商] → 断开 → 重新连接**；会话过期常常看起来与安装损坏一模一样。

### 内存占用过高

重启网关（`Ctrl+C`，然后 `vela`）。对于长期运行的安装，请使用进程管理器：

```bash
npm install -g pm2
pm2 start vela --name vela
pm2 save
```

---

## 部署选项

### 在你自己的机器上

```bash
npm install -g vela
vela
```

**适合：** 个人编码、试用提供商、保持一切都在本地。

### 在服务器上

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="choose-a-password" \
  ghcr.io/yumamax3/vela:1.2.5
```

绑定到 `127.0.0.1` 意味着只有同一台机器上的反向代理才能访问仪表盘 —— 这是面向互联网的主机的安全默认值。[云端部署](../deployment/cloud.md)提供了完整的 Nginx 配置，以及关键的流式传输设置。

### 位于反向代理之后

流式响应（服务器发送事件）需要关闭缓冲，否则它们会在最后一股脑地到达：

```nginx
location / {
    proxy_pass http://127.0.0.1:32060;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
```

---

## 卸载

```bash
npm uninstall -g vela      # 移除启动器
rm -rf ~/.vela             # 移除数据、密钥与设置 —— 此操作不可逆
```

在 Windows 上，数据目录是 `%APPDATA%\vela`。然后删除你添加到 shell 配置中的任何导出语句。

如果你用的是 Docker：

```bash
docker stop vela && docker rm vela
docker rmi ghcr.io/yumamax3/vela:1.2.5
# 并移除你挂载的卷或宿主机目录
```

---

## 下一步

- [快速开始](quick-start.md) —— 连接提供商，让工具指向 Vela
- [提供商](../providers/subscription.md) —— 何时使用哪条通道
- [功能](../features/smart-routing.md) —— 路由、组合、配额跟踪
- [故障排查](../troubleshooting.md) —— 当某些东西连不上时

---

## 需要帮助？

- **网站**：[vela.my.id](https://vela.my.id)
- **GitHub**：[github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**：[github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
