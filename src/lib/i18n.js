
'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import en from '@/locales/en';
import zh from '@/locales/zh';
import ja from '@/locales/ja';
import ko from '@/locales/ko';
import es from '@/locales/es';
import fr from '@/locales/fr';
import de from '@/locales/de';

const translations = { en, zh, ja, ko, es, fr, de };

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
];

const DEFAULT_LANG = 'en';

/**
 * Module-level current language code.
 * Updated by I18nProvider whenever language changes.
 * Accessible outside React via getCurrentLangCode() — used by client-store.js
 * for X-App-Lang header.
 */
let _currentLangCode = DEFAULT_LANG;

/**
 * Get current language code outside of React context.
 * Used by client-store.js for API request headers.
 * @returns {string}
 */
export function getCurrentLangCode() {
  return _currentLangCode;
}

const I18nContext = createContext(null);

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);

  // Initialize language from company state (fetched on app load)
  // No localStorage caching — the backend Company is the single source of truth.
  const initLangFromCompany = useCallback((companyLang) => {
    if (companyLang && translations[companyLang]) {
      setLangState(companyLang);
      _currentLangCode = companyLang;
      document.documentElement.lang = companyLang === 'zh' ? 'zh-CN' : companyLang;
    }
  }, []);

  const setLang = useCallback(async (code) => {
    if (translations[code]) {
      setLangState(code);
      _currentLangCode = code;
      document.documentElement.lang = code === 'zh' ? 'zh-CN' : code;
      // Sync language to backend Company (single source of truth).
      // During SetupWizard (no company yet), the PUT will 400 — that's fine,
      // language will be sent via createCompany() instead.
      try {
        await fetch('/api/company', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: code }),
        });
      } catch {
        // Ignore — either no company yet or network error
      }
    }
  }, []);

  const t = useCallback((key, params) => {
    let str = getNestedValue(translations[lang], key)
      || getNestedValue(translations[DEFAULT_LANG], key)
      || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      });
    }
    return str;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, initLangFromCompany }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export function LanguageSelector({ className = '', direction = 'up' }) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ bottom: 0, left: 0, top: 0 });
  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        top: rect.bottom + 4,
      });
    }
  }, [open]);

  const menuStyle = direction === 'down'
    ? { top: menuPos.top, left: menuPos.left }
    : { bottom: menuPos.bottom, left: menuPos.left };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs bg-white/5 hover:bg-white/10 transition-all text-[var(--muted)] hover:text-white"
      >
        <span>{current.flag}</span>
        <span>{current.label}</span>
        <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-50 py-1 min-w-[140px]"
            style={menuStyle}
          >
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-all ${
                  lang === l.code ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                }`}
              >
                <span>{l.flag}</span>
                <span>{l.label}</span>
                {lang === l.code && <span className="ml-auto">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
