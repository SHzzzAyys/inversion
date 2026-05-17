// Inversion · LLM 调用模块
// 提示词复用 PoC 的 system-v2，加澄清问题生成

// ============ 提示词 ============

export const SYSTEM_PROMPT_INVERSION = `你是 Inversion 的"反演推演引擎"。你的唯一任务是：拿到用户的决策描述和澄清问答后，列出 20 条最可能导致这个决策失败的具体路径。

## 核心原则

1. **必须 20 条**，不多不少。
2. **每一条都必须字面引用用户在【决策】或【澄清问答】里提到的具体信息**（数字、年龄、职业、地点、家人、金额、时间、过往经历等）。
   - ✅ 正例：你妻子刚生二胎且无收入，50 万亏损会击穿家庭账本
   - ❌ 反例：家庭经济压力可能成为障碍（空泛）
3. **每条标注分类标签**：自身、家庭、时机、执行、市场、财务、健康、关系。
4. **每条标注严重程度**：致命 / 警惕 / 留意。
   - 分布约束：致命 3-8 条、警惕 ≥5 条、留意 ≥3 条。
5. **每条给出因果链**：一句话讲清"为什么会失败"，含因果连接词。
6. **不给建议、不给安慰**。

## 敏感话题

即使涉及离婚、健康、家人冲突等敏感场景，也不能因"保持中立"省略具体信息。锋利但精准的描述比泛泛的关怀更有价值。

## 输出格式（严格 JSON）

{
  "paths": [
    {
      "index": 1,
      "category": "自身",
      "severity": "致命",
      "title": "你喜欢的是周末咖啡",
      "causal_chain": "你做了 7 年上海 PM 但没做过餐饮班..."
    }
  ]
}

按严重度排序：致命 → 警惕 → 留意。

## 禁止

- JSON 外不说任何话
- 不用"可能"、"也许"等弱化词
- 不重复路径
- 不超出用户描述编造
- 字符串值内禁用 ASCII 双引号，用中文引号 " "`;

export const SYSTEM_PROMPT_CLARIFY = `你是 Inversion 的澄清助手。基于用户的决策描述，给出 3 个最关键的澄清问题。这些问题会让后续的失败路径推演更具体。

## 要求

- **必须 3 个**，不多不少
- 每个问题 ≤ 30 字
- 覆盖用户没说清楚的关键维度：资源、时间窗、退路、经验、家庭、动机
- 优先问那些"如果没问清楚，AI 给的失败路径会很空泛"的点

## 输出格式（严格 JSON）

{
  "questions": ["问题 1", "问题 2", "问题 3"]
}

## 禁止

- JSON 外不说任何话
- 不要问"你考虑过什么"这种空泛问题——要问具体数字 / 状态 / 资源`;

export const SYSTEM_PROMPT_MITIGATION = `你是 Inversion 的"避险动作生成器"。基于用户的原始决策、其中一条致命/警惕路径，生成 **本周可执行** 的避险动作清单。

## 核心原则

1. **3-5 条动作**，不多不少
2. **每条必须本周可执行**（这周内能开始做的具体事情，不是"长期养成习惯"）
3. **每条可量化**：含数字 / 时间 / 人 / 地点 / 资源等具体维度
4. **每条可验证**：动作完成 vs 未完成必须能二元判断
5. **每条引用用户的原始处境**——不要给放之四海皆准的废话
6. **针对的是这条具体路径，不是泛泛的"为决策做准备"**

## 正例（合格）

路径：你妻子刚生二胎且无收入，50 万亏损会击穿家庭账本

合格避险：
- 本周末和妻子坐下来，列出 3 张表：家庭现金流（月支出/收入）、可承受损失上限、备选方案 B（缩小规模 / 暂缓）
- 周三前找认识的 2 位独立开发者朋友约咖啡，问"我现在 32 岁 PM 月薪 4 万，去做精品咖啡店，你怎么看？"
- 本周一晚上在 Excel 写 9 个月最坏情景预算表，分行：房贷、奶粉、其他必需

## 反例（不合格）

- "做好充足的准备"（空泛 + 不可验证）
- "和家人多沟通"（空泛 + 没时间数字）
- "评估风险"（空泛 + 不可量化）
- "建立应急基金"（没数字 / 没时间）

## 输出格式（严格 JSON）

{
  "actions": [
    {
      "index": 1,
      "title": "和妻子做家庭现金流对账",
      "detail": "本周末（5/18-19）和妻子坐下来 1 小时，列出 3 张表：…",
      "this_week": true,
      "verifiable": true
    }
  ]
}

## 禁止

- JSON 外不说任何话
- 不用"可能"、"也许"、"建议"、"应该考虑"等弱化词
- 不写"长期习惯"或需要数月才能完成的事
- 字符串值内禁用 ASCII 双引号，用中文引号 " "`;

// ============ JSON 抽取（复用 PoC 逻辑）============

