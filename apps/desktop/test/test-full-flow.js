// 端到端测试：决策 → 推演 → 避险
// 不开 Tauri 窗口，直接 import llm.js 在 Node 端跑
// 用法: node test/test-full-flow.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 inversion-chat 的 .env.local（共享 key）
const envPath = path.resolve(__dirname, "../../inversion-chat/.env.local");
if (!fs.existsSync(envPath)) {
  console.error("❌ 找不到 .env.local at:", envPath);
  process.exit(1);
}
const envText = fs.readFileSync(envPath, "utf8").replace(/^﻿/, "");
for (const line of envText.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

// 临时把 deepseek-reasoner 改成更快的 chat 模型加速测试（reasoner 单次 ~30s 太慢）
// 注意：实际 App 用 reasoner
const useReasoner = process.argv.includes("--reasoner");
if (!useReasoner) process.env.DEEPSEEK_MODEL = "deepseek-chat";

// 动态 import llm.js（在 process.env 设置后，避免被缓存）
const { generateClarifyingQuestions, runInversion, generateMitigation } = await import(
  "../src/llm.js"
);

// ============ 测试输入 ============

const TEST_DECISION =
  "我 32 岁，上海产品经理，月薪 4 万。想辞职和大学室友在成都开精品咖啡店，启动资金 80 万，我出 50 万。";

// 模拟澄清答案（与 fixture-1 一致）
const TEST_CLARIFICATIONS = [
  {
    q: "你有过餐饮业经验吗？",
    a: "完全没有，只是周末爱去咖啡店，自己研究过手冲。",
  },
  {
    q: "家庭账本能承受 50 万亏损吗？",
    a: "妻子刚生二胎，目前无收入。家里有 100 万左右存款。",
  },
  {
    q: "如果失败的退路是什么？",
    a: "想过 1 年内回 PM，但担心 35 岁后再难回大厂。",
  },
];

// ============ 主流程 ============

const KEY = process.env.DEEPSEEK_API_KEY;
const PROVIDER = "deepseek";

console.log("=".repeat(70));
console.log("Inversion · 端到端测试");
console.log("=".repeat(70));
console.log("决策:", TEST_DECISION);
console.log("");
console.log("3 个澄清回答:");
TEST_CLARIFICATIONS.forEach((c, i) => console.log(`  ${i + 1}. ${c.q}\n     → ${c.a}`));
console.log("");

// ============ Step 1: 推演 20 条 ============

console.log("─".repeat(70));
console.log("Step 1: 推演 20 条失败路径（流式）");
console.log("─".repeat(70));
const t1 = Date.now();
let lastShown = 0;
const result = await runInversion(
  PROVIDER,
  KEY,
  TEST_DECISION,
  TEST_CLARIFICATIONS,
  (text) => {
    // 简单进度提示
    const matches = text.match(/"index"\s*:\s*\d+/g) || [];
    const n = matches.length;
    if (n > lastShown) {
      process.stdout.write(`\r  生成中... ${n}/20 条 · ${Math.round((Date.now() - t1) / 1000)}s    `);
      lastShown = n;
    }
  }
);
console.log(`\n  ✓ ${result.paths.length} 条，用时 ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

// 统计
const fatalCount = result.paths.filter((p) => p.severity === "致命").length;
const watchCount = result.paths.filter((p) => p.severity === "警惕").length;
const noticeCount = result.paths.filter((p) => p.severity === "留意").length;
console.log(`  分布: 致命 ${fatalCount} | 警惕 ${watchCount} | 留意 ${noticeCount}`);

// 列出前 3 条致命
console.log("");
console.log("  前 3 条致命:");
result.paths
  .filter((p) => p.severity === "致命")
  .slice(0, 3)
  .forEach((p, i) => {
    console.log(`    ${i + 1}. [${p.category}] ${p.title}`);
    console.log(`       ${p.causal_chain.slice(0, 100)}${p.causal_chain.length > 100 ? "…" : ""}`);
  });

// ============ Step 2: 为第 1 条致命路径生成避险 ============

const targetPath = result.paths.find((p) => p.severity === "致命");
if (!targetPath) {
  console.error("\n❌ 没有致命路径，跳过避险测试");
  process.exit(1);
}

console.log("\n" + "─".repeat(70));
console.log("Step 2: 为这条致命路径生成避险清单");
console.log("─".repeat(70));
console.log(`  目标路径: [${targetPath.category}] ${targetPath.title}`);
console.log(`  因果链: ${targetPath.causal_chain}\n`);

const t2 = Date.now();
const mitigation = await generateMitigation(
  PROVIDER,
  KEY,
  TEST_DECISION,
  TEST_CLARIFICATIONS,
  targetPath
);
console.log(`  ✓ ${mitigation.actions.length} 条避险动作，用时 ${((Date.now() - t2) / 1000).toFixed(1)}s\n`);

// ============ Step 3: 打印避险清单 ============

console.log("─".repeat(70));
console.log(`避险清单（${mitigation.actions.length} 条本周可执行）`);
console.log("─".repeat(70));
mitigation.actions.forEach((a, i) => {
  console.log(`\n  ${a.index || i + 1}. ${a.title}`);
  console.log(`     ${a.detail}`);
  console.log(
    `     本周可执行: ${a.this_week ? "✓" : "✗"} | 可验证: ${a.verifiable ? "✓" : "✗"}`
  );
});

// ============ Step 4: 验收检查 ============

console.log("\n" + "=".repeat(70));
console.log("PRD 验收检查");
console.log("=".repeat(70));

const checks = [
  ["3-5 条", mitigation.actions.length >= 3 && mitigation.actions.length <= 5],
  ["全部标注 this_week=true", mitigation.actions.every((a) => a.this_week === true)],
  ["全部标注 verifiable=true", mitigation.actions.every((a) => a.verifiable === true)],
  [
    "每条 detail 含数字/时间词（粗略检测）",
    mitigation.actions.every((a) =>
      /\d|本周|周[一二三四五六日]|今天|明天|后天|月\d+日|小时|分钟/.test(a.detail || "")
    ),
  ],
  [
    "无废话开头",
    !mitigation.actions.some((a) =>
      /做好充足|建议你|考虑一下|应该多|尽量|尽快/.test(a.detail || "")
    ),
  ],
];

let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (ok) pass++;
}
console.log(`\n  通过 ${pass}/${checks.length} 项`);
console.log("");
