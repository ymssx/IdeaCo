/**
 * Server-side i18n utility for API routes.
 *
 * Reads the Accept-Language header (or a custom X-App-Lang header set by the
 * frontend) and returns a translator function `t(key, params?)` that resolves
 * keys from the same locale files used by the client.
 *
 * Usage in a route handler:
 *   import { getApiT } from '@/lib/api-i18n';
 *
 *   export async function GET(request) {
 *     const t = getApiT(request);
 *     const company = getCompany();
 *     if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
 *     ...
 *   }
 *
 * Keys live under the `api` namespace in every locale file.
 *
 * Edge case handling:
 * - null / undefined request          → falls back to DEFAULT_LANG ('en')
 * - request without .headers          → falls back to DEFAULT_LANG
 * - empty, whitespace-only, or '*' X-App-Lang header → falls back to Accept-Language / DEFAULT_LANG
 * - malformed Accept-Language value   → skips invalid segments and falls back to DEFAULT_LANG
 * - unsupported / unknown language    → falls back to DEFAULT_LANG
 * - missing translation key in lang   → falls back to DEFAULT_LANG translation
 * - missing translation key in DEFAULT_LANG → returns the key itself (graceful degradation)
 * - getTForLang with invalid lang arg → falls back to DEFAULT_LANG
 * - any exception in resolveLanguage  → caught and DEFAULT_LANG returned
 */

import en from '@/locales/en';
import zh from '@/locales/zh';
import ja from '@/locales/ja';
import ko from '@/locales/ko';
import es from '@/locales/es';
import fr from '@/locales/fr';
import de from '@/locales/de';

const translations = { en, zh, ja, ko, es, fr, de };
const DEFAULT_LANG = 'en';

/** Supported language codes */
const SUPPORTED = new Set(Object.keys(translations));

/**
 * Human-readable language names for LLM prompt injection.
 * Used to instruct agents to reply in a specific language.
 */
export const LANGUAGE_NAMES = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

/**
 * Sanitise a raw language tag token into a bare 2-3 letter code.
 * Returns null when the token is empty, whitespace-only, or '*'.
 *
 * @param {string} raw  e.g. "zh-CN", "en", "*", " ", ""
 * @returns {string|null}
 */
function sanitiseLangToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // '*' means "any language" — not useful for lookup
  if (!trimmed || trimmed === '*') return null;
  // Strip region tag: "zh-CN" → "zh", "en-US" → "en"
  return trimmed.toLowerCase().split('-')[0] || null;
}

/**
 * Parse the best matching language from an Accept-Language header value.
 * Falls back to DEFAULT_LANG when nothing matches.
 *
 * Handles malformed input gracefully:
 *   - throws never; always returns a valid supported code
 *   - skips empty segments, bare quality-value tokens, and unknown codes
 *
 * @param {string|null} acceptLanguage  Value of the Accept-Language header
 * @param {string|null} appLang         Value of the X-App-Lang header (higher priority)
 * @returns {string} language code (always a member of SUPPORTED)
 */
function resolveLanguage(acceptLanguage, appLang) {
  try {
    // Explicit app-lang header has the highest priority (sent by the SPA)
    if (appLang) {
      const code = sanitiseLangToken(appLang);
      if (code && SUPPORTED.has(code)) return code;
      // appLang present but invalid/unsupported — fall through to Accept-Language
    }

    if (!acceptLanguage || typeof acceptLanguage !== 'string') return DEFAULT_LANG;

    // Parse Accept-Language: "zh-CN,zh;q=0.9,en;q=0.8"
    // Segments are comma-separated; each may carry a quality value after ';'
    const parts = acceptLanguage.split(',');
    for (const part of parts) {
      if (!part) continue;
      // Strip the quality value: "zh-CN;q=0.9" → "zh-CN"
      const [langTag] = part.trim().split(';');
      const code = sanitiseLangToken(langTag);
      if (code && SUPPORTED.has(code)) return code;
    }
  } catch (_) {
    // Safety net: any unexpected error during header parsing → use default
  }

  return DEFAULT_LANG;
}

