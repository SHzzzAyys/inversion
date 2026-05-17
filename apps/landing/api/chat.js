import OpenAI from "openai";

export const config = { runtime: "edge" };

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

// 简单内存限流（Edge runtime 实例间不共享，仅挡基础滥用）
const rateLimitMap = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const reqs = (rateLimitMap.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (reqs.length >= MAX_PER_WINDOW) return false;
  reqs.push(now);
  rateLimitMap.set(ip, reqs);
  return true;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "rate_limited", message: "请求过于频繁，请稍后再试。" }),
      { status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages_required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 截断 + 校验
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
    return new Response(JSON.stringify({ error: "invalid_messages" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      JSON.stringify({ error: "server_misconfig", message: "未设置 DEEPSEEK_API_KEY" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // DeepSeek 提供 OpenAI 兼容协议，复用 openai SDK
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const apiStream = await client.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          max_tokens: 1024,
          temperature: 0.7,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...trimmed,
          ],
        });

        for await (const chunk of apiStream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            const payload = JSON.stringify({ text });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          }
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        const payload = JSON.stringify({
          error: err?.message || "stream_failed",
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
