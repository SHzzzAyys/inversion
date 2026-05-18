# Inversion · 项目继任书

> **写给下一个接手这个项目的 agent 或人**：
> 这份文档是你的"上车手册"。读完它你就能直接干活，不需要回看任何聊天历史。
>
> **撰写时间**：2026-05-17（项目启动 + alpha 完成同一天）
> **最后更新**：2026-05-18（加 CI/CD + 跨平台 build + LICENSE + Issue 模板）
> **当前阶段**：v0.1.0 alpha 已 tag，跨平台产物正在 GitHub Actions 上构建

---

## 0. 这个文档的使用方式

读完这份文档**至少 1 次**再动手做任何决策。读完后：
- 看 §1 知道项目是什么
- 看 §2 知道当前状态（已做完什么 + 当前能力）
- 看 §3 知道**关键文件在哪、改什么不改什么**
- 看 §4 知道下一个 v0.2 该做什么
- 看 §5 知道**哪些是雷区**（不要再走过的坑）
- 看 §6 拿到所有外部账号、API、key 的索引

---

## 1. 项目是什么

### 一句话

**Inversion**：基于反演思维（Charlie Munger 的 inversion + Gary Klein 的 pre-mortem）的 AI 决策辅助桌面工具。

### 工作原理

用户输入一个**正在考虑的决定**（如"辞职开咖啡店"），App 会：

1. **澄清**：AI 问 3 个针对性的澄清问题（资源、时间窗、退路）
2. **推演**：AI 流式生成 **20 条**最可能让这个决定失败的具体路径
   - 按"致命 / 警惕 / 留意"三级分类
   - 每条强制引用用户原话里的具体信息（年龄/月薪/家人/地点/金额）
   - 每条带因果链描述
3. **避险**：用户点开任意一条致命路径，AI 生成 **3-5 条本周可执行的避险动作**（含数字/时间/人/地点）
4. **回访**：30 天后回头看，App 会主动问"这些失败真的发生了吗？"

### 产品定位

- **不给建议** —— 只给失败路径 + 避险动作，决定权永远在用户
- **不预测未来** —— 只给"最可能"，不给"会发生"
- **不替代思考** —— 只扩大用户的思考面，让决定建立在更全的信息上

### 商业模式（当前 + 计划）

| 阶段 | 模式 | 状态 |
|------|------|:---:|
| v0.1 alpha | **完全免费 · BYOK**（Bring Your Own Key）—— 用户用自己的 DeepSeek API key | ✅ 当前 |
| v0.4+ | Pro 订阅 —— 代付 API + 云端同步（价格 alpha 反馈后定）| 计划 |

---

## 2. 当前状态（v0.1.0 alpha）

### 2.1 已完成的功能（PRD Must Have 5/5 全过 + Should 3/3 + Could 1/3）

#### Must Have（核心闭环）
- ✅ **BYOK API key 配置**（DeepSeek）—— 通过 Windows Credential Manager / macOS Keychain 加密存储
- ✅ **决策输入 + 澄清问答** —— ≥20 字校验，AI 出 3 个澄清问题
- ✅ **20 条失败路径生成** —— 流式 SSE，平均 22 秒，自动 JSON 修复 + 重试
- ✅ **路径展示分类排序** —— 致命/警惕/留意筛选，因果链点击展开
- ✅ **避险清单生成** —— 单条致命路径 → 3-5 条本周可执行动作

#### Should Have（核心扩展）
- ✅ **本地决策档案持久化** —— JSON 文件存到 `%APPDATA%\com.inversion.app\decisions.json`
- ✅ **Markdown 一键导出** —— 复制到剪贴板，含完整推演 + 避险
- ✅ **决策模板库** —— 8 种常见决策类型（辞职/跳槽/读博/搬家/买房/结婚/教育投入/转行）

#### Could Have（增值功能）
- ✅ **30 天 Check-in 回访** —— 推演后 30 天主动横幅提醒
- ⏳ 个人决策档案分析（v0.5+ 重新评估）
- ⏳ 云端同步（v0.4+ 跟 Pro 一起做）

#### Polish & Infra
- ✅ 暗色模式（跟随系统）
- ✅ 快捷键：`Ctrl+Enter` 提交 / `Ctrl+K` 历史 / `Esc` 返回
- ✅ Dev banner 在 release 模式自动隐藏
- ✅ Windows MSI / NSIS / standalone exe 三种打包格式
- ✅ 公开 GitHub 仓库（monorepo + .gitignore + README）

### 2.2 PoC 验收数据（M0 阶段，已通过）

