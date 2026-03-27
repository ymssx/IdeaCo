/**
 * Robust JSON parser for LLM / Web Agent output.
 *
 * LLM output (especially ChatGPT web) often contains various dirty characters:
 * - Markdown code block wrappers (```json ... ```)
 * - Smart quotes ("" → "")
 * - BOM / zero-width spaces and other invisible characters
 * - Extra text before/after the JSON
 * - Unescaped newlines inside string values
 * - Trailing commas
 *
 * This module provides a unified parsing entry point to avoid
 * repetitive fallback chains in business code.
 */

/**
 * Clean common dirty characters from LLM output to make JSON.parse work.
 * @param {string} raw
 * @returns {string}
 */
function sanitize(raw) {
  let s = raw;

  // 1. Remove BOM and common zero-width characters
  s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

  // 2. Smart quotes → ASCII quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');  // curly double quotes → "
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");  // curly single quotes → '

  // 3. Fullwidth colon → halfwidth (JSON key-value separator)
  // Only replace in obvious JSON key context to avoid damaging content
  // "key"：value → "key":value
  s = s.replace(/"(\s*)：(\s*)/g, '"$1:$2');

  return s;
}

/**
 * Build a smart preview of failed JSON output for error messages.
 * Instead of blindly truncating (which cuts mid-value and produces unreadable output),
 * this attempts to parse partial JSON and truncate individual values while preserving
 * the overall JSON structure so the preview is always parseable and informative.
 *
 * @param {string} raw - The original LLM output
 * @param {number} maxLen - Maximum preview length (default 500)
 * @returns {string} A structured preview string
 */
function buildSmartPreview(raw, maxLen = 500) {
  if (!raw || raw.length <= maxLen) return raw || '';

  // Try to extract the { ... } block first
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');

  if (braceStart !== -1 && braceEnd > braceStart) {
    const candidate = raw.substring(braceStart, braceEnd + 1);
    // Try to parse and truncate values
    try {
      // Fix common issues first
      let fixed = candidate.replace(/,\s*([\]}])/g, '$1');
      fixed = fixed.replace(
        /"(?:[^"\\]|\\.)*"/g,
        (match) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      );
      const parsed = JSON.parse(fixed);
      const truncated = truncateValues(parsed, 80);
      return JSON.stringify(truncated, null, 2).substring(0, maxLen);
    } catch {
      // Can't parse — fall through to raw truncation
    }

    // Even if can't parse, show the { ... } block with better boundaries
    if (candidate.length <= maxLen) return candidate;
    // Find a natural break point (end of a key-value pair)
    const safeSlice = candidate.substring(0, maxLen);
    const lastComma = safeSlice.lastIndexOf(',');
    const lastNewline = safeSlice.lastIndexOf('\n');
    const breakPoint = Math.max(lastComma, lastNewline);
    if (breakPoint > maxLen * 0.5) {
      return safeSlice.substring(0, breakPoint + 1) + '\n  ... (truncated)';
    }
  }

  // Fallback: raw truncation at natural boundary
  const safeSlice = raw.substring(0, maxLen);
  const lastNewline = safeSlice.lastIndexOf('\n');
  if (lastNewline > maxLen * 0.5) {
    return safeSlice.substring(0, lastNewline) + '\n... (truncated)';
  }
  return safeSlice + '... (truncated)';
}

/**
 * Recursively truncate string values in a parsed JSON object.
 * Preserves structure (keys, nesting) while shortening long string values.
 * @param {*} obj
 * @param {number} maxValueLen
 * @returns {*}
 */
function truncateValues(obj, maxValueLen = 80) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.length > maxValueLen
      ? obj.substring(0, maxValueLen) + '...(truncated)'
      : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => truncateValues(item, maxValueLen));
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = truncateValues(value, maxValueLen);
    }
    return result;
  }
  return obj; // numbers, booleans, etc.
}

/**
 * Attempt to extract and parse a JSON object from a raw string.
 *
 * Parsing strategies (by priority):
 * 1. Direct JSON.parse
 * 2. Strip markdown code fences and parse
 * 3. Extract first ```json ... ``` or ``` ... ``` block
 * 4. Extract outermost { ... } substring
 * 5. Fix trailing commas and retry
 *
 * @param {string} raw - Raw LLM / Web Agent output
 * @param {object} [options]
 * @param {boolean} [options.allowArray=false] - Whether to allow top-level arrays
 * @returns {object|Array} Parsed JSON object
 * @throws {Error} If all strategies fail
 */
