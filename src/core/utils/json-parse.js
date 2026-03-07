/**
 * Robust JSON parser for LLM / Web Agent output.
 *
 * LLM（尤其是 ChatGPT web 版）返回的 "JSON" 经常包含各种脏字符：
 * - Markdown 代码块包裹 (```json ... ```)
 * - Smart quotes（"" → ""）
 * - BOM / 零宽空格等不可见字符
 * - JSON 前后有额外的文字说明
 * - 值中未转义的换行符
 * - 尾逗号 (trailing comma)
 *
 * 本模块提供统一的解析入口，避免在业务代码中重复编写 fallback 链。
 */

/**
 * 清理 LLM 输出中常见的脏字符，使其更容易被 JSON.parse 解析。
 * @param {string} raw
 * @returns {string}
 */
function sanitize(raw) {
  let s = raw;

  // 1. 移除 BOM 和常见零宽字符
  s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

  // 2. Smart quotes → ASCII quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');  // ""„‟ → "
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");  // '' → '

  // 3. 全角冒号 → 半角（JSON key-value 分隔符）
  // 仅在明显的 JSON key 上下文中替换，避免误伤内容
  // "key"：value → "key":value
  s = s.replace(/"(\s*)：(\s*)/g, '"$1:$2');

  return s;
}

/**
 * 尝试从原始字符串中提取并解析 JSON 对象。
 *
 * 解析策略（按优先级）：
 * 1. 直接 JSON.parse
 * 2. 去除 markdown code fence 后解析
 * 3. 提取第一个 ```json ... ``` 或 ``` ... ``` 块
 * 4. 提取最外层的 { ... } 子串
 * 5. 修复尾逗号后重试
 *
 * @param {string} raw - LLM / Web Agent 的原始输出
 * @param {object} [options]
 * @param {boolean} [options.allowArray=false] - 是否允许顶层是数组
 * @returns {object|Array} 解析后的 JSON 对象
 * @throws {Error} 如果所有策略均失败
 */
export function robustJSONParse(raw, options = {}) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('robustJSONParse: input is empty or not a string');
  }

  const allowArray = options.allowArray ?? false;
  const cleaned = sanitize(raw);

  // 判断是否为有效的 JSON 值（对象，或可选的数组）
  const isValid = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'object' && !Array.isArray(v)) return true;
    if (allowArray && Array.isArray(v)) return true;
    return false;
  };

  // ── Strategy 1: 直接解析 ──
  try {
    const result = JSON.parse(cleaned);
    if (isValid(result)) return result;
  } catch {}

  // ── Strategy 2: 去除外层 markdown fence ──
  {
    const tick = '`';
    const fence = tick + tick + tick;
    let stripped = cleaned.trim();
    // 可能有多层 fence
    for (let i = 0; i < 2; i++) {
      if (stripped.startsWith(fence)) {
        // 移除开头 fence（含可选的语言标签）和结尾 fence
        stripped = stripped.replace(new RegExp('^' + fence.replace(/`/g, '\\`') + '[a-zA-Z]*\\s*\\n?'), '');
        stripped = stripped.replace(new RegExp('\\n?\\s*' + fence.replace(/`/g, '\\`') + '\\s*$'), '');
      }
    }
    if (stripped !== cleaned.trim()) {
      try {
        const result = JSON.parse(stripped.trim());
        if (isValid(result)) return result;
      } catch {}
    }
  }

  // ── Strategy 3: 提取 code block 内容 ──
  {
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        const result = JSON.parse(codeBlockMatch[1].trim());
        if (isValid(result)) return result;
      } catch {}
      // code block 内容可能也有脏字符，递归尝试提取 {...}
      try {
        const inner = codeBlockMatch[1].trim();
        const start = inner.indexOf('{');
        const end = inner.lastIndexOf('}');
        if (start !== -1 && end > start) {
          const result = JSON.parse(inner.substring(start, end + 1));
          if (isValid(result)) return result;
        }
      } catch {}
    }
  }

  // ── Strategy 4: 提取最外层 { ... } ──
  {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const candidate = cleaned.substring(start, end + 1);
      try {
        const result = JSON.parse(candidate);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 5: 修复尾逗号 ──
      try {
        const fixed = candidate.replace(/,\s*([\]}])/g, '$1');
        const result = JSON.parse(fixed);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 6: 修复值中未转义的换行 ──
      try {
        // 将 JSON 字符串值内的真实换行替换为 \\n
        const fixedNewlines = candidate.replace(
          /"(?:[^"\\]|\\.)*"/g,
          (match) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        );
        const result = JSON.parse(fixedNewlines);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 7: 修复尾逗号 + 换行一起 ──
      try {
        let fixed = candidate.replace(/,\s*([\]}])/g, '$1');
        fixed = fixed.replace(
          /"(?:[^"\\]|\\.)*"/g,
          (match) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        );
        const result = JSON.parse(fixed);
        if (isValid(result)) return result;
      } catch {}
    }
  }

  // ── Strategy 8: 允许数组时，提取 [ ... ] ──
  if (allowArray) {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const result = JSON.parse(cleaned.substring(start, end + 1));
        if (Array.isArray(result)) return result;
      } catch {}
    }
  }

  // 全部失败
  throw new Error(`robustJSONParse: Cannot extract valid JSON from LLM output (length=${raw.length}, preview="${raw.substring(0, 120)}")`);
}

/**
 * 安全版本 — 解析失败不抛异常，返回 null。
 * @param {string} raw
 * @param {object} [options]
 * @returns {object|Array|null}
 */
export function safeJSONParse(raw, options = {}) {
  try {
    return robustJSONParse(raw, options);
  } catch {
    return null;
  }
}
