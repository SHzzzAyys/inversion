# Inversion

[![Check](https://github.com/SHzzzAyys/inversion/actions/workflows/check.yml/badge.svg)](https://github.com/SHzzzAyys/inversion/actions/workflows/check.yml)
[![Release](https://github.com/SHzzzAyys/inversion/actions/workflows/release.yml/badge.svg)](https://github.com/SHzzzAyys/inversion/actions/workflows/release.yml)

> 在你失败之前，先想象失败。

基于反演思维（inversion）和 pre-mortem 方法的决策辅助工具。输入一个决定，AI 帮你推演 20 种最可能的失败路径，按可能性 × 杀伤力排序，再为关键路径生成本周可执行的避险动作。

**不给建议，不替你思考。只让你看清失败的样子。**

---

## 项目结构

这是一个 monorepo，包含两个相关产品：

```
inversion/
├── apps/
│   ├── desktop/           # Inversion 桌面 App（Tauri + Rust + 原生 JS）
│   │   ├── src/                  # 前端
│   │   ├── src-tauri/            # Rust 后端
│   │   ├── poc/                  # 提示词工程 PoC + 评估
│   │   └── test/                 # 端到端测试 + dogfooding samples
│   └── landing/           # 落地页 + Chat demo（Vercel Edge Function）
│       ├── index.html            # 静态落地页 + chat 浮窗
│       ├── api/chat.js           # Vercel Function（DeepSeek SSE 流式）
│       └── server.js             # 本地 Node.js 服务器（开发用）
└── README.md
```

---

## Desktop App（`apps/desktop/`）

### 当前能力（v0.1 alpha · Windows）

- ✅ BYOK API key 配置（DeepSeek，存在 Windows Credential Manager）
- ✅ 决策输入 + AI 澄清问答（3 个针对性问题）
- ✅ 20 条失败路径生成（流式输出，按严重度排序）
- ✅ 致命/警惕/留意 三级分类 + 因果链展开
- ✅ 为每条致命路径生成 3-5 条本周可执行避险动作
- ✅ 本地决策档案持久化（JSON，永不上传）
- ✅ Markdown 一键导出
- ✅ 决策模板库（8 种常见类型）
- ✅ 30 天 check-in 回访机制
- ✅ 暗色模式（跟随系统）+ Ctrl+Enter / Ctrl+K / Esc 快捷键

### 跑起来

```bash
cd apps/desktop
npm install
npm run tauri dev      # 开发模式（首次编译 5-10 分钟）
npm run tauri build    # 打包为 Windows MSI / NSIS / standalone EXE
```

### 配置

启动后会要求你填 DeepSeek API key。从 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 申请，新账户送 ¥5 体验额度（约 250 次推演）。

### 技术栈

- **Tauri 2** — Rust 后端 + Webview 前端，最终包 ~9MB（Electron 同等约 80MB）
- **DeepSeek API**（OpenAI 兼容协议）— 默认 deepseek-chat，可改 reasoner
- **OS Keychain**（Windows Credential Manager / macOS Keychain）—— API key 加密存储
- **JSON 文件**（`%APPDATA%\com.inversion.app\decisions.json`）—— 决策档案本地持久化
- **原生 JS + CSS** —— 不引任何前端框架，包体积优势

---

## Landing Page（`apps/landing/`）

### 当前能力

- 静态 HTML 落地页（产品介绍 + 价格 + FAQ）
- 右下角浮窗 chat demo（基于真实 LLM，可让访客**直接体验 mini 推演**）
- 后端选项：
  - `api/chat.js`：Vercel Edge Function，部署到 Vercel 即可
  - `server.js`：本地 Node 服务器（开发用）

### 跑起来

```bash
cd apps/landing
npm install
cp .env.example .env.local    # 然后填入你的 DEEPSEEK_API_KEY
node server.js                 # 访问 http://localhost:3000
```

### 部署到 Vercel

```bash
npx vercel
npx vercel env add DEEPSEEK_API_KEY
npx vercel --prod
```

---

## 开发理念

1. **隐私优先**：所有决策数据本地 JSON 文件存储，App 不收集任何用户内容
2. **BYOK（Bring Your Own Key）**：用户用自己的 API key，价格透明
3. **小而美**：MVP 5 个 Must Have 功能跑通完整闭环，拒绝过度工程
4. **可分发**：alpha 阶段 `.exe` 仅 1.9MB，朋友间发文件即可测试

---

## 发布流程

跨平台构建走 **GitHub Actions** —— push 一个 tag 即可自动构建 macOS（Apple Silicon + Intel）、Windows、Linux 四个产物，并创建草稿 Release。

```bash
# 1. 改 version
# 编辑 apps/desktop/src-tauri/Cargo.toml 和 tauri.conf.json 把 0.1.0 → 0.2.0

# 2. commit + tag + push
git add -A
git commit -m "chore: bump to v0.2.0"
git tag v0.2.0
git push origin main --tags

# 3. 等 ~20 分钟，GitHub Actions 自动 build + 创建草稿 release
# 4. 去 GitHub Releases 页面手动 publish 那个 draft
```

每次 push 到 main 会自动跑 `Quick Check`（cargo check + npm install 验证），约 5-10 分钟。

---

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|:---:|
| v0.1 alpha | Windows + BYOK + 5 个核心功能 | ✅ 当前 |
| v0.2 | Claude / OpenAI 支持、UI Polish | 计划中 |
| v0.3 | macOS 端 | 计划中（等 CI 配置）|
| v0.4 | Pro 订阅（代付 API + 云端同步）| 计划中 |
| v0.5 | iOS / Android | 重新评估 |

---

## 许可

MIT（待定）

---

## 致谢

- **Charlie Munger** 的反演思维（inversion thinking）—— "我只想知道自己将来会死在哪里，这样我就永远不去那里。"
- **Gary Klein** 的 pre-mortem 方法
- **Daniel Kahneman & Amos Tversky** 的规划谬误研究
