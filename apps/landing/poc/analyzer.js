// M0 PoC · 自动分析器
// 用法：
//   node poc/analyzer.js poc/results/run-XXXX        # 分析指定批次
//   node poc/analyzer.js                              # 自动分析最新一批

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ============ 找批次目录 ============
const arg = process.argv[2];
let runDir;
if (arg) {
  runDir = path.isAbsolute(arg) ? arg : path.resolve(ROOT, arg);
} else {
  const resultsDir = path.join(__dirname, "results");
  const dirs = fs
    .readdirSync(resultsDir)
    .filter((d) => d.startsWith("run-"))
    .map((d) => ({ name: d, path: path.join(resultsDir, d), mtime: fs.statSync(path.join(resultsDir, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (dirs.length === 0) {
    console.error("❌ 找不到任何 results/run-* 目录。先跑 node poc/run-poc.js");
    process.exit(1);
  }
  runDir = dirs[0].path;
}
if (!fs.existsSync(runDir)) {
  console.error("❌ 目录不存在:", runDir);
  process.exit(1);
}

// ============ 加载 meta + 所有结果 ============
const metaPath = path.join(runDir, "_meta.json");
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};

const allResults = fs
  .readdirSync(runDir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8")));

if (allResults.length === 0) {
  console.error("❌ 该目录里没有结果文件");
  process.exit(1);
}

// ============ 工具函数 ============

// 1) 引用率：path 的 title + causal_chain 是否包含至少 1 个 expected_reference
function referenceRateForPath(pathObj, expectedRefs) {
  const text = (pathObj.title || "") + " " + (pathObj.causal_chain || "");
  return expectedRefs.some((ref) => {
    // 简单的关键词匹配——做点鲁棒：去空格、忽略大小写
    const normText = text.replace(/\s+/g, "");
    const normRef = ref.replace(/\s+/g, "");
    return normText.includes(normRef);
  });
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function min(arr) {
  return arr.length ? Math.min(...arr) : 0;
}

function max(arr) {
  return arr.length ? Math.max(...arr) : 0;
}

// 跨次稳定性：top 5 致命路径 title 关键词的重叠度（Jaccard）
function tokenize(text) {
  // 去标点 + 中文按字符切 + 英文/数字按词切
  const cleaned = (text || "").replace(/[，。！？；：、""''（）()——\-…\.]/g, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  // 中文连续字按 2-gram 拆
  const result = new Set();
  for (const t of tokens) {
    if (/[一-鿿]/.test(t)) {
      for (let i = 0; i < t.length - 1; i++) result.add(t.slice(i, i + 2));
    } else if (t.length >= 2) {
      result.add(t.toLowerCase());
    }
  }
  return result;
}

function jaccard(setA, setB) {
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ============ 单 fixture 分析 ============
function analyzeFixture(fixtureId) {
  const fixture = FIXTURES.find((f) => f.id === fixtureId);
  if (!fixture) return null;
  const runs = allResults
    .filter((r) => r.fixture_id === fixtureId)
    .sort((a, b) => a.run_index - b.run_index);

  if (runs.length === 0) return null;

  const okRuns = runs.filter((r) => r.parse_ok && Array.isArray(r.paths));

  // 1. 计数（实际生成条数）
  const pathCounts = okRuns.map((r) => r.paths.length);
  const passesCount = pathCounts.filter((n) => n >= 18 && n <= 22).length;

  // 2. 引用率
  const refRates = okRuns.map((r) => {
    const hits = r.paths.filter((p) => referenceRateForPath(p, fixture.expected_references)).length;
    return r.paths.length ? hits / r.paths.length : 0;
  });

  // 3. 严重度分布
  const severityStats = okRuns.map((r) => {
    const fatal = r.paths.filter((p) => p.severity === "致命").length;
    const watch = r.paths.filter((p) => p.severity === "警惕").length;
    const notice = r.paths.filter((p) => p.severity === "留意").length;
    const passes = fatal >= 3 && fatal <= 8 && watch >= 5 && notice >= 3;
    return { fatal, watch, notice, passes };
  });
  const severityPassCount = severityStats.filter((s) => s.passes).length;

  // 4. 分类覆盖
  const categoryStats = okRuns.map((r) => {
    const cats = new Set(r.paths.map((p) => p.category));
    return { distinct: cats.size, passes: cats.size >= 5 };
  });
  const catPassCount = categoryStats.filter((c) => c.passes).length;

  // 5. 跨次稳定性：核心关键词稳定性
  //   对每次跑，提取 top 5 致命路径合并文本里出现的 expected_references
  //   然后跨次统计：每个关键词出现在多少次跑里
  //   "稳定核心数" = 出现在 ≥ 60% 次数（即 N 次跑中 ≥ ceil(N*0.6) 次）的关键词数
  const top5TextsPerRun = okRuns.map((r) => {
    const top5 = r.paths.filter((p) => p.severity === "致命").slice(0, 5);
    const text = top5.map((p) => (p.title || "") + " " + (p.causal_chain || "")).join(" ");
    return text.replace(/\s+/g, "");
  });
  const keywordFreq = {};
  for (const ref of fixture.expected_references) {
    const normRef = ref.replace(/\s+/g, "");
    let count = 0;
    for (const text of top5TextsPerRun) {
      if (text.includes(normRef)) count++;
    }
    keywordFreq[ref] = count;
  }
  const threshold = Math.ceil(top5TextsPerRun.length * 0.6);
  const stableKeywords = Object.entries(keywordFreq)
    .filter(([_, count]) => count >= threshold)
    .map(([k, c]) => ({ keyword: k, freq: c }));
  const stableCount = stableKeywords.length;
  const stableRatio = fixture.expected_references.length
    ? stableCount / fixture.expected_references.length
    : 0;

  // 6. 延迟
  const durations = runs.map((r) => r.duration_ms);

  return {
    fixture_id: fixtureId,
    fixture_title: fixture.title,
    total_runs: runs.length,
    ok_runs: okRuns.length,
    failed_runs: runs.length - okRuns.length,
    metrics: {
      duration_ms: { avg: avg(durations), min: min(durations), max: max(durations) },
      count_distribution: {
        min: min(pathCounts),
        max: max(pathCounts),
        avg: avg(pathCounts),
        passes_18to22_count: passesCount,
        passes_18to22_ratio: okRuns.length ? passesCount / okRuns.length : 0,
      },
      reference_rate: {
        avg: avg(refRates),
        min: min(refRates),
        max: max(refRates),
        passes_80pct: avg(refRates) >= 0.8,
      },
      severity_balance: {
        per_run: severityStats,
        passes_constraint_count: severityPassCount,
        passes_constraint_ratio: okRuns.length ? severityPassCount / okRuns.length : 0,
        passes_5of5: severityPassCount === okRuns.length && okRuns.length > 0,
      },
      category_coverage: {
        per_run: categoryStats,
        avg_distinct: avg(categoryStats.map((c) => c.distinct)),
        passes_5plus_count: catPassCount,
        passes_5plus_ratio: okRuns.length ? catPassCount / okRuns.length : 0,
      },
      cross_run_stability: {
        // 新指标：核心关键词稳定性
        stable_keyword_count: stableCount,
        stable_keyword_ratio: stableRatio,
        stable_keywords: stableKeywords,
        threshold_runs: threshold,
        total_expected_refs: fixture.expected_references.length,
        // 合格线：≥ 5 个核心关键词稳定（≥ 60% 次数）出现
        passes_5plus: stableCount >= 5,
      },
    },
  };
}

// ============ 报告生成 ============
function fmt(n, decimals = 2) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  return Number(n).toFixed(decimals);
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function generateReport(allMetrics) {
  const lines = [];
  lines.push(`# Inversion M0 PoC 报告`);
  lines.push("");
  lines.push(`> **生成时间**: ${new Date().toISOString()}`);
  lines.push(`> **批次**: ${path.basename(runDir)}`);
  lines.push(`> **模型**: ${meta.model || "?"}`);
  lines.push(`> **提示词版本**: ${meta.prompt_version || "?"}`);
  lines.push(`> **Runs / fixture**: ${meta.runs_per_fixture || "?"}`);
  lines.push("");

  // 总览
  lines.push(`## 总览`);
  lines.push("");
  lines.push(`| Fixture | 成功 | 引用率 | 严重度分布达标 | 给齐 18-22 条 | 稳定核心关键词 |`);
  lines.push(`|---------|:---:|:------:|:-------------:|:-------------:|:-------------:|`);
  for (const m of allMetrics) {
    if (!m) continue;
    const r = m.metrics;
    lines.push(
      `| ${m.fixture_title} | ${m.ok_runs}/${m.total_runs} | ${pct(r.reference_rate.avg)} ${r.reference_rate.passes_80pct ? "✓" : "✗"} | ${m.ok_runs ? `${r.severity_balance.passes_constraint_count}/${m.ok_runs}` : "-"} ${r.severity_balance.passes_5of5 ? "✓" : "✗"} | ${r.count_distribution.passes_18to22_count}/${m.ok_runs} | ${r.cross_run_stability.stable_keyword_count} 个 ${r.cross_run_stability.passes_5plus ? "✓" : "✗"} |`
    );
  }
  lines.push("");

  // 综合判断
  const passes = {
    referenceRate: allMetrics.every((m) => m && m.metrics.reference_rate.passes_80pct),
    severityBalance: allMetrics.every((m) => m && m.metrics.severity_balance.passes_5of5),
    countDistribution: allMetrics.every(
      (m) => m && m.metrics.count_distribution.passes_18to22_ratio >= 0.8
    ),
    crossRunStability: allMetrics.every((m) => m && m.metrics.cross_run_stability.passes_5plus),
  };

  lines.push(`## go / no-go 判断`);
  lines.push("");
  lines.push(`| 硬指标 | 合格线 | 状态 |`);
  lines.push(`|--------|--------|:---:|`);
  lines.push(`| 引用具体情况比例 | 所有 fixture 平均 ≥ 80% | ${passes.referenceRate ? "✅" : "❌"} |`);
  lines.push(`| 严重度分布约束 | 所有 fixture 全数满足（致命 3-8、警惕 ≥5、留意 ≥3） | ${passes.severityBalance ? "✅" : "❌"} |`);
  lines.push(`| 给齐 18-22 条 | 所有 fixture ≥ 80% 次数满足 | ${passes.countDistribution ? "✅" : "❌"} |`);
  lines.push(`| 跨次稳定性（核心关键词）| 所有 fixture 稳定核心 ≥ 5 个 | ${passes.crossRunStability ? "✅" : "❌"} |`);
  lines.push("");

  const allPass = passes.referenceRate && passes.severityBalance && passes.countDistribution && passes.crossRunStability;
  lines.push(`**综合判断**: ${allPass ? "🟢 **GO** — 可进入 M1" : "🔴 **NO-GO** — 调整提示词重跑"}`);
  lines.push("");

  // 各 fixture 详情
  lines.push(`## 各 Fixture 详情`);
  lines.push("");
  for (const m of allMetrics) {
    if (!m) continue;
    const r = m.metrics;
    lines.push(`### ${m.fixture_id}: ${m.fixture_title}`);
    lines.push("");
    lines.push(`- **运行成功**: ${m.ok_runs}/${m.total_runs}（失败 ${m.failed_runs} 次）`);
    lines.push(`- **平均延迟**: ${fmt(r.duration_ms.avg / 1000, 1)}s（${fmt(r.duration_ms.min / 1000, 1)}–${fmt(r.duration_ms.max / 1000, 1)}）`);
    lines.push(`- **生成条数**: ${r.count_distribution.min}–${r.count_distribution.max}（平均 ${fmt(r.count_distribution.avg, 1)}）`);
    lines.push(`- **引用率**: 平均 ${pct(r.reference_rate.avg)} | 区间 ${pct(r.reference_rate.min)}–${pct(r.reference_rate.max)} ${r.reference_rate.passes_80pct ? "✓" : "✗"}`);
    lines.push(`- **严重度（每次）**: ${r.severity_balance.per_run.map((s) => `致${s.fatal}/警${s.watch}/留${s.notice}${s.passes ? "✓" : "✗"}`).join(" · ")}`);
    lines.push(`- **分类覆盖**: 平均 ${fmt(r.category_coverage.avg_distinct, 1)} 类 · 达标 ${r.category_coverage.passes_5plus_count}/${m.ok_runs}`);
    lines.push(`- **跨次稳定性（核心关键词）**: ${r.cross_run_stability.stable_keyword_count}/${r.cross_run_stability.total_expected_refs} 个关键词在 ≥ ${r.cross_run_stability.threshold_runs} 次跑中被 top 5 致命路径引用 ${r.cross_run_stability.passes_5plus ? "✓" : "✗"}`);
    if (r.cross_run_stability.stable_keywords.length) {
      const list = r.cross_run_stability.stable_keywords
        .sort((a, b) => b.freq - a.freq)
        .map((k) => `\`${k.keyword}\`(${k.freq}/${m.ok_runs})`)
        .join(" · ");
      lines.push(`  - 稳定核心: ${list}`);
    }
    lines.push("");
  }

  // CEO 人工抽检建议
  lines.push(`## CEO 人工抽检建议（自动统计兜底）`);
  lines.push("");
  lines.push(`自动统计可能假阳性。请抽看以下 5 条路径，**确认引用是真实的、不是巧合或凑数**：`);
  lines.push("");
  for (const m of allMetrics) {
    if (!m) continue;
    const runs = allResults.filter((r) => r.fixture_id === m.fixture_id && r.parse_ok);
    if (runs.length === 0) continue;
    const sampleRun = runs[0];
    const samplePath = sampleRun.paths[0]; // 第一条（严重度最高）
    if (!samplePath) continue;
    lines.push(`- **${m.fixture_title}** (${sampleRun.fixture_id}-run-${sampleRun.run_index})：`);
    lines.push(`  - 标题：${samplePath.title}`);
    lines.push(`  - 因果链：${samplePath.causal_chain}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============ 主流程 ============
console.log(`分析批次: ${path.relative(ROOT, runDir)}`);
console.log(`找到 ${allResults.length} 条结果`);
console.log("");

const fixtureIds = [...new Set(allResults.map((r) => r.fixture_id))];
const allMetrics = fixtureIds.map(analyzeFixture).filter(Boolean);

const report = generateReport(allMetrics);
const reportFile = path.join(runDir, "_report.md");
fs.writeFileSync(reportFile, report, "utf8");

// 同时输出 JSON 版本指标
const metricsFile = path.join(runDir, "_metrics.json");
fs.writeFileSync(metricsFile, JSON.stringify(allMetrics, null, 2), "utf8");

console.log("✓ 报告已生成:");
console.log("  ", path.relative(ROOT, reportFile));
console.log("  ", path.relative(ROOT, metricsFile));
console.log("");

// 在控制台打印一个迷你摘要
for (const m of allMetrics) {
  const r = m.metrics;
  const refOk = r.reference_rate.passes_80pct ? "✓" : "✗";
  const sevOk = r.severity_balance.passes_5of5 ? "✓" : "✗";
  const stabOk = r.cross_run_stability.passes_5plus ? "✓" : "✗";
  console.log(
    `${m.fixture_id}: 引用 ${(r.reference_rate.avg * 100).toFixed(0)}% ${refOk} | 严重度 ${r.severity_balance.passes_constraint_count}/${m.ok_runs} ${sevOk} | 稳定核心 ${r.cross_run_stability.stable_keyword_count} ${stabOk} | 平均 ${(r.duration_ms.avg / 1000).toFixed(1)}s`
  );
}
