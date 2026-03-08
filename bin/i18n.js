import en from '../src/locales/en.js';
import zh from '../src/locales/zh.js';
import ja from '../src/locales/ja.js';
import ko from '../src/locales/ko.js';
import es from '../src/locales/es.js';
import fr from '../src/locales/fr.js';
import de from '../src/locales/de.js';

const translations = { en, zh, ja, ko, es, fr, de };
const DEFAULT_LANG = 'en';

function sanitiseLangToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null;
  return trimmed.toLowerCase().split('-')[0] || null;
}

function resolveLang() {
  const envLang = process.env.IDEACO_LANG
    || process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG;
  const code = sanitiseLangToken(envLang || '');
  if (code && translations[code]) return code;
  return DEFAULT_LANG;
}

function getNestedValue(obj, key) {
  return key.split('.').reduce((o, k) => o?.[k], obj);
}

export function createCliT() {
  const lang = resolveLang();
  return function t(key, params) {
    let str = getNestedValue(translations[lang], key)
      || getNestedValue(translations[DEFAULT_LANG], key)
      || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  };
}
