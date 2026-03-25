/**
 * App-wide language state for the core layer.
 *
 * The canonical language source is `Company.language`. This module provides
 * convenience accessors so that any module can read the current language
 * without importing Company (which would create circular dependencies).
 *
 * Call `bindCompanyLanguageSource(company)` once after Company is created or
 * restored. After that, getAppLanguage() reads company.language and
 * setAppLanguage() writes to company.language.
 *
 * If no Company is bound yet (e.g. during early boot), a module-level
 * fallback `_fallbackLang` is used.
 */

const LANGUAGE_NAMES = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

/** @type {import('../../core/organization/company.js').Company | null} */
let _companyRef = null;

/** Fallback used before a Company is bound */
let _fallbackLang = 'en';

// ======================== Binding ========================

/**
 * Bind a Company instance so that all language reads/writes go through
 * `company.language`. Call this once after Company creation or deserialization.
 *
 * @param {object} company - The Company instance (must have a `language` property)
 */
export function bindCompanyLanguageSource(company) {
  _companyRef = company;
}

/**
 * Unbind the current Company reference (e.g. on factory reset).
 */
export function unbindCompanyLanguageSource() {
  _companyRef = null;
}

// ======================== Read / Write ========================

/**
 * Update the current app language.
 * Writes to company.language if bound, otherwise to module fallback.
 *
 * @param {string} lang - Language code (e.g. 'en', 'zh', 'ja')
 */
export function setAppLanguage(lang) {
  if (!lang || typeof lang !== 'string') return;
  const code = lang.toLowerCase().split('-')[0];
  if (!LANGUAGE_NAMES[code]) return;

  if (_companyRef) {
    _companyRef.language = code;
  } else {
    _fallbackLang = code;
  }
}

/**
 * Get the current app language code.
 * Reads from company.language if bound, otherwise module fallback.
 *
 * @returns {string} e.g. 'en', 'zh'
 */
export function getAppLanguage() {
  if (_companyRef && _companyRef.language) {
    return _companyRef.language;
  }
  return _fallbackLang;
}

/**
 * Get the human-readable name for the current app language.
 * @returns {string} e.g. 'English', 'Chinese (Simplified)'
 */
export function getAppLanguageName() {
  return LANGUAGE_NAMES[getAppLanguage()] || 'English';
}

/**
 * Get the human-readable language name by language code.
 * @param {string} code - Language code (e.g. 'en', 'zh')
 * @returns {string} e.g. 'English', 'Chinese (Simplified)'
 */
export function getLanguageNameByCode(code) {
  return (code && LANGUAGE_NAMES[code]) || 'English';
}

/**
 * Check whether a language code is supported.
 * @param {string} code
 * @returns {boolean}
 */
export function isSupportedLanguage(code) {
  return !!(code && LANGUAGE_NAMES[code]);
}

/**
 * Get all supported language codes and names.
 * @returns {Array<{code: string, name: string}>}
 */
export function getSupportedLanguages() {
  return Object.entries(LANGUAGE_NAMES).map(([code, name]) => ({ code, name }));
}

/**
 * Build a language enforcement instruction for LLM system prompts.
 *
 * When an explicit `lang` is provided it takes precedence; otherwise
 * the Company-bound language is used.
 *
 * @param {string} [lang] - Optional explicit override
 * @returns {string}
 */
export function buildLanguageInstruction(lang) {
  const langName = lang ? getLanguageNameByCode(lang) : getAppLanguageName();
  return `\n## Response Language (MANDATORY)\nYou MUST respond in ${langName}. All your messages, reports, summaries, and deliverables MUST be written in ${langName}. This applies to all conversations, task outputs, and any text you generate. Only code, technical identifiers, and file paths may remain in their original language.\n`;
}
