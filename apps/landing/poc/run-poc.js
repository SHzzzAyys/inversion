// M0 PoC · 主流程
// 用法：
//   node poc/run-poc.js              # 完整：5 fixture × 5 次
//   node poc/run-poc.js --dry        # 干跑：fixture-1 × 1 次
//   node poc/run-poc.js --runs 3     # 每个 fixture 跑 3 次
//   node poc/run-poc.js --fixture 2  # 只跑 fixture-2

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { FIXTURES, formatFixture } from "./fixtures.js";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "./prompts/system-v2.js";
import { extractJson, isValidPathsResponse } from "./json-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ============ 加载 .env.local ============
function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("\n❌ 找不到 .env.local（路径：" + envPath + "）\n");
    process.exit(1);
  }
  const text = fs.readFileSync(envPath, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
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
}
loadEnv();

if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.startsWith("REPLACE_")) {
  console.error("\n❌ DEEPSEEK_API_KEY 未设置\n");
  process.exit(1);
}

// ============ CLI 参数 ============
const args = process.argv.slice(2);
const isDry = args.includes("--dry");
const runsArg = args.indexOf("--runs");
const RUNS_PER_FIXTURE = isDry ? 1 : runsArg !== -1 ? parseInt(args[runsArg + 1], 10) : 5;
const fixtureArg = args.indexOf("--fixture");
const ONLY_FIXTURE = fixtureArg !== -1 ? `fixture-${args[fixtureArg + 1]}` : null;

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const TEMPERATURE = 0.7;
const MAX_TOKENS = 6000; // 提到 6000，预留 reasoner 的较长输出
const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2; // 重试次数：1 → 2（应对空响应、截断、JSON 损坏）

// ============ 输出目录 ============
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/T/, "_")
  .slice(0, 19);
const RUN_DIR = path.join(__dirname, "results", `run-${timestamp}`);
fs.mkdirSync(RUN_DIR, { recursive: true });

const META = {
  timestamp,
  model: MODEL,
  prompt_version: PROMPT_VERSION,
  fixtures_total: 0,
  runs_per_fixture: RUNS_PER_FIXTURE,
  dry: isDry,
  only_fixture: ONLY_FIXTURE,
};

// ============ LLM 客户端 ============
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  timeout: TIMEOUT_MS,
});

// ============ 跑一次推演 ============
async function runOnce(fixture, runIndex) {
  const userText = formatFixture(fixture);
  const t0 = Date.now();

  // 主调
  const result = {
    fixture_id: fixture.id,
    fixture_title: fixture.title,
    run_index: runIndex,
    timestamp: new Date().toISOString(),
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    duration_ms: 0,
    paths: null,
    raw_response: null,
    parse_ok: false,
    error: null,
    retries: 0,
  };

  async function callOnce() {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    });
    const content = resp.choices?.[0]?.message?.content || "";
    return content;
  }

  // 重试 + 修复策略：
  //   每次尝试都做：API 调用 → extractJson（含中文引号修复）→ 校验 paths
  //   失败模式：API 异常 / 空响应 / 截断 / JSON 损坏 都触发重试
  let content = "";
  let parsed = null;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      content = await callOnce();
      if (!content) {
        lastError = "empty_response";
        result.retries = attempt + 1;
        continue;
      }
      parsed = extractJson(content);
      if (isValidPathsResponse(parsed)) {
        result.retries = attempt;
        break;
      } else if (parsed && parsed.error) {
        lastError = "model_returned_error:" + parsed.error;
        result.retries = attempt;
        break; // 模型主动返回 error 不需要重试
      } else {
        lastError = "json_parse_failed";
        result.retries = attempt + 1;
      }
    } catch (err) {
      lastError = err?.message || "api_failed";
      result.retries = attempt + 1;
    }
  }

  result.raw_response = content;
  result.duration_ms = Date.now() - t0;

  if (parsed && isValidPathsResponse(parsed)) {
    result.paths = parsed.paths;
    result.parse_ok = true;
  } else {
    result.error = lastError || "unknown_failure";
  }

  return result;
}

// ============ 主流程 ============
async function main() {
  console.log("=".repeat(60));
  console.log("Inversion M0 PoC · 反演推演压力测试");
  console.log("=".repeat(60));
  console.log("  模型:", MODEL);
  console.log("  提示词版本:", PROMPT_VERSION);
  console.log("  Runs / fixture:", RUNS_PER_FIXTURE);
  console.log("  Dry mode:", isDry);
  console.log("  Only fixture:", ONLY_FIXTURE || "(all)");
  console.log("  输出目录:", path.relative(ROOT, RUN_DIR));
  console.log("");

  const fixturesToRun = ONLY_FIXTURE
    ? FIXTURES.filter((f) => f.id === ONLY_FIXTURE)
    : FIXTURES;

  if (fixturesToRun.length === 0) {
    console.error("❌ 找不到 fixture:", ONLY_FIXTURE);
    process.exit(1);
  }

  META.fixtures_total = fixturesToRun.length;

  // 写 meta
  fs.writeFileSync(
    path.join(RUN_DIR, "_meta.json"),
    JSON.stringify(META, null, 2),
    "utf8"
  );

  const allResults = [];
  let okCount = 0;
  let failCount = 0;
  const startAt = Date.now();

  for (const fixture of fixturesToRun) {
    console.log(`\n── ${fixture.id}: ${fixture.title} ──`);
    for (let i = 1; i <= RUNS_PER_FIXTURE; i++) {
      process.stdout.write(`  Run ${i}/${RUNS_PER_FIXTURE}... `);
      const t0 = Date.now();
      const result = await runOnce(fixture, i);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);

      // 增量保存
      const outFile = path.join(RUN_DIR, `${fixture.id}-run-${i}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

      if (result.parse_ok && result.paths) {
        const n = result.paths.length;
        console.log(`✓ ${dt}s · ${n} 条 · retries=${result.retries}`);
        okCount++;
      } else {
        console.log(`✗ ${dt}s · 失败: ${result.error}`);
        failCount++;
      }
      allResults.push(result);
    }
  }

  const totalDt = ((Date.now() - startAt) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`完成 · 用时 ${totalDt}s · 成功 ${okCount} · 失败 ${failCount}`);
  console.log("=".repeat(60));
  console.log(`\n下一步: node poc/analyzer.js ${path.relative(ROOT, RUN_DIR)}\n`);
}

main().catch((err) => {
  console.error("\n❌ 致命错误:", err?.message || err);
  process.exit(1);
});
