# 组合 —— 自定义回退链

组合是一条模型链的名字。为它取一次名，每个工具都可以请求这个名字而不是某个具体模型 —— 当链上的某个模型无法触达时，下一个就会应答。

组合是你与 Vela 相处中，最值得花的五分钟。

---

## 什么是组合

```
名称: premium-coding
模型:
  1. cc/claude-opus-5          ← 首先尝试
  2. glm/glm-4.7               ← 若 #1 不可用
  3. kr/claude-sonnet-4.5      ← 若 #2 也不可用
```

然后任何工具都可以像请求模型名一样请求 `premium-coding`。Vela 会在其他一切**之前**解析组合名称，因此 `premium-coding` 永远不会与提供商前缀冲突。

### 链条何时前进

当请求**失败**时，组合会落到下一个模型：

- 提供商报告配额或速率限制错误
- 请求超时
- 提供商出于策略原因拒绝提示词
- 模型 id 未知或不可用

### 何时不前进

- 仅仅是每日额度偏低**不会**触发切换。Vela 不会因为你快到限额就悄悄把你转到付费模型 —— 那等于替你花钱。
- 硬性支出上限属于 API Key（**端点与密钥 → 预算**）；触达时，Vela 会以 429 拒绝，而不是转向别处。

---

## 为什么要用它们

### 1. 从订阅中获得价值
```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```
先用你已经付费的，其次低价，最后免费。

### 2. 压低成本
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/qwen3-coder-plus
```
每 1M 输入 token：$0.60 → $0.30 → 免费。

### 3. 永不卡住
```
cc/claude-opus-5 → cx/gpt-5.6-sol → glm/glm-4.7 → if/qwen3-coder-plus
```
始终以免费的东西收尾，否则你距离一个停滞的下午只差一次配额耗尽。

### 4. 关键时刻保住质量
```
cc/claude-opus-5 → cx/gpt-5.6-sol → ag/gemini-4-argon-high
```
全程高端模型。更贵，但永远不会钝化。

---

## 创建一个组合

### 第 1 步：打开仪表盘

```
http://localhost:32060/dashboard → 组合
```

### 第 2 步：创建

```
组合 → 创建
  组合名称: premium-coding
  模型:     按优先级顺序逐一添加
```

拖动行以调整顺序。顶部的模型最先尝试。

### 第 3 步：保存

组合会立即出现，网关会在下一次请求时解析它 —— 无需重启。

### 第 4 步：使用它

```
模型: premium-coding
```

这就是全部界面。任何接受模型名的工具都接受组合名。

### 另一种策略：轮询

组合也可以在成员之间轮换，而不是逐级下落。如果你的目标是分摊负载（例如在多个账户之间），而不是回退，请在 **设置 → 路由 → 组合轮询** 中全局设置。

---

## 完整示例

### 示例 1：高端但节俭

```
premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

每月 100M token 的典型一个月：

```
80M 经 Claude 订阅 : $0
15M 经 GLM-4.7     : 约 $9
 5M 经 MiniMax M2.1 : 约 $1
```

昂贵的模型承担真正的工作；便宜的接住溢出。

### 示例 2：只求预算

```
budget-combo
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/qwen3-coder-plus
```

每月 100M token，按 70 / 20 / 10 分配：

```
70M 经 GLM          : 约 $42
20M 经 MiniMax      : 约 $4
10M 经 iFlow        : $0
```

要花钱，但远不是一张零售 API 账单。

### 示例 3：零成本

```
free-combo
  1. kr/claude-sonnet-4.5
  2. if/qwen3-coder-plus
  3. qwen/qwen-plus
```

成本：$0。约束：免费层今天怎么看你。

### 示例 4：质量优先

```
quality-first
  1. cc/claude-opus-5
  2. cx/gpt-5.6-sol
  3. ag/gemini-4-argon-high
```

刻意不设低价回退：如果三个都用尽，它会响亮地失败，而不是悄悄给出更弱的结果。

