# 🏠 本地部署

在你自己的机器上运行 Vela 是默认方式，也是最简单、出错途径最少的方式。本页讲的是日常操作：启动、停止、迁移数据、更新，以及最常出现的两三个问题。

如果你还没有安装，请从[安装](../getting-started/installation.md)开始。

---

## 📦 安装

```bash
npm install -g vela
```

**要求：**
- Node.js 20 或更新版本
- npm 10 或更新版本（随 Node.js 一起安装）

---

## 🚀 启动服务器

```bash
vela
```

仪表盘会自动在 **http://localhost:32060/dashboard** 打开。

**默认配置：**

| 项目 | 位置 |
|-|-|
| **仪表盘** | `http://localhost:32060/dashboard` |
| **API 端点** | `http://localhost:32060/v1` |
| **默认端口** | `32060` |
| **数据目录** | `~/.vela`（macOS/Linux）· `%APPDATA%\vela`（Windows） |
| **仪表盘密码** | 默认没有 —— 见下文 |

一个进程同时服务仪表盘和 API。没有第二个端口需要记住。

### 关于密码

当前的 Vela 中**没有默认密码**。从本机访问，仪表盘无需密码即可打开。在你于 **设置 → 访问** 中设置密码之前，远程浏览器会被拒绝 —— 这是对所有曾经把 `123456` 当作默认值发布、并为此后悔过的人的直接回答。

如果你连本地也想要登录，请在 **设置 → 访问** 中设置一个（或在首次启动前设置 `INITIAL_PASSWORD`），并开启 **要求仪表盘登录**。

### 关于网络

默认情况下，启动器绑定到 `0.0.0.0`，这意味着你网络上的其他机器可以访问该端口。若要纯本地使用：

```bash
vela --host 127.0.0.1
```

---

## 🔧 配置

### 自定义数据目录

```bash
DATA_DIR=/path/to/data vela
```

在 Windows 上，请使用 `D:\vela-data` 这样的原生路径；那里使用 Unix 风格路径会被忽略并给出警告。

### 自定义端口

```bash
vela --port 8080
# or
PORT=8080 vela
```

此后所有与 Vela 通信的东西 —— 你的编辑器、你的脚本 —— 都必须使用 `http://localhost:8080/v1`。

### 自定义主机

```bash
vela --host 127.0.0.1    # 仅本机
vela --host 0.0.0.0      # 所有接口（默认）
```

---

## 🛑 停止服务器

在运行它的终端中按 `Ctrl+C`。网关会在退出前排空进行中的请求，因此一个流式回复会完整结束，而不是被拦腰切断。

如果它是后台启动的，或通过进程管理器启动：

```bash
pm2 stop vela         # 如果你用的是 PM2
pkill -f vela         # 最后手段
```

---

## 🔄 重启

```bash
vela
```

提供商、密钥、组合、预算和用量历史都会保留 —— 它们活在数据目录里，而不是内存中。

---

## 📊 更新

```bash
npm update -g vela
```

检查你正在运行的版本：

```bash
npm list -g vela
```

对于 Docker 路线，请显式拉取更新的标签：

```bash
docker pull ghcr.io/yumamax3/vela:1.2.4
docker stop vela && docker rm vela
# 用新标签重新运行同一条 docker run 命令
```

数据库迁移会在启动时自动运行，并先在 `~/.vela/db/backups/` 下创建一份安全副本。尽管如此，大版本更新前仍请备份。

---

## 🔍 故障排查

### 端口已被占用

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F
```

或者直接换个端口运行：`vela --port 8080`。

### 安装时的权限错误

```bash
# 给 npm 一个它拥有的目录（推荐）
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### 数据目录不可写

```bash
ls -la ~/.vela
chmod 755 ~/.vela
```

如果仍然失败，请把 `DATA_DIR` 指向一个你拥有的目录。

### 从另一台机器无法加载仪表盘

那是密码门在履行职责。要么在 Vela 所在的机器上打开它并在 **设置 → 访问** 中设置密码，要么用 `vela --host 127.0.0.1` 让它保持本地，并通过 SSH 隧道访问：

```bash
ssh -L 32060:localhost:32060 you@the-vela-machine
# 然后打开 http://localhost:32060/dashboard
```

---

## 📁 数据目录

```text
~/.vela/
├── db/
│   ├── data.sqlite     # 提供商、密钥、组合、设置、用量
│   └── backups/        # 迁移前副本与任何定时备份
├── logs/               # 请求日志（启用时）
└── runtime/            # 启动器管理的二进制文件
```

**备份就是复制这个目录** —— 最好在 Vela 停止时进行，好让 SQLite 的预写日志已安定下来：

```bash
# 在 Vela 停止时：
cp -r ~/.vela ~/.vela.backup

# 恢复（Vela 停止时）：
rm -rf ~/.vela && cp -r ~/.vela.backup ~/.vela
```

对于定时、加密的备份，Vela 内置了引擎 —— 参见 `.env.example` 中的备份变量（`VELA_BACKUP_*`）。请把 `VELA_BACKUP_ENCRYPTION_KEY` 保存在一年后你仍然能找到的地方；丢失它会让备份永远无法读取。

---

## 🔗 下一步

- [连接提供商](../providers/subscription.md)
- [构建回退链](../features/combos.md)
- [让编辑器指向 Vela](../integration/cursor.md)
- [走向远程：云端部署](cloud.md)
