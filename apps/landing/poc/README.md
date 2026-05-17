# Inversion M0 PoC

> 提示词工程压力测试 —— 验证 "20 条失败路径强制引用具体情况" 能不能稳定达成。
> 这是整个 App 的 go / no-go gate。

## 一句话

跑 5 个 fixture × 5 次推演 = 25 次，自动统计 4 项硬指标，得出 GO / NO-GO。

## 用法

### 干跑（确认脚本能跑通，1 次调用）
```bash
node poc/run-poc.js --dry
```
约 30 秒，烧 ~¥0.01

### 完整跑（25 次）
```bash
node poc/run-poc.js
```
约 8-12 分钟，烧 ~¥0.20

### 单独跑某个 fixture
```bash
node poc/run-poc.js --fixture 1
```

### 自定义次数
```bash
node poc/run-poc.js --runs 3
```

### 分析结果
```bash
# 自动分析最新一批
node poc/analyzer.js

# 分析指定批次
node poc/analyzer.js poc/results/run-2026-05-17_14-23-11
```

## 4 项硬指标

| 指标 | 合格线 | 不达标后果 |
|------|--------|----------|
| 引用具体情况比例 | ≥ 80% | 调提示词 / 换模型 |
| 严重度分布约束 | 5/5 满足（致命 3-8、警惕 ≥5、留意 ≥3） | 加后处理 |
| 给齐 18-22 条 | ≥ 80% 的运行满足 | 拆分调用 |
| 跨次稳定性（top5 致命 Jaccard） | ≥ 80% | 体感不稳定 |

任何一项不达标 → 调提示词 → 再跑 → 仍不达标 → **整个项目重新评估**。

## 输出物

每次跑会生成 `poc/results/run-<timestamp>/`：

```
run-2026-05-17_14-23-11/
├── _meta.json              ← 本次运行元数据
├── _report.md              ← 自动报告（CEO 看这个）
├── _metrics.json           ← 自动指标 JSON
├── fixture-1-run-1.json    ← 每次推演原始结果
├── fixture-1-run-2.json
├── ...
└── fixture-5-run-5.json
```

## 配置

复用现有 `.env.local`，需要：
- `DEEPSEEK_API_KEY`（必填）
- `DEEPSEEK_MODEL`（推荐 `deepseek-reasoner` 用于 PoC）
- `DEEPSEEK_BASE_URL`（可选）

## 文件结构

```
poc/
├── fixtures.js           ← 5 个 fixture 决策（landing page 三场景 + 2 新增）
├── prompts/
│   └── system-v1.js      ← M0 系统提示词 v1
├── run-poc.js            ← 主流程
├── analyzer.js           ← 自动指标分析
├── results/              ← 运行结果归档（gitignore）
└── README.md             ← 你正在读
```

## 提示词迭代

不要直接改 `system-v1.js`。新建 `system-v2.js`，并在 `run-poc.js` 顶部改 import。
保留所有版本，方便回看效果。
