# Inversion Landing + Chat（Vercel 部署版 · DeepSeek 驱动）

把原本的静态 `inversion-landing.html` 落地页改造成"可对话的产品 demo"——访客点右下角"试试 Inversion"按钮，就能直接在网页上跟 DeepSeek 驱动的预演助手对话。

## 它能做什么

- **模式 A：决策推演**——用户输入一个决定（如"我打算辞职开咖啡店"），AI 给出 3-5 条最可能的失败路径
- **模式 B：FAQ 答疑**——用户问 Inversion 相关问题（价格、隐私、和 ChatGPT 区别），AI 直接答

两种模式由系统提示词驱动，不需要前端切换。

## 架构

```
浏览器
  └─ index.html (静态)
       └─ JS fetch → /api/chat (Vercel Edge Function)
                      └─ openai SDK (OpenAI 兼容协议) → DeepSeek API
                          └─ SSE 流式响应 → 浏览器
```

- **前端**：单文件 HTML，含 chat UI + JS。不需要构建。
- **后端**：1 个 Vercel Edge Function。DeepSeek API Key 只存在服务端环境变量，**不暴露在前端**。
- **为什么用 openai SDK 调 DeepSeek**：DeepSeek 提供 OpenAI 兼容协议，complete + stream API 与 OpenAI 一致，复用 `openai` npm 包最省事。
- **流式**：SSE（Server-Sent Events），ChatGPT 风格的打字机效果。
- **历史**：浏览器 `localStorage`，刷新不丢，每次请求最多带 20 条上下文。
- **限流**：基础 IP 限流（60 秒 10 次），生产环境建议换成 Upstash Redis 或 Vercel KV。

## ⚠️ 安全先行

**永远不要在以下地方写真实 API Key**：
- 任何 `.js` / `.html` / `.json` 文件
- 公开的对话、issue、commit 信息、截图
- `README.md` 或 `.env.example`

正确做法：
- 真实 key 只放在 `.env.local`（已在 `.gitignore` 里，不会被提交）
- 部署到 Vercel 后，key 放在 Vercel Dashboard 的 Environment Variables

**如果你不小心把 key 暴露过**（包括截图、聊天、文档），**立即去 https://platform.deepseek.com/api_keys 撤销并重新生成**。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制 `.env.example` 为 `.env.local`，填入你的 DeepSeek API Key：

```bash
cp .env.example .env.local
# 然后编辑 .env.local，把 DEEPSEEK_API_KEY 改成新申请的 key
```

### 3. 本地测试

```bash
npx vercel dev
```

打开 http://localhost:3000 ，点右下角"试试 Inversion"按钮。

### 4. 部署到 Vercel

```bash
# 首次部署（按提示登录 + 链接项目）
npx vercel

# 在 Vercel Dashboard 的 Project Settings → Environment Variables 添加
# DEEPSEEK_API_KEY，或者用 CLI：
npx vercel env add DEEPSEEK_API_KEY

# 部署到生产
npx vercel --prod
```

## 文件结构

```
inversion-chat/
├── index.html          # 落地页 + chat UI（单文件）
├── api/
│   └── chat.js         # Vercel Edge Function，代理 DeepSeek API
├── package.json        # 依赖：openai (用作 OpenAI 兼容 client)
├── vercel.json         # Vercel 配置（function 超时 30s）
├── .env.example        # 环境变量示例（不含真实 key）
├── .gitignore
└── README.md
```

## 配置项

环境变量（在 Vercel Dashboard 或 `.env.local` 设置）：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DEEPSEEK_API_KEY` | ✅ | 无 | 从 https://platform.deepseek.com/api_keys 申请 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` | `deepseek-chat`（V3, 通用快）或 `deepseek-reasoner`（R1, 推理强但慢一倍） |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com/v1` | 一般不用改 |

## 模型选择建议

| 场景 | 推荐模型 | 理由 |
|------|---------|------|
| 落地页 demo（FAQ + 简单推演） | `deepseek-chat` | 响应快、便宜，足够撑得起首屏体验 |
| 真正想做 pre-mortem 深度推演 | `deepseek-reasoner` | R1 推理链对"为什么会失败"的因果挖掘更深，但首字延迟约慢 1-2 秒 |

如果未来上线 Pro 版（付费），可以**前端按用户身份切模型**——免费用户给 chat，付费用户给 reasoner。

## 修改系统提示词

打开 `api/chat.js`，找到顶部的 `SYSTEM_PROMPT` 常量。这是 AI 的"角色定义书"——改它就改了 chatbot 的行为。

预设规则：
- 两种工作模式（推演 / FAQ）
- 中文回答
- 单次 ≤350 字
- 必须引用用户具体描述
- 不给完整 20 条（保留给付费 App）

## 已知限制

1. **限流是基础内存版**——Edge Function 实例间不共享，重启会清空。生产环境必须换成 Redis/KV。
2. **历史只在浏览器**——换浏览器、清缓存会丢。如要做账号系统，要加数据库。
3. **没有内容审查**——用户可以问任何东西，建议生产前加关键词过滤或调用 moderation API。
4. **DeepSeek 没有原生 prompt caching**（Anthropic 有）——每次请求都会重新计算 system prompt 的 token 费用。但 DeepSeek 本身已经很便宜，影响有限。

## 成本估算（DeepSeek 2026-05 时点价格）

按 `deepseek-chat` 模型：
- 单次对话 ≈ 输入 1000 token + 输出 500 token ≈ ¥0.001–0.002
- 1000 次对话 ≈ ¥1–2
- Vercel 免费额度支持每月 ~100 万次 Edge Function 调用

比 Anthropic Haiku 便宜约 3-5 倍。

## 下一步建议

如果要从 demo 走向生产：
1. **加用户标识**——cookie 或匿名 ID，做更精准的限流
2. **加日志**——记录每次对话到 Vercel KV / Postgres，分析用户最常问什么
3. **加 funnel**——chat 里推荐用户下载 App / 升级 Pro，做完整 GTM 漏斗
4. **加备用 provider**——主调 DeepSeek，失败时回退到 OpenRouter 或 Claude，提升可用性
5. **A/B 测试模型**——同一个 prompt 让 deepseek-chat 和 deepseek-reasoner 各跑一半流量，看哪个评论更好

## 从 Anthropic 切回 DeepSeek 或换其他 provider

`api/chat.js` 用的是 `openai` npm 包 + 自定义 baseURL，**任何 OpenAI 兼容的 API 都能切**：

| Provider | baseURL | 改动 |
|----------|---------|------|
| DeepSeek | `https://api.deepseek.com/v1` | 当前默认 |
| OpenAI 官方 | `https://api.openai.com/v1` | 改环境变量 + 模型名 |
| OpenRouter | `https://openrouter.ai/api/v1` | 改环境变量 + 模型名 |
| Together AI | `https://api.together.xyz/v1` | 改环境变量 + 模型名 |
| 本地 Ollama | `http://localhost:11434/v1` | 仅本地开发 |
| Anthropic | （不兼容，要用回 `@anthropic-ai/sdk`） | 要重写 chat.js |

切换只需修改 `.env.local` 里的 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 三个变量。
