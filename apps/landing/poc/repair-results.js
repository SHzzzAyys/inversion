// 事后救援：对已有批次里 parse_ok=false 的结果，尝试用 extractJson 救回
// 用法：node poc/repair-results.js poc/results/run-XXX
// 不烧 API 钱——只处理已有的 raw_response

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson, isValidPathsResponse } from "./json-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const arg = process.argv[2];
if (!arg) {
  console.error("用法: node poc/repair-results.js poc/results/run-XXX");
  process.exit(1);
}
const runDir = path.isAbsolute(arg) ? arg : path.resolve(ROOT, arg);
if (!fs.existsSync(runDir)) {
  console.error("目录不存在:", runDir);
  process.exit(1);
}

const files = fs.readdirSync(runDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

let total = 0;
let originalFailed = 0;
let rescued = 0;
let stillFailed = 0;

console.log(`扫描批次: ${path.relative(ROOT, runDir)}`);
console.log("");

for (const f of files) {
  total++;
  const fp = path.join(runDir, f);
  const result = JSON.parse(fs.readFileSync(fp, "utf8"));

  if (result.parse_ok && Array.isArray(result.paths)) continue;
  originalFailed++;

  const raw = result.raw_response;
  const parsed = extractJson(raw);
  if (parsed && isValidPathsResponse(parsed)) {
    // 成功救援
    result.paths = parsed.paths;
    result.parse_ok = true;
    result.error = null;
    result.repaired = true;
    fs.writeFileSync(fp, JSON.stringify(result, null, 2), "utf8");
    rescued++;
    console.log(`✓ 救回: ${f} (${parsed.paths.length} 条)`);
  } else {
    stillFailed++;
    console.log(`✗ 仍失败: ${f} (原 error=${result.error || "?"})`);
  }
}

console.log("");
console.log("=".repeat(40));
console.log(`总文件: ${total}`);
console.log(`原失败: ${originalFailed}`);
console.log(`救回:   ${rescued}`);
console.log(`仍失败: ${stillFailed}`);
console.log("=".repeat(40));
console.log(`\n下一步: node poc/analyzer.js ${path.relative(ROOT, runDir)}`);
