# Inversion v0.1.0 alpha

> 在你失败之前，先想象失败。

第一个公开发布的 alpha 版本。从 0 到完整可用闭环，5/5 PRD Must Have 全部实现。

---

## 它是什么

输入一个你正在考虑的决定，AI 会问你 3 个针对性的澄清问题，然后列出 **20 条最可能让这个决定失败的具体路径**——按严重度排序、每条引用你的具体处境、带因果链。

对致命路径，你可以一键生成 **3-5 条本周可执行的避险动作**。

它**不给建议**，只让你看清失败的样子。

---

## 这个版本能做的

- ✅ 完整决策推演闭环（输入 → 澄清 → 20 条路径 → 避险清单）
- ✅ 致命/警惕/留意 三级分类 + 因果链展开 + 严重度筛选
- ✅ **本地决策档案**（JSON 文件，永不上传）
- ✅ **30 天回访** 机制（推演后 30 天主动提醒）
- ✅ **决策模板库**（8 种常见类型：辞职/跳槽/读博/搬家/买房/结婚等）
- ✅ **Markdown 一键导出**（整份报告复制到剪贴板）
- ✅ **暗色模式**（跟随系统）
- ✅ 快捷键：Ctrl+Enter 提交 / Ctrl+K 历史 / Esc 返回

---

## 这个版本的限制

- 🔸 **仅 Windows + macOS**（iOS / Android 待 v0.5+）
- 🔸 **仅 DeepSeek**（Claude / OpenAI 在 v0.2 加）
- 🔸 **BYOK 模式**——需要自己的 DeepSeek API key（每月有免费额度）
- 🔸 完全免费 alpha，无 Pro 订阅

---

## 安全 & 隐私

- API key 走 **OS 钥匙串**（Windows Credential Manager / macOS Keychain），永不上传
- 所有决策数据存在 **本地 JSON 文件**（`~/Library/Application Support/com.inversion.app/decisions.json` on macOS；`%APPDATA%\com.inversion.app\decisions.json` on Windows）
- 唯一外部调用是用户自己的 DeepSeek key 调 DeepSeek API
- 源码开放：https://github.com/SHzzzAyys/inversion

---

## 安装方式

### macOS
- **Apple Silicon (M 系列)**：下载 `*aarch64.dmg`
- **Intel**：下载 `*x86_64.dmg`
- 双击安装。首次启动可能需要：右键 → 打开（绕过 Gatekeeper 未签名警告）

### Windows
- 下载 `*-setup.exe`（1.86 MB，推荐）或 `*.msi`（2.9 MB）
- 双击安装向导

### Linux
- 下载 `*.AppImage`（开箱即用）或 `*.deb`（Ubuntu/Debian）

---

## 首次使用

1. 启动 Inversion
2. 从 https://platform.deepseek.com/api_keys 申请 API key（新账户送 ¥5 体验额度）
3. 在 App 内填入 key，点"测试并保存"
4. 输入第一个决策（≥20 字），按 Ctrl+Enter 提交
5. 完成 3 个澄清问题
6. 等 20-40 秒看到 20 条失败路径
7. 点开任意一条致命路径，生成本周可执行的避险动作

完整使用指南：[apps/desktop/ALPHA-USER-GUIDE.md](apps/desktop/ALPHA-USER-GUIDE.md)

---

## 我希望你帮我反馈

这是 alpha 版本，作者本人是第 0 号用户。请用真实的决策跑 1-3 次，然后：

- **推演结果有没有真正"打到你"？** 还是觉得"模糊"、"早就想到了"、"AI 套话"？
- **避险清单是不是真的"本周可以执行"**？还是看完依然不知道下一步做什么？
- **有什么 bug / 崩溃 / 卡顿**？
- **有什么 UX 改进建议**？

通过 GitHub Issues 反馈：https://github.com/SHzzzAyys/inversion/issues

越锋利越好，alpha 就是为了找出"不行的地方"。

---

## 致谢

- **Charlie Munger** 的反演思维 — "我只想知道自己将来会死在哪里，这样我就永远不去那里。"
- **Gary Klein** 的 pre-mortem 方法
- **Daniel Kahneman & Amos Tversky** 的规划谬误研究
- **Tauri** 让 1.9 MB 的桌面应用成为可能
- **DeepSeek** 让 alpha 阶段的 BYOK 成本对用户友好

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