/**
 * Resolve a dot-notated path inside a nested object.
 * @param {object} obj
 * @param {string} path  e.g. "api.noCompany"
 * @returns {string|undefined}
 */
function getNestedValue(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  return path.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Create a translator function for the given language code.
 *
 * Resolution order:
 *   1. translations[lang][key]
 *   2. translations[DEFAULT_LANG][key]  (en fallback)
 *   3. key itself                       (last-resort graceful degradation)
 *
 * @param {string} lang
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
function createTranslator(lang) {
  // Guard: if somehow lang is not in SUPPORTED, default to 'en'
  const resolvedLang = SUPPORTED.has(lang) ? lang : DEFAULT_LANG;

  return function t(key, params) {
    // Graceful key handling: non-string key returns empty string
    if (typeof key !== 'string' || !key) return '';

    let str = getNestedValue(translations[resolvedLang], key);

    // Fallback 1: english translation
    if (str == null || str === '') {
      str = getNestedValue(translations[DEFAULT_LANG], key);
    }

    // Fallback 2: return the key itself so callers always get a non-empty string
    if (str == null || str === '') {
      str = key;
    }

    // Parameter substitution: replace {param} placeholders
    if (params && typeof str === 'string' && typeof params === 'object') {
      try {
        Object.entries(params).forEach(([k, v]) => {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
        });
      } catch (_) {
        // If params substitution fails for any reason, return unsubstituted string
      }
    }

    return typeof str === 'string' ? str : key;
  };
}

/**
 * Build a translator from a Next.js Request object.
 *
 * Safe to call with null/undefined (returns English translator).
 * Safe to call when request.headers is absent or non-standard.
 *
 * @param {Request|null|undefined} request  Next.js request (may be null/undefined)
 * @returns {(key: string, params?: object) => string}
 */
export function getApiT(request) {
  // No request (e.g. GET routes that don't receive a request arg)
  if (!request) return createTranslator(DEFAULT_LANG);

  try {
    // Defensively read headers — request.headers may be absent or non-standard
    const getHeader = request.headers?.get?.bind(request.headers);
    const acceptLanguage = typeof getHeader === 'function'
      ? (getHeader('accept-language') ?? null)
      : null;
    const appLang = typeof getHeader === 'function'
      ? (getHeader('x-app-lang') ?? null)
      : null;

    const lang = resolveLanguage(acceptLanguage, appLang);
    return createTranslator(lang);
  } catch (_) {
    // If anything unexpected happens during header reading, fall back to English
    return createTranslator(DEFAULT_LANG);
  }
}

/**
 * Convenience: return translator for a specific language code directly.
 * Useful in background/async contexts where the original Request is unavailable.
 *
 * Always safe — any invalid, null, undefined, or unsupported lang falls back to DEFAULT_LANG.
 *
 * @param {string|null|undefined} lang
 * @returns {(key: string, params?: object) => string}
 */
export function getTForLang(lang) {
  // Sanitise: coerce to string, strip region tag, check support
  let code = DEFAULT_LANG;
  try {
    const sanitised = sanitiseLangToken(String(lang ?? ''));
    if (sanitised && SUPPORTED.has(sanitised)) {
      code = sanitised;
    }
  } catch (_) {
    // Fallback to DEFAULT_LANG on any error
  }
  return createTranslator(code);
}

/**
 * Extract the resolved language code from a Next.js Request object.
 * Returns a bare language code (e.g. 'en', 'zh', 'ja') — always valid and supported.
 *
 * @param {Request|null|undefined} request
 * @returns {string} language code
 */
export function getLanguageFromRequest(request) {
  if (!request) return DEFAULT_LANG;
  try {
    const getHeader = request.headers?.get?.bind(request.headers);
    const acceptLanguage = typeof getHeader === 'function'
      ? (getHeader('accept-language') ?? null)
      : null;
    const appLang = typeof getHeader === 'function'
      ? (getHeader('x-app-lang') ?? null)
      : null;
    return resolveLanguage(acceptLanguage, appLang);
  } catch (_) {
    return DEFAULT_LANG;
  }
}
