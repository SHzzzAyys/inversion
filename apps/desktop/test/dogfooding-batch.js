// Dogfooding 批量跑——4 个覆盖不同类型的真实决策
// 输出：4 个独立 Markdown 报告 + 1 份汇总

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ============ 加载 .env.local ============
const envPath = path.resolve(__dirname, "../../inversion-chat/.env.local");
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
// 用 chat 模型加速（reasoner 太慢，4 × 30s 不必要）
process.env.DEEPSEEK_MODEL = "deepseek-chat";

const { runInversion, generateMitigation } = await import("../src/llm.js");

// ============ 4 个决策 fixture ============

const CASES = [
  {
    id: "case-01-opensource",
    type: "创业方向 / 知识产权",
    title: "独立开发者：把产品开源还是闭源",
    decision:
      "我做了一个反演推演 App 叫 Inversion，桌面端 Tauri 写的，已完成完整 alpha 闭环。在考虑是开源到 GitHub（求 star + 社区 + GTM 漏斗），还是闭源走付费订阅。",
    clarifications: [
      {
        q: "你做这个 App 的核心动机是商业化还是个人作品集？",
        a: "70% 商业化（订阅 + 数据沉淀），30% 想作为独立开发者代表作。",
      },
      {
        q: "技术壁垒在哪？担心被抄袭吗？",
        a: "代码本身不强（200 行 Rust + 1000 行 JS）。真正的壁垒在提示词工程和后续的用户社区。担心被技术更强的团队 1 周抄完。",
      },
      {
        q: "你账号当下的影响力？",
        a: "X 关注 < 100，刚起步。需要某种 GTM 漏斗来获得初始流量。",
      },
    ],
  },
  {
    id: "case-02-marriage",
    type: "重大关系决策",
    title: "异地恋 3 年要不要现在结婚",
    decision:
      "我和女朋友异地 3 年，她在杭州，我在上海。我 30 岁她 28，双方家长都开始施压结婚。我们感情稳定但有几个分歧。",
    clarifications: [
      {
        q: "你们的核心分歧是什么？",
        a: "她想要孩子，我至少近 3 年不想要。她想我搬去杭州，我工作在上海大厂月薪 4 万去杭州只能找类似职位 3 万。",
      },
      {
        q: "经济状况？双方现在生活质量如何？",
        a: "我月薪 4 万，租房；她月薪 1.8 万，在杭州父母家附近租房。两人加起来年储蓄约 30 万。无房无车无负债。",
      },
      {
        q: "你内心真实倾向是什么？",
        a: "想结婚但不想立刻要孩子+不想立刻搬。希望先订婚或同居 1 年再决定。但担心拖太久她流失耐心。",
      },
    ],
  },
  {
    id: "case-03-back-to-academia",
    type: "职业路径反演",
    title: "35 岁前要不要回学术界做博后",
    decision:
      "我现在 32 岁，在互联网公司做 AI 产品经理 5 年，月薪 5 万。在考虑要不要利用之前博士积累的研究背景，去申请 1-2 年的博后职位，回到学术界做研究。",
    clarifications: [
      {
        q: "动机是什么？真兴趣还是中年职业焦虑？",
        a: "60% 是想做有原创价值的事（PM 工作让我觉得是在做产品包装），40% 是看到大厂裁员潮觉得稳定性差。",
      },
      {
        q: "博后期间收入和现在差距？回学术后长期路径？",
        a: "博后月薪 1.5-2 万，是现在 30-40%。长期目标是当高校讲师/副教授，10 年内总收入大概率低于现在 PM 路径。",
      },
      {
        q: "家庭情况？另一半支持吗？",
        a: "已婚，妻子是公务员月薪 1.2 万。有 3 岁孩子。妻子明确反对，认为是逃避现实。",
      },
    ],
  },
  {
    id: "case-04-buy-mac-studio",
    type: "大额投资 / 个人装备",
    title: "要不要花 5 万买 Mac Studio M5 Ultra 自部署 LLM",
    decision:
      "我是独立开发者，主业是用 AI 做工具。在考虑花 5 万买顶配 Mac Studio M5 Ultra（512GB 内存），用来本地跑大模型，减少对 API 的依赖。",
    clarifications: [
      {
        q: "你当前的 API 月开销和未来预期？",
        a: "目前用 Claude API + DeepSeek，月开销 ¥200-500。预期产品起量后可能到 ¥3000-5000/月。但 5 万够烧 100 个月。",
      },
      {
        q: "5 万对你的资金状况意味着什么？",
        a: "我现金储备 25 万，5 万 = 20%。但买完后可不依赖收入的时间从 18 个月缩短到 14 个月。",
      },
      {
        q: "本地跑模型对你的产品有什么真实价值？",
        a: "1）隐私敏感场景的卖点；2）大批量推理便宜；3）有数据迭代提示词。但 1+3 不一定真的需要本地。",
      },
    ],
  },
];