| 硬指标 | 合格线 | 实测 |
|--------|--------|------|
| 引用具体情况比例 | ≥ 80% | 4/5 fixture 过线（最高 95%），离婚场景 76% |
| 严重度分布约束 | 5/5 满足 | 22/22 |
| 给齐 18-22 条 | ≥ 80% | 23/23 给 20 条 |
| 跨次稳定性（核心关键词 ≥ 5）| 全过 | 6-14 个稳定核心关键词 |

### 2.3 打包产物（已生成，存在本地）

```
C:\Users\zheng shang\inversion-app\src-tauri\target\release\bundle\
├── msi\inversion-app_0.1.0_x64_en-US.msi          (2.9 MB)
└── nsis\inversion-app_0.1.0_x64-setup.exe         (1.86 MB)  ← 推荐分发
                                                              
还有 standalone EXE:
C:\Users\zheng shang\inversion-app\src-tauri\target\release\inversion-app.exe (8.68 MB)
```

**注意**：这些 release 产物**不在 GitHub 仓库里**（被 .gitignore 排除）。要分发的话用 GitHub Releases 上传。

### 2.4 GitHub 仓库

- **URL**：https://github.com/SHzzzAyys/inversion
- **可见性**：Public
- **仓库主**：`shangzheng666`（CEO 本人）
- **首次 commit hash**：`5b6b2fe`

---

## 3. 关键文件索引（重要！）

### 3.1 仓库结构

```
C:\Users\zheng shang\inversion\           ← monorepo 根（git 仓库）
├── README.md                              ← 项目总览
├── HANDOFF.md                             ← 你正在读
├── .gitignore                             ← 严格保护 secrets
└── apps/
    ├── desktop/                           ← Tauri 桌面 App
    │   ├── package.json
    │   ├── src/
    │   │   ├── index.html                 ← 5+ 个 view 的 HTML 结构
    │   │   ├── styles.css                 ← ~700 行 CSS（含暗色模式）
    │   │   ├── main.js                    ← ~700 行 JS（状态机 + 业务逻辑）
    │   │   └── llm.js                     ← LLM 调用 + 提示词 + JSON 修复
    │   ├── src-tauri/
    │   │   ├── Cargo.toml                 ← Rust 依赖（含 keyring）
    │   │   ├── src/lib.rs                 ← 7 个 commands（save/load/delete/has key + save/load/path archive）
    │   │   └── tauri.conf.json            ← Tauri 配置
    │   ├── poc/                           ← 提示词工程 PoC（M0 阶段产物）
    │   │   ├── fixtures.js                ← 5 个测试 fixture
    │   │   ├── prompts/system-v2.js       ← 当前生效的系统提示词
    │   │   ├── run-poc.js                 ← 跑批量测试
    │   │   ├── analyzer.js                ← 自动指标统计
    │   │   ├── json-utils.js              ← JSON 修复（中文引号 hack）
    │   │   └── repair-results.js          ← 事后救援已有失败
    │   ├── test/
    │   │   ├── test-full-flow.js          ← 端到端单跑（CLI）
    │   │   ├── dogfooding-batch.js        ← 4 个 case 批量跑
    │   │   └── dogfooding-results/        ← 4 个 case 完整 MD 报告
    │   └── ALPHA-USER-GUIDE.md            ← 给 alpha 用户看的使用指南
    │
    └── landing/                           ← 落地页 + Vercel chat demo
        ├── index.html                     ← 静态页 + chat 浮窗
        ├── server.js                      ← 本地开发用 Node 服务器
        ├── api/chat.js                    ← Vercel Edge Function（流式 SSE）
        ├── .env.example                   ← 环境变量模板（不含真 key）
        └── poc/                           ← 同 desktop 的 PoC 副本
```

### 3.2 三个**最重要**的代码文件（改之前必读）

#### `apps/desktop/src/llm.js`
- **包含**：3 个系统提示词（SYSTEM_PROMPT_INVERSION / CLARIFY / MITIGATION）+ JSON 修复函数 + 3 个 API 调用函数
- **改时注意**：提示词是产品成不成立的核心，PoC 阶段已经验证 v2 版本稳定。改提示词必须先回 `apps/desktop/poc/` 跑回归测试

#### `apps/desktop/src-tauri/src/lib.rs`
- **包含**：7 个 Tauri 后端 commands
- **改时注意**：API key 走 keyring，**永远不能从 UI 暴露明文导出路径**。这是隐私承诺核心

#### `apps/desktop/src/main.js`
- **包含**：视图状态机 + 业务逻辑 + 持久化
- **改时注意**：所有 view 切换必须走 `showView()` + 注册到 `views` 字典（之前有过 bug：忘了注册导致空白视图）

