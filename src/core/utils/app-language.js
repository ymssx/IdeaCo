/**
 * App-wide language state for the core layer.
 *
 * API routes call `setAppLanguage(lang)` on each request so that
 * all agents/employees can read the current UI language and respond
 * in the correct language.
 *
 * This is intentionally a simple module-level singleton — no heavy
 * framework dependency, importable from anywhere in /src/core.
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

let _currentLang = 'en';

/**
 * Update the current app language. Called by API routes.
 * @param {string} lang - Language code (e.g. 'en', 'zh', 'ja')
 */
export function setAppLanguage(lang) {
  if (lang && typeof lang === 'string' && LANGUAGE_NAMES[lang]) {
    _currentLang = lang;
  }
}

/**
 * Get the current app language code.
 * @returns {string} e.g. 'en', 'zh'
 */
export function getAppLanguage() {
  return _currentLang;
}

/**
 * Get the human-readable name for the current app language.
 * @returns {string} e.g. 'English', 'Chinese (Simplified)'
 */
export function getAppLanguageName() {
  return LANGUAGE_NAMES[_currentLang] || 'English';
}

/**
 * Build a language enforcement instruction for LLM system prompts.
 * Returns an empty string for English (default), otherwise returns
 * an instruction telling the agent to respond in the target language.
 * @returns {string}
 */
export function buildLanguageInstruction() {
  const langName = getAppLanguageName();
  return `\n## Response Language (MANDATORY)\nYou MUST respond in ${langName}. All your messages, reports, summaries, and deliverables MUST be written in ${langName}. This applies to all conversations, task outputs, and any text you generate. Only code, technical identifiers, and file paths may remain in their original language.\n`;
}