// ============ 输出目录 ============

const ts = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/T/, "_")
  .slice(0, 19);
const OUT_DIR = path.join(ROOT, "test", "dogfooding-results", `run-${ts}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("=".repeat(70));
console.log("Inversion · CEO Dogfooding 批量跑");
console.log("=".repeat(70));
console.log("  模型:", process.env.DEEPSEEK_MODEL);
console.log("  Cases:", CASES.length);
console.log("  输出:", path.relative(ROOT, OUT_DIR));
console.log("");

// ============ Markdown 生成器 ============

function genCaseMarkdown(c, result, mit, fatalPath) {
  const lines = [];
  const now = new Date();
  const tsStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  lines.push(`# ${c.title}`);
  lines.push("");
  lines.push(`> **类型**：${c.type}`);
  lines.push(`> **生成时间**：${tsStr}`);
  lines.push(`> **工具**：Inversion v0.1 alpha · DeepSeek-chat`);
  lines.push("");
  lines.push("## 决策");
  lines.push("");
  lines.push("> " + c.decision);
  lines.push("");
  lines.push("## 澄清问答");
  lines.push("");
  c.clarifications.forEach((cl, i) => {
    lines.push(`${i + 1}. **${cl.q}**`);
    lines.push(`   ${cl.a}`);
    lines.push("");
  });

  const fatal = result.paths.filter((p) => p.severity === "致命").length;
  const watch = result.paths.filter((p) => p.severity === "警惕").length;
  const notice = result.paths.filter((p) => p.severity === "留意").length;

  lines.push(`## 20 条失败路径`);
  lines.push("");
  lines.push(`致命 **${fatal}** · 警惕 **${watch}** · 留意 **${notice}**`);
  lines.push("");

  const grouped = { 致命: [], 警惕: [], 留意: [] };
  result.paths.forEach((p) => {
    const s = p.severity || "留意";
    if (grouped[s]) grouped[s].push(p);
  });

  for (const sev of ["致命", "警惕", "留意"]) {
    if (grouped[sev].length === 0) continue;
    lines.push(`### 【${sev}】`);
    lines.push("");
    grouped[sev].forEach((p) => {
      lines.push(`#### ${p.index}. ${p.title}  \`${p.category}\``);
      lines.push("");
      lines.push(p.causal_chain || "");
      lines.push("");
    });
  }

  lines.push(`## 针对第一条致命路径的避险清单`);
  lines.push("");
  lines.push(`> 目标路径：**${fatalPath.title}**（${fatalPath.category}）`);
  lines.push("");
  mit.actions.forEach((a, i) => {
    lines.push(`### ${a.index || i + 1}. ${a.title}`);
    lines.push("");
    lines.push(a.detail || "");
    lines.push("");
    lines.push(`> 本周可执行：${a.this_week ? "✓" : "✗"} | 可验证：${a.verifiable ? "✓" : "✗"}`);
    lines.push("");
  });

  lines.push("---");
  lines.push("");
  lines.push("*这是 AI 给出的可能失败路径，不是预测。决定权永远在你。*");

  return lines.join("\n");
}

// ============ 主流程 ============

const results = [];
const startAt = Date.now();

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  console.log(`── [${i + 1}/${CASES.length}] ${c.title} ──`);
  process.stdout.write("  推演中... ");

  const t0 = Date.now();
  const result = await runInversion(
    "deepseek",
    process.env.DEEPSEEK_API_KEY,
    c.decision,
    c.clarifications,
    () => {}
  );
  console.log(`✓ ${result.paths.length} 条 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const fatalPath = result.paths.find((p) => p.severity === "致命");
  if (!fatalPath) {
    console.log("  ⚠️ 无致命路径，跳过避险");
    continue;
  }

  process.stdout.write(`  避险中（针对：${fatalPath.title.slice(0, 30)}…）... `);
  const t1 = Date.now();
  const mit = await generateMitigation(
    "deepseek",
    process.env.DEEPSEEK_API_KEY,
    c.decision,
    c.clarifications,
    fatalPath
  );
  console.log(`✓ ${mit.actions.length} 条 · ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // 保存 JSON
  const rawFile = path.join(OUT_DIR, `${c.id}.json`);
  fs.writeFileSync(
    rawFile,
    JSON.stringify({ case: c, result, mit, fatalPath }, null, 2),
    "utf8"
  );

  // 保存 Markdown
  const mdFile = path.join(OUT_DIR, `${c.id}.md`);
  fs.writeFileSync(mdFile, genCaseMarkdown(c, result, mit, fatalPath), "utf8");

  results.push({ case: c, result, mit, fatalPath });
  console.log("");
}

