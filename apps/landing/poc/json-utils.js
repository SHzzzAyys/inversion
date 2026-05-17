// JSON 抽取与修复工具
// 用于 PoC 主流程 + 救援已有失败案例
// 给生产部 M1 阶段当作 LLM 调用层的标配中间件

/**
 * 尝试从 LLM 原始响应里抽取合法 JSON。
 * 按以下顺序尝试：
 *   1. 直接 JSON.parse
 *   2. 找 ```json ... ``` 或 ``` ... ``` 代码块
 *   3. 找首个 { 到末尾 } 的子串
 *   4. 修复常见错误（尾随逗号、单引号）后重试
 *
 * @param {string} content LLM 原始响应
 * @returns {object|null} 解析成功返回对象；失败返回 null
 */
export function extractJson(content) {
  if (!content || typeof content !== "string") return null;

  // Strategy 1: 直接解析
  try {
    return JSON.parse(content);
  } catch {}

  // Strategy 2: 找 markdown 代码块（含或不含 json 标记）
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // Strategy 3: 找首个 { 到末尾 } 子串
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = content.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}

    // Strategy 4: 常见修复后再试
    try {
      const fixed = candidate
        // 去尾随逗号 `,}` → `}`、`,]` → `]`
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(fixed);
    } catch {}

    // Strategy 5: 修复字符串值内的裸 ASCII 双引号
    // 中文/中文标点 + ASCII " + 非引号非换行内容 + ASCII " + 中文/中文标点
    // → 把中间的两个 ASCII " 替换为中文引号 "..."
    try {
      let fixed = candidate;
      // 多跑几次以处理嵌套
      for (let i = 0; i < 5; i++) {
        const before = fixed;
        fixed = fixed.replace(
          /([一-龥，。！？、；：])"([^"\n{}\[\]]{1,80}?)"([一-龥，。！？、；：])/g,
          "$1“$2”$3"
        );
        if (fixed === before) break;
      }
      // 再去尾随逗号
      fixed = fixed.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(fixed);
    } catch {}
  }

  return null;
}

/**
 * 验证抽取的 JSON 是否符合 paths schema 要求。
 *
 * @param {object} parsed extractJson 的返回
 * @returns {boolean}
 */
export function isValidPathsResponse(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (!Array.isArray(parsed.paths)) return false;
  if (parsed.paths.length === 0) return false;
  // 至少每条都要有 title 字段
  return parsed.paths.every(
    (p) => p && typeof p === "object" && typeof p.title === "string"
  );
}