### 3.3 已经放在本地但**不在 git 里**的资产

| 路径 | 内容 | 隐私级别 |
|------|------|---------|
| `C:\Users\zheng shang\AppData\Roaming\com.inversion.app\decisions.json` | 用户真实决策档案 | **极高** —— 永远不能动 |
| `D:\virtual-companies\` | 完整虚拟公司体系（PRD / PoC 报告 / 账号档案 / X 推文成稿）| **高** —— CEO 私人资产 |
| `apps/landing/.env.local`（本地 only）| DeepSeek API key | **极高** |
| `apps/landing/downloads/` | setup.exe 副本（朋友间分发用）| 中 |

### 3.4 D:\virtual-companies\ 这套体系是什么

这是 CEO 本人的"AI 协作框架"，**不属于 Inversion 产品本身**。但你接手时可能会被引导到这些文件。

```
D:\virtual-companies\
├── 产品研发公司\           ← 5 部门 PLAYBOOK，含 Inversion PRD / RICE / 验收清单 / PoC 总结
│   ├── 02_产品研发部\outputs\2026-05-17_Inversion_PRD_v0.1.md  ← 详细 PRD
│   └── 03_生产部\outputs\2026-05-17_Inversion_M0_PoC总结报告.md  ← PoC 详细结果
└── X内容运营公司\           ← 3 条 X 推文（与 Inversion 无关）
```

**如何使用**：你被分配 Inversion 任务时，可以**只读不写**地参考 `Inversion_PRD_v0.1.md` 和 `M0_PoC总结报告.md`。这两份是详细文档（PRD 22KB，PoC 报告 7KB），含完整的功能边界、验收标准、技术选型理由。

---

## 4. 下一个 v0.2 该做什么

### 4.1 必做（按优先级）

#### P0: 真实用户反馈循环（最重要，但没写代码）
- **行动**：CEO 应该把 `inversion-app_0.1.0_x64-setup.exe` 发给 2-3 个核心朋友测试
- **收集**：每个用户跑 1-3 次真实决策后的反馈（"AI 像不像在套话"、"避险动作能不能本周执行"、"UX 哪里卡"）
- **deadline**：1 周内必须做完
- **没做这一步，所有 v0.2 功能优化都是猜的**

#### P1: macOS 支持 ✅ 已完成（2026-05-18）
- **状态**：GitHub Actions 跨平台 build 已配置（`.github/workflows/release.yml`）
- **触发**：push tag `v*` 自动跑 4 个 runner（macOS aarch64 + macOS x86_64 + Linux + Windows）
- **产物**：自动创建草稿 GitHub Release，附 `.dmg` / `.msi` / `.exe` / `.AppImage` / `.deb`
- **每次发布流程**：
  ```bash
  # 改 version
  # 编辑 apps/desktop/src-tauri/Cargo.toml 和 tauri.conf.json
  git add -A && git commit -m "chore: bump to vX.X.X"
  git tag vX.X.X && git push origin main --tags
  # 等 20-25 分钟，去 GitHub Releases publish 草稿
  ```
- **首次 release**：v0.1.0 已 tag，跨平台产物已开始构建（runID 26010414626）

#### P2: 第二个 LLM Provider（Claude / OpenAI）
- **当前**：只支持 DeepSeek
- **理由**：alpha 用户里肯定有 Claude / OpenAI 重度用户
- **难点**：每个 provider 的 streaming SSE 格式略不同
- **路径**：在 `apps/desktop/src/llm.js` 加 provider 抽象层，setup view UI 已经预留了"Claude (v0.2)"选项
- **预计工时**：半天

#### P3: 错误恢复 UX
- **现状**：错误提示是 toast，会消失，用户记不住怎么了
- **改进**：错误状态保留在视图里 + 一键重试 + 错误日志可复制（方便用户向作者反馈）

### 4.2 重要但不紧急

- **多种 fixture 复测**：现在 PoC 跑的 5 个 fixture 偏向"个人决策"。加入"团队/组织决策"、"职业生涯长期规划"等更多类型验证
- **导出 PDF**：当前只有 Markdown，PDF 适合给非技术朋友看
- **30 天 check-in 加 OS 通知**：现在只是 App 内横幅，用户不打开 App 就不会看到

### 4.3 不要做（明确划清边界）

- ❌ **iOS / Android**：v0.5+ 重新评估。现在做是浪费时间
- ❌ **协作功能**：与产品定位冲突（决策本来就是个人的）
- ❌ **聊天式交互**：当前是 form-based，让 AI"陪聊"会稀释产品价值
- ❌ **"AI 给建议"模式**：产品命名"反演推演"——只列失败路径，不给建议。这是底层 promise
- ❌ **过度工程**：不要把 JSON 文件改成 SQLite，不要引 React/Vue，不要做"插件系统"
- ❌ **大规模分发**：alpha 阶段，反馈质量 > 用户数量

---

## 5. 雷区（不要再走的坑）

### 5.1 API Key 安全

- **绝对不要**在前端代码、HTML、JSON、Markdown 里写真实 key
- **绝对不要**让 key 通过 git commit 上传
- **绝对不要**在 App UI 里加"显示明文 key"按钮
- 用户暴露 key 后必须**立即去 platform.deepseek.com 撤销并重新生成**

### 5.2 提示词稳定性

- **不要**在没跑 PoC 的情况下改 SYSTEM_PROMPT_INVERSION
- **不要**让模型自由发挥（temperature > 1.0 会破坏分布约束）
- **不要**移除"中文引号修复"逻辑（DeepSeek 经常在 JSON string 里用裸 ASCII `"`，会破坏解析）
- 改了提示词后**必须跑** `node apps/desktop/poc/run-poc.js` 完整 25 次验证