export function robustJSONParse(raw, options = {}) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('robustJSONParse: input is empty or not a string');
  }

  const allowArray = options.allowArray ?? false;
  const cleaned = sanitize(raw);

  // Check if value is a valid JSON result (object, or optionally array)
  const isValid = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'object' && !Array.isArray(v)) return true;
    if (allowArray && Array.isArray(v)) return true;
    return false;
  };

  // ── Strategy 1: Direct parse ──
  try {
    const result = JSON.parse(cleaned);
    if (isValid(result)) return result;
  } catch {}

  // ── Strategy 2: Strip outer markdown fence ──
  {
    const tick = '`';
    const fence = tick + tick + tick;
    let stripped = cleaned.trim();
    // May have multiple layers of fences
    for (let i = 0; i < 2; i++) {
      if (stripped.startsWith(fence)) {
        // Remove opening fence (with optional language tag) and closing fence
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

  // ── Strategy 3: Extract code block content ──
  {
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        const result = JSON.parse(codeBlockMatch[1].trim());
        if (isValid(result)) return result;
      } catch {}
      // Code block content may also have dirty chars — try extracting {...}
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

  // ── Strategy 4: Extract outermost { ... } ──
  {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const candidate = cleaned.substring(start, end + 1);
      try {
        const result = JSON.parse(candidate);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 5: Fix trailing commas ──
      try {
        const fixed = candidate.replace(/,\s*([\]}])/g, '$1');
        const result = JSON.parse(fixed);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 6: Fix unescaped newlines in string values ──
      try {
        // Replace real newlines inside JSON string values with \\n
        const fixedNewlines = candidate.replace(
          /"(?:[^"\\]|\\.)*"/g,
          (match) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        );
        const result = JSON.parse(fixedNewlines);
        if (isValid(result)) return result;
      } catch {}

      // ── Strategy 7: Fix trailing commas + newlines together ──
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

  // ── Strategy 8: Extract [ ... ] when arrays are allowed ──
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

  // All strategies failed — build a smart preview that preserves JSON structure
  const preview = buildSmartPreview(raw, 500);
  throw new Error(`robustJSONParse: Cannot extract valid JSON from LLM output (length=${raw.length}, preview=${preview})`);
}

/**
 * Safe version — returns null on parse failure instead of throwing.
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

/**
 * Extract the value of a specific JSON string field from a partial/incomplete JSON string.
 * Designed for real-time streaming: works incrementally as tokens arrive.
 *
 * @param {string} partial - The accumulated (possibly incomplete) JSON string so far
 * @param {string} [fieldName='content'] - The JSON field name to extract
 * @returns {string} The extracted value so far (may be incomplete)
 *
 * @example
 *   extractFieldFromPartialJSON('{"content": "hello wor') // => "hello wor"
 *   extractFieldFromPartialJSON('{"content": "hello world", "action": null}') // => "hello world"
 */
export function extractFieldFromPartialJSON(partial, fieldName = 'content') {
  // Build a regex to match "fieldName" : "
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`"${escaped}"\\s*:\\s*"`);
  const match = keyPattern.exec(partial);
  if (!match) return '';

  const valueStart = match.index + match[0].length;
  let result = '';
  let i = valueStart;

  while (i < partial.length) {
    const ch = partial[i];
    if (ch === '\\') {
      // Escaped character
      if (i + 1 >= partial.length) break; // Incomplete escape at end
      const next = partial[i + 1];
      switch (next) {
        case '"': result += '"'; break;
        case '\\': result += '\\'; break;
        case 'n': result += '\n'; break;
        case 'r': result += '\r'; break;
        case 't': result += '\t'; break;
        case '/': result += '/'; break;
        case 'b': result += '\b'; break;
        case 'f': result += '\f'; break;
        case 'u': {
          // Unicode escape \uXXXX
          if (i + 5 < partial.length) {
            const hex = partial.slice(i + 2, i + 6);
            const code = parseInt(hex, 16);
            if (!isNaN(code)) {
              result += String.fromCharCode(code);
              i += 6;
              continue;
            }
          }
          break; // Incomplete unicode escape
        }
        default: result += next;
      }
      i += 2;
    } else if (ch === '"') {
      break; // End of string value
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}
