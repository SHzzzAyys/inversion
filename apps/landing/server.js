// 本地 Node.js 服务器 —— 不依赖 Vercel CLI
// 启动：node server.js  或  npm start
// 访问：http://localhost:3000

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ 加载 .env.local ============
function loadEnv() {
  const envPath = path.join(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("\n❌ 找不到 .env.local");
    console.error("   先 cp .env.example .env.local 并填入 DEEPSEEK_API_KEY\n");
    process.exit(1);
  }
  // strip BOM（PowerShell Add-Content 可能加）
  const text = fs.readFileSync(envPath, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // 去除两端引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

if (
  !process.env.DEEPSEEK_API_KEY ||
  process.env.DEEPSEEK_API_KEY.startsWith("REPLACE_") ||
  process.env.DEEPSEEK_API_KEY.startsWith("sk-xxx")
) {
  console.error("\n❌ DEEPSEEK_API_KEY 未设置或仍是占位符");
  console.error("   编辑 .env.local，把 DEEPSEEK_API_KEY= 后面改成真实 key\n");
  process.exit(1);
}

// ============ 系统提示词（与 api/chat.js 保持一致）============
const SYSTEM_PROMPT = `你是 Inversion App 的"预演助手"。Inversion 是基于反演思维和 pre-mortem 方法的决策辅助应用。

## 你的两种工作模式

### 模式 A：决策推演（用户输入了一个具体决定）
触发条件：用户描述了一个正在考虑或准备做的决定（如"我打算辞职"、"想搬到上海"、"要不要读博"等）。

执行步骤：
1. 如果描述太模糊，先问 1-2 个关键澄清问题（资源、时间窗、退路）
2. 一旦信息够，列出 3-5 条最可能的失败路径（注意：这是 demo 版，完整 20 条在 App 内）
3. 每条必须：
   - 引用用户提到的具体情况（不能空泛）
   - 标注严重程度：【致命】【警惕】【留意】
   - 一句话说清失败机制
4. 结尾提示：完整 20 条 + 避险清单需要在 App 里完成

### 模式 B：FAQ 答疑（用户问关于 Inversion 的问题）
触发条件：用户问关于 App 的事（怎么用、多少钱、数据安全、和 ChatGPT 区别等）。

执行步骤：直接答，简洁，必要时引导到落地页对应章节。

## 风格

- 中文回答（除非用户用英文提问）
- 简洁锋利，不安抚、不寒暄
- 不用"首先/其次/总而言之"等 AI 腔
- 不空泛（"注意以下几点"是大忌）
- 单次回复 ≤350 字
- 必须引用用户原话的具体细节

## 重要约束

- 不要给完整 20 条失败路径（那是 App 内功能）
- 不假装能预测未来——用"最可能"、"按你描述"等措辞
- 人身安全 / 医疗 / 法律相关，必须提示"咨询专业人士"
- 如果用户问与 Inversion 完全无关的问题（如让你写代码、做翻译、闲聊），礼貌引回主题`;

// ============ 限流（本地放宽到 30 次 / 分钟）============
const rateLimitMap = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
function checkRateLimit(ip) {
  const now = Date.now();
  const reqs = (rateLimitMap.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (reqs.length >= MAX_PER_WINDOW) return false;
  reqs.push(now);
  rateLimitMap.set(ip, reqs);
  return true;
}

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
});

const PORT = parseInt(process.env.PORT || "3000", 10);

// ============ 工具：读取请求体 ============
function readBody(req, maxBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ============ HTTP server ============
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET / —— 返回 index.html
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try {
      const html = fs.readFileSync(path.join(__dirname, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Failed to read index.html");
    }
    return;
  }

  // GET /healthz —— 健康检查
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      })
    );
    return;
  }

  // POST /api/chat —— 代理 DeepSeek 流式
  if (req.method === "POST" && req.url === "/api/chat") {
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limited", message: "请求过于频繁。" }));
      return;
    }

    let parsed;
    try {
      const body = await readBody(req);
      parsed = JSON.parse(body);
    } catch (e) {
      const code = e.message === "payload_too_large" ? 413 : 400;
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message || "invalid_json" }));
      return;
    }

    const { messages } = parsed || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "messages_required" }));
      return;
    }

    const trimmed = messages
      .slice(-20)
      .filter(
        (m) =>
          m &&
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string" &&
          m.content.length > 0 &&
          m.content.length < 4000
      );

    if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_messages" }));
      return;
    }

    // SSE 流式
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    try {
      const stream = await client.chat.completions.create({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        max_tokens: 1024,
        temperature: 0.7,
        stream: true,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
      });

      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      console.error("[stream error]", err?.message || err);
      try {
        res.write(`data: ${JSON.stringify({ error: err?.message || "stream_failed" })}\n\n`);
        res.end();
      } catch {}
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  console.log("\n✓ Inversion 本地服务器已启动");
  console.log(`  模型: ${model}`);
  console.log(`  打开浏览器: http://localhost:${PORT}`);
  console.log("  健康检查: http://localhost:" + PORT + "/healthz");
  console.log("  按 Ctrl+C 停止\n");
});