### 5.3 视图状态机

- 加新 view 时**必须**：
  1. 在 `index.html` 加 `<main class="view hidden" id="view-XXX">`
  2. **在 `main.js` 的 `views` 字典里注册** ← 之前漏过这步导致空白视图 bug
  3. 加 CSS 不让初始 hidden 残留
- 视图切换走 `showView(name)`，不要直接操作 DOM

### 5.4 数据本地化承诺

- **承诺**：所有用户数据本地，不上传任何服务器
- **现状**：是的，唯一外部调用是用户自己的 DeepSeek key 调 DeepSeek API
- **不要破坏**：未来加云端同步（v0.4+ Pro 版）必须 **默认关闭 + 用户主动开启 + 端到端加密**

### 5.5 性能

- `runInversion` 用 `deepseek-chat` 模型（平均 22 秒），不要默认改 `reasoner`（慢 1.5 倍但深度提升有限）
- 流式 SSE 一定要保留，否则用户体验"30 秒空白"会被认为产品卡死
- max_tokens = 6000 是 PoC 测出来的（更小会截断，更大没必要），不要随便降回 4096

### 5.6 之前出过的真实 bug 列表

| Bug | 症状 | 修复 |
|-----|------|------|
| views 字典缺 history | 点档案按钮空白 | 加 `history: $("view-history")` |
| JSON 解析失败 24% | reasoner 模型在字符串值里用裸 `"` | 加中文引号修复 + 2 次重试 + max_tokens 提到 6000 |
| 离婚场景引用率仅 60% | 敏感话题模型回避具体引用 | system-v2 加专门约束（v1 → v2 提升到 76%）|

---

## 6. 外部账号 & 资源索引

### 6.1 账号

| 服务 | 账号 / URL | 用途 |
|------|-----------|------|
| GitHub | https://github.com/SHzzzAyys（用户名 `shangzheng666`）| 仓库托管 |
| DeepSeek | https://platform.deepseek.com | API key 申请 |
| Anthropic | （CEO 已有 Claude 订阅，但未给 Inversion 用）| 备选 LLM provider |
| Vercel | **未登录**（之前尝试过失败，CEO 选择走本地路径）| 落地页未来部署用 |

### 6.2 关键命令速查

```powershell
# === 桌面 App ===
cd "C:\Users\zheng shang\inversion\apps\desktop"
npm install
npm run tauri dev              # 开发模式（首次 5-10 分钟）
npm run tauri build            # 出 release 包

# === Landing page ===
cd "C:\Users\zheng shang\inversion\apps\landing"
npm install
cp .env.example .env.local     # 然后填 DEEPSEEK_API_KEY
node server.js                 # 本地预览 http://localhost:3000

# === PoC 回归测试 ===
cd "C:\Users\zheng shang\inversion\apps\desktop"
node poc/run-poc.js --dry             # 干跑（1 fixture × 1 次）
node poc/run-poc.js                    # 完整（5 × 5）
node poc/analyzer.js                   # 看最新批次报告

# === 端到端测试 ===
node test/test-full-flow.js            # 一次完整推演 + 避险

# === Git ===
cd "C:\Users\zheng shang\inversion"
git status
git add -A && git commit -m "feat: ..."
git push origin main

# === 当前能用的 .env.local（key 在这里）===
# C:\Users\zheng shang\inversion-chat\.env.local  ← 注意是旧路径，新 monorepo 没复制过来
# 也可以放在 C:\Users\zheng shang\inversion\apps\landing\.env.local
```