### 示例 5：每条通道，按序排列

```
never-stuck
  1. ag/gemini-4-argon-high     ← 免费，意外地强
  2. cc/claude-opus-5           ← 订阅
  3. cx/gpt-5.6-sol             ← 第二个订阅
  4. gh/claude-sonnet-4.6       ← 第三个
  5. glm/glm-4.7                ← 低价
  6. minimax/MiniMax-M2.1       ← 更低价
  7. kr/claude-sonnet-4.5       ← 免费，质量好
  8. if/qwen3-coder-plus        ← 免费，多样性
```

八级阶梯，每一级都比上一级便宜，没有一级是无路可退的。

---

## 在每个工具中使用组合

### Cursor

```
设置 → 模型 → OpenAI API
  基础 URL：http://localhost:32060/v1
  API Key： [你的 Vela 密钥]
  模型：    premium-coding   （作为自定义模型添加）
```

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
claude --model premium-coding
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
codex --model premium-coding "your prompt"
```

### Cline / Roo / Continue

```
提供商：OpenAI Compatible
基础 URL：http://localhost:32060/v1
API Key： [你的 Vela 密钥]
模型：    premium-coding
```

### 从脚本中

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer [your Vela key]" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [{"role": "user", "content": "Write a function that reverses a linked list."}],
    "stream": true
  }'
```

---

## 良好习惯

### 1. 以免费的东西收尾

```
✅ cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
❌ cc/claude-opus-5 → glm/glm-4.7
```

第二条链的尽头是一道悬崖。

### 2. 想清楚你在优化什么

- **成本：** 低价在前，免费在后。
- **质量：** 高端在前，低价在后。
- **订阅价值：** 订阅在前，免费在后。

没有放之四海皆准的答案，正确的顺序随周而变。

### 3. 让组合匹配任务

```
生产代码     : quality-first
日常编辑     : premium-coding
探索         : budget-combo
别人的工作   : never-stuck
```

你可以同时保留几个，通过在工具中更改一个字段来切换。

### 4. 检查链条实际做了什么

**Routed by Combo** 页面显示每个请求由哪个模型应答，这样悄悄总落在最后一级的组合就变得可见，而不是神秘。

### 5. 给共享密钥设置上限

对于被智能体或后台任务使用的密钥，请设置支出上限。组合能让你沿着链往下走，但阻止不了你花钱；预算可以。

---

## 进阶

### 按组合的策略

单个组合可以偏好轮询而非严格回退 —— 当成员质量相当、你想要分摊负载时有用。在 **设置 → 路由** 下设置。

### 临时禁用一个模型

在它的提供商页面上禁用该模型，而不是从每个组合中删除它；组合会跳过它，并在你重新启用时保持原有形状。

### 导入与导出

组合可以从组合页面导出和导入，这是把一套可用的配置搬到第二台机器上最简便的方式。

---

## 故障排查

### 组合名称无法识别

- 检查名称是否与保存时完全一致（区分大小写）。
- 如果工具在启动时缓存模型列表，请重启它。
- 确认组合已保存 —— 它应当出现在组合列表中。

### 它总是落在最后一个模型上

这意味着前面的都在失败。查看 **配额** 与 **提供商**：通常是 token 过期、额度耗尽，或提供商宕机。

### 成本高于预期

- 检查 **Routed by Combo**，看它有多频繁地下落。
- 阅读[低价提供商](../providers/cheap.md)中的费率 —— 在低价通道上，输出 token 的成本是输入的 3–4 倍。
- 调整顺序：如果质量允许，把更便宜的成员放在前面。

### 请求失败而不是回退

有些失败无法在别处重试 —— 格式错误的请求在每个模型上都会以同样方式失败。在假定链条损坏之前，请先检查错误文本。

---

## 相关

- [智能路由](smart-routing.md) —— 请求如何选择提供商
- [配额跟踪](quota-tracking.md) —— 读懂用量与成本
- [低价提供商](../providers/cheap.md) —— 链条背后的数字