export function extractJson(content) {
  if (!content || typeof content !== "string") return null;

  // 1. 直接解析
  try {
    return JSON.parse(content);
  } catch {}

  // 2. markdown 代码块
  const cb = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cb) {
    try {
      return JSON.parse(cb[1].trim());
    } catch {}
  }

  // 3. 首个 { 到末尾 }
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = content.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}

    // 4. 去尾随逗号
    try {
      const fixed = candidate.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(fixed);
    } catch {}

    // 5. 修复字符串内裸 ASCII 引号
    try {
      let fixed = candidate;
      for (let i = 0; i < 5; i++) {
        const before = fixed;
        fixed = fixed.replace(
          /([一-龥，。！？、；：])"([^"\n{}\[\]]{1,80}?)"([一-龥，。！？、；：])/g,
          "$1“$2”$3"
        );
        if (fixed === before) break;
      }
      fixed = fixed.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(fixed);
    } catch {}
  }

  return null;
}

// ============ Provider 配置 ============

const PROVIDERS = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    chatModel: "deepseek-chat",
    reasonerModel: "deepseek-reasoner",
  },
};

// ============ API 调用 ============

/**
 * 测试 key 是否有效（轻量调用）
 */
export async function testApiKey(provider, key) {
  if (provider !== "deepseek") {
    return { ok: false, message: "v0.1 暂时只支持 DeepSeek" };
  }
  const cfg = PROVIDERS[provider];
  try {
    const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.chatModel,
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (resp.ok) return { ok: true, message: "Key 可用" };
    const err = await resp.json().catch(() => ({}));
    return {
      ok: false,
      message: err?.error?.message || `HTTP ${resp.status}`,
    };
  } catch (e) {
    return { ok: false, message: e.message || "网络错误" };
  }
}

/**
 * 生成 3 个澄清问题
 */
export async function generateClarifyingQuestions(provider, key, decision) {
  if (provider !== "deepseek") throw new Error("v0.1 仅支持 DeepSeek");
  const cfg = PROVIDERS[provider];

  const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel, // 澄清用 chat 模型够，快
      max_tokens: 800,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT_CLARIFY },
        { role: "user", content: `[决策]\n${decision}` },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("AI 返回的澄清问题格式不正确");
  }
  // 强制 3 个
  return parsed.questions.slice(0, 3);
}

/**
 * 流式生成 20 条失败路径
 * @param onChunk 每次拿到新内容片段时调用
 * @returns 完整结果对象 { paths: [...] }
 */
export async function runInversion(provider, key, decision, clarifications, onChunk) {
  if (provider !== "deepseek") throw new Error("v0.1 仅支持 DeepSeek");
  const cfg = PROVIDERS[provider];

  // 构造用户输入
  let userText = `[决策]\n${decision}\n\n[澄清问答]\n`;
  for (const { q, a } of clarifications) {
    userText += `Q: ${q}\nA: ${a}\n\n`;
  }
  userText = userText.trim();

  const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: cfg.reasonerModel,
      max_tokens: 6000,
      temperature: 0.7,
      stream: true,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT_INVERSION },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  // 流式 SSE 解析
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          if (onChunk) onChunk(fullText);
        }
      } catch {}
    }
  }

  // 解析完整 JSON
  const result = extractJson(fullText);
  if (!result || !Array.isArray(result.paths) || result.paths.length === 0) {
    throw new Error("AI 返回的推演结果格式不正确");
  }
  return result;
}

/**
 * 估算已生成的路径条数（基于流式累积文本里 "index": N 出现的次数）
 */
export function estimatePathCount(streamingText) {
  if (!streamingText) return 0;
  const matches = streamingText.match(/"index"\s*:\s*\d+/g);
  return matches ? matches.length : 0;
}

/**
 * 为一条致命/警惕路径生成 3-5 条避险动作
 * @returns { actions: [...] }
 */
export async function generateMitigation(provider, key, decision, clarifications, path) {
  if (provider !== "deepseek") throw new Error("v0.1 仅支持 DeepSeek");
  const cfg = PROVIDERS[provider];

  // 构造用户上下文
  let context = `[原始决策]\n${decision}\n\n`;
  if (clarifications && clarifications.length > 0) {
    context += "[澄清问答]\n";
    for (const { q, a } of clarifications) {
      context += `Q: ${q}\nA: ${a}\n`;
    }
    context += "\n";
  }
  context += `[这条失败路径]\n`;
  context += `严重程度: ${path.severity || "?"}\n`;
  context += `分类: ${path.category || "?"}\n`;
  context += `标题: ${path.title || "?"}\n`;
  context += `因果链: ${path.causal_chain || ""}\n\n`;
  context += `请基于上述完整上下文，为这条路径生成 3-5 条本周可执行的避险动作。`;

  const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel, // 避险用 chat 模型够，快
      max_tokens: 2000,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT_MITIGATION },
        { role: "user", content: context.trim() },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
    throw new Error("AI 返回的避险清单格式不正确");
  }
  // 限制 3-5 条
  return { actions: parsed.actions.slice(0, 5) };
}