### 6.3 重要 URL

- **Inversion GitHub**: https://github.com/SHzzzAyys/inversion
- **DeepSeek 控制台**: https://platform.deepseek.com/api_keys
- **DeepSeek API 文档**: https://platform.deepseek.com/api-docs
- **Tauri 2 文档**: https://v2.tauri.app
- **PRD 详细版**: `D:\virtual-companies\产品研发公司\02_产品研发部\outputs\2026-05-17_Inversion_PRD_v0.1.md`（仅本地，不公开）
- **PoC 报告**: `D:\virtual-companies\产品研发公司\03_生产部\outputs\2026-05-17_Inversion_M0_PoC总结报告.md`

---

## 7. CEO 风格 & 协作偏好（接手 agent 必读）

CEO 是这个项目的唯一决策者（用户本人）。他的协作偏好：

- **决策果断**：给他 3-4 个选项 + 推荐，他会快速选
- **不要替他思考**：他要"做 X 还是做 Y" 的取舍，不要给"做了一个综合方案"
- **直接动手**：跨阶段允许并行（不必严格走调研→PRD→生产部的瀑布）
- **数据说话**：PoC 验收、PRD 验收他认数据，不认情绪
- **诚实标注假设**：跳过的环节（如市场调研）必须明确标"未验证"
- **节奏极快**：1 天完成别人 6 周的事，但**质量门槛不放**
- **隐私第一**：API key、用户数据、个人决策都要严格保护

### 已经验证过的几个偏好

- 偏好 **Tauri 而非 Electron**（包体积优势）
- 偏好 **JSON 文件而非 SQLite**（MVP 阶段简单优先）
- 偏好 **DeepSeek 优先**（国内访问稳 + 便宜）
- 偏好 **BYOK 先于 Pro 订阅**（先验证产品价值再做商业模式）
- 偏好 **本地优先**（数据不上传是产品核心承诺）

### 一定不能做的（CEO 已经明示）

- 不能在没说明的情况下用 LLM 替他做重大决策
- 不能伪造数据
- 不能违反隐私承诺（哪怕加"匿名 telemetry"也不行）
- 不能在 alpha 阶段就上 Pro 订阅
- 不能拓展到 landing page 承诺过但不存在的功能（如 SQLite、Anthropic Claude key 默认支持）

---

## 8. 哲学（项目灵魂，不要忘）

> **"我只想知道自己将来会死在哪里，这样我就永远不去那里。"**
> —— Charlie Munger

Inversion 的产品价值不在 AI 给的具体路径，**在让用户重新建立"做决定前要看清失败"的思维习惯**。

3 个不能忘的原则：

1. **不给建议，只列路径**
2. **不预测未来，只给"最可能"**
3. **不替用户思考，只扩大思考面**

任何让产品变成"AI 给你答案"的改动，都是**走错方向**。

---

## 9. 最后一句

这个项目从 0 到可分发 alpha 用了 1 天。这速度不可持续，也不应该期待 v0.2 也用 1 天做完。

**下一阶段最重要的事是 dogfooding 反馈循环**——让真实用户用 1-2 周，把"用得卡的地方"找出来。代码再多再快也无法替代 alpha 用户的真实使用。

祝你接手顺利。

— 上一任 agent · 2026-05-17

---

## 附录 A：今日完成清单（参考时间线）

| 时段 | 完成 |
|------|------|
| 2026-05-17 上午 | 虚拟公司体系部署 + X 公司账号档案初始化 |
| 上午-中午 | 3 条 X 推文成稿（选题/简报/写作/分发作战方案）|
| 中午 | Landing page chat 组件 + Vercel Edge Function |
| 下午 | 切 DeepSeek + 本地 server.js |
| 下午晚 | Inversion PRD v0.1（21KB）+ RICE 排序 + 验收清单 |
| 晚 | M0 PoC（5 fixture × 5 次 × 2 prompt 版本）→ GO |
| 晚-深夜 | M1 W1-W3 提前完成（Tauri + 5 view + BYOK + 推演引擎 + 避险 + archive + 模板库 + check-in + Polish）|
| 深夜 | 打 Windows 三个安装包 + 4 dogfooding case + 调整 landing 承诺 |
| 凌晨 | GitHub 公开仓库 + 本继任书 |

**总投入**：~16 小时；**总现金消耗**：~¥0.5（API 调用）；**产物**：1 套可分发 alpha + 完整文档体系。