const totalDt = ((Date.now() - startAt) / 1000).toFixed(1);

// ============ 汇总报告 ============

const sumLines = [];
sumLines.push(`# Inversion · CEO Dogfooding 汇总报告`);
sumLines.push("");
sumLines.push(`> 生成时间：${new Date().toISOString()}`);
sumLines.push(`> 用时：${totalDt}s`);
sumLines.push(`> 模型：${process.env.DEEPSEEK_MODEL}`);
sumLines.push(`> Cases：${results.length}`);
sumLines.push("");
sumLines.push("---");
sumLines.push("");
sumLines.push("## 总览");
sumLines.push("");
sumLines.push("| # | 类型 | 决策 | 致命 | 警惕 | 留意 | 避险数 |");
sumLines.push("|---|------|------|:----:|:----:|:----:|:------:|");
results.forEach((r, i) => {
  const fatal = r.result.paths.filter((p) => p.severity === "致命").length;
  const watch = r.result.paths.filter((p) => p.severity === "警惕").length;
  const notice = r.result.paths.filter((p) => p.severity === "留意").length;
  sumLines.push(
    `| ${i + 1} | ${r.case.type} | ${r.case.title} | ${fatal} | ${watch} | ${notice} | ${r.mit.actions.length} |`
  );
});
sumLines.push("");

sumLines.push("## 各 Case 摘要（第一条致命 + 第一条避险）");
sumLines.push("");
results.forEach((r, i) => {
  sumLines.push(`### ${i + 1}. ${r.case.title}`);
  sumLines.push("");
  sumLines.push(`> ${r.case.decision.slice(0, 100)}…`);
  sumLines.push("");
  sumLines.push(`**第一条致命**：${r.fatalPath.title}`);
  sumLines.push("");
  sumLines.push(r.fatalPath.causal_chain);
  sumLines.push("");
  sumLines.push(`**第一条避险**：${r.mit.actions[0]?.title || "(无)"}`);
  sumLines.push("");
  sumLines.push(r.mit.actions[0]?.detail || "(无)");
  sumLines.push("");
  sumLines.push(`完整报告：[${r.case.id}.md](./${r.case.id}.md)`);
  sumLines.push("");
  sumLines.push("---");
  sumLines.push("");
});

// 验收检查
sumLines.push("## CEO 自检（用 alpha 用户视角看 4 个 case）");
sumLines.push("");
sumLines.push("逐项打勾。任何一项打 ✗ 写入下方反馈，作为 v0.2 输入。");
sumLines.push("");
sumLines.push("- [ ] 每个 case 都引用了用户决策里的具体信息（数字、姓名、地点、金额）");
sumLines.push("- [ ] 致命路径**真的致命**，不是泛泛风险");
sumLines.push("- [ ] 避险动作**真的本周可执行**，不是长期养成习惯");
sumLines.push("- [ ] 推演结果不显得恐吓，能让人冷静而非焦虑");
sumLines.push("- [ ] 推演结果不显得敷衍，每条都有信息量");
sumLines.push("- [ ] 4 个 case 风格一致——不是 AI 同一个套路硬套");
sumLines.push("");
sumLines.push("### CEO 反馈写在这里：");
sumLines.push("");
sumLines.push("> （留空待填）");
sumLines.push("");

const sumFile = path.join(OUT_DIR, "_summary.md");
fs.writeFileSync(sumFile, sumLines.join("\n"), "utf8");

console.log("=".repeat(70));
console.log(`✓ Dogfooding 完成 · ${results.length}/${CASES.length} cases · 用时 ${totalDt}s`);
console.log("=".repeat(70));
console.log("");
console.log("产物路径：");
console.log("  汇总:", path.relative(ROOT, sumFile));
results.forEach((r) => {
  console.log(`  case: ${r.case.id}.md`);
});
console.log("");
