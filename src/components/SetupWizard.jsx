'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarChoices } from '@/lib/avatar';
import { useI18n, LanguageSelector } from '@/lib/i18n';
import AvatarGrid from './AvatarGrid';

const AVATAR_CHOICES_COUNT = 16;

export default function SetupWizard() {
  const { createCompany, loading } = useStore();
  const { t, lang } = useI18n();
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState(t('setup.defaultCompany'));
  const [bossName, setBossName] = useState('');

  // Boss avatar state
  const [bossGender, setBossGender] = useState('male');
  const [bossAge, setBossAge] = useState(35);
  const [bossSelectedAvatar, setBossSelectedAvatar] = useState(null);
  const [bossAvatarChoices, setBossAvatarChoices] = useState([]);

  const [secretaryName, setSecretaryName] = useState(t('setup.defaultSecretary'));

  // Track previous language to auto-update defaults on language switch
  const prevLangRef = useRef(lang);
  const prevDefaultCompanyRef = useRef(t('setup.defaultCompany'));
  const prevDefaultSecretaryRef = useRef(t('setup.defaultSecretary'));
  useEffect(() => {
    if (prevLangRef.current !== lang) {
      if (companyName === prevDefaultCompanyRef.current) {
        setCompanyName(t('setup.defaultCompany'));
      }
      if (secretaryName === prevDefaultSecretaryRef.current) {
        setSecretaryName(t('setup.defaultSecretary'));
      }
      prevLangRef.current = lang;
      prevDefaultCompanyRef.current = t('setup.defaultCompany');
      prevDefaultSecretaryRef.current = t('setup.defaultSecretary');
    }
  }, [lang, t, companyName, secretaryName]);

  const [secretaryGender, setSecretaryGender] = useState('female');
  const [secretaryAge, setSecretaryAge] = useState(18);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [avatarChoices, setAvatarChoices] = useState([]);

  // Boss avatar debounced refresh
  const bossDebounceTimer = useRef(null);
  const refreshBossAvatarChoices = useCallback((g, a) => {
    if (bossDebounceTimer.current) clearTimeout(bossDebounceTimer.current);
    bossDebounceTimer.current = setTimeout(() => {
      const choices = getAvatarChoices(AVATAR_CHOICES_COUNT, g, a);
      setBossAvatarChoices(choices);
      if (choices.length > 0) setBossSelectedAvatar(choices[0]);
    }, 300);
  }, []);

  useEffect(() => {
    refreshBossAvatarChoices(bossGender, bossAge);
    return () => { if (bossDebounceTimer.current) clearTimeout(bossDebounceTimer.current); };
  }, [bossGender, bossAge, refreshBossAvatarChoices]);

  const bossAvatar = bossSelectedAvatar?.url || '';

  const refreshBossChoices = () => {
    const choices = getAvatarChoices(AVATAR_CHOICES_COUNT, bossGender, bossAge);
    setBossAvatarChoices(choices);
  };

  // Secretary avatar debounced refresh
  const debounceTimer = useRef(null);
  const refreshAvatarChoices = useCallback((g, a) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const choices = getAvatarChoices(AVATAR_CHOICES_COUNT, g, a);
      setAvatarChoices(choices);
      if (choices.length > 0) {
        setSelectedAvatar(choices[0]);
      }
    }, 300);
  }, []);

  useEffect(() => {
    refreshAvatarChoices(secretaryGender, secretaryAge);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [secretaryGender, secretaryAge, refreshAvatarChoices]);

  const secretaryAvatar = selectedAvatar?.url || '';

  const refreshChoices = () => {
    const choices = getAvatarChoices(AVATAR_CHOICES_COUNT, secretaryGender, secretaryAge);
    setAvatarChoices(choices);
  };

  const handleCreate = async () => {
    try {
      await createCompany(companyName, bossName, {
        secretaryName: secretaryName || t('setup.defaultSecretary'),
        secretaryAvatar: secretaryAvatar,
        secretaryGender,
        secretaryAge,
        bossAvatar: bossAvatar,
      });
    } catch (e) {
      // error handled by store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Logo & Title */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="flex justify-end mb-2">
            <LanguageSelector direction="down" />
          </div>
          <div className="text-6xl mb-4">🏢</div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-purple-500 bg-clip-text text-transparent">
            {t('setup.title')}
          </h1>
          <p className="text-[var(--muted)] mt-2">{t('setup.subtitle')}</p>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">{t('setup.step1Title')}</h2>
            <p className="text-sm text-[var(--muted)]">{t('setup.step1Desc')}</p>

            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('setup.companyName')}</label>
              <input
                className="input w-full"
                placeholder={t('setup.companyPlaceholder')}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="shrink-0">
                {bossAvatar ? (
                  <img
                    src={bossAvatar}
                    alt="boss"
                    className="w-16 h-16 rounded-full bg-[var(--border)] border-2 border-[var(--accent)]/30"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold">
                    👑
                  </div>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-sm mb-1 text-[var(--muted)]">{t('setup.bossTitle')}</label>
                <input
                  className="input w-full"
                  placeholder={t('setup.bossPlaceholder')}
                  value={bossName}
                  onChange={(e) => setBossName(e.target.value)}
                />
              </div>
            </div>

            {/* Boss avatar selection */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--muted)]">{t('setup.bossAvatarTitle')}</label>
                <span className="text-xs text-[var(--muted)]">{t('setup.bossAvatarDesc')}</span>
              </div>

              {/* Gender & Age */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1 text-[var(--muted)]">{t('setup.gender')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setBossGender('male'); setBossSelectedAvatar(null); }}
                      className={`flex-1 py-1.5 px-2 rounded-lg border text-xs transition-all ${
                        bossGender === 'male'
                          ? 'border-blue-400 bg-blue-400/10 text-blue-300'
                          : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                      }`}
                    >{t('setup.male')}</button>
                    <button
                      onClick={() => { setBossGender('female'); setBossSelectedAvatar(null); }}
                      className={`flex-1 py-1.5 px-2 rounded-lg border text-xs transition-all ${
                        bossGender === 'female'
                          ? 'border-pink-400 bg-pink-400/10 text-pink-300'
                          : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                      }`}
                    >{t('setup.female')}</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs mb-1 text-[var(--muted)]">{t('setup.age', { n: bossAge })}</label>
                  <div className="relative flex items-center gap-2">
                    <button
                      onClick={() => setBossAge(a => Math.max(18, a - 1))}
                      className="w-6 h-6 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-xs font-bold shrink-0"
                    >−</button>
                    <div className="flex-1 relative h-4 flex items-center">
                      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--border)] pointer-events-none" />
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-purple-400 pointer-events-none"
                        style={{ width: `${((bossAge - 18) / 42) * 100}%` }}
                      />
                      <input
                        type="range"
                        min="18"
                        max="60"
                        value={bossAge}
                        onChange={e => { setBossAge(Number(e.target.value)); setBossSelectedAvatar(null); }}
                        className="absolute inset-0 z-10 w-full appearance-none cursor-pointer bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(99,102,241,0.5)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:-mt-[5px]"
                      />
                    </div>
                    <button
                      onClick={() => setBossAge(a => Math.min(60, a + 1))}
                      className="w-6 h-6 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-xs font-bold shrink-0"
                    >+</button>
                  </div>
                </div>
              </div>

              {/* Avatar grid */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-[var(--muted)]">{t('setup.avatarStyle')}</label>
                  <button
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={refreshBossChoices}
                  >{t('setup.refreshBatch')}</button>
                </div>
                <AvatarGrid
                  choices={bossAvatarChoices}
                  selectedId={bossSelectedAvatar?.id}
                  onSelect={setBossSelectedAvatar}
                />
              </div>
            </div>

            <button
              className="btn-primary w-full"
              disabled={!companyName}
              onClick={() => setStep(2)}
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {/* Step 2: Secretary + Create */}
        {step === 2 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">{t('setup.step2Title')}</h2>
            <p className="text-sm text-[var(--muted)]">{t('setup.step2Desc')}</p>

            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <img
                  src={secretaryAvatar}
                  alt={t('chat.secretary')}
                  className="w-20 h-20 rounded-full bg-[var(--border)] border-2 border-[var(--accent)]/30"
                />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('setup.secretaryName')}</label>
                  <input
                    className="input w-full"
                    placeholder={t('setup.secretaryPlaceholder')}
                    value={secretaryName}
                    onChange={(e) => {
                      setSecretaryName(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Gender & Age */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1.5 text-[var(--muted)]">{t('setup.gender')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setSecretaryGender('female'); setSelectedAvatar(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm transition-all ${
                      secretaryGender === 'female'
                        ? 'border-pink-400 bg-pink-400/10 text-pink-300'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                    }`}
                  >{t('setup.female')}</button>
                  <button
                    onClick={() => { setSecretaryGender('male'); setSelectedAvatar(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm transition-all ${
                      secretaryGender === 'male'
                        ? 'border-blue-400 bg-blue-400/10 text-blue-300'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                    }`}
                  >{t('setup.male')}</button>
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1.5 text-[var(--muted)]">{t('setup.age', { n: secretaryAge })}</label>
                <div className="relative flex items-center gap-3">
                  <button
                    onClick={() => setSecretaryAge(a => Math.max(18, a - 1))}
                    className="w-7 h-7 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-sm font-bold shrink-0"
                  >−</button>
                  <div className="flex-1 relative h-5 flex items-center">
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[var(--border)] pointer-events-none" />
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-purple-400 pointer-events-none"
                      style={{ width: `${((secretaryAge - 18) / 42) * 100}%` }}
                    />
                    <input
                      type="range"
                      min="18"
                      max="60"
                      value={secretaryAge}
                      onChange={e => { setSecretaryAge(Number(e.target.value)); setSelectedAvatar(null); }}
                      className="absolute inset-0 z-10 w-full appearance-none cursor-pointer bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(99,102,241,0.5)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:-mt-[5px]"
                    />
                  </div>
                  <button
                    onClick={() => setSecretaryAge(a => Math.min(60, a + 1))}
                    className="w-7 h-7 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-sm font-bold shrink-0"
                  >+</button>
                </div>
                <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1 px-10">
                  <span>18</span><span>30</span><span>45</span><span>60</span>
                </div>
              </div>
            </div>

            {/* Avatar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[var(--muted)]">{t('setup.avatarStyle')}</label>
                <button
                  className="text-xs text-[var(--accent)] hover:underline"
                  onClick={refreshChoices}
                >{t('setup.refreshBatch')}</button>
              </div>
              <AvatarGrid
                choices={avatarChoices}
                selectedId={selectedAvatar?.id}
                onSelect={setSelectedAvatar}
              />
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setStep(1)}>
                {t('common.prev')}
              </button>
              <button
                className="btn-primary flex-1"
                disabled={loading}
                onClick={handleCreate}
              >
                {loading ? t('setup.creating') : t('setup.createBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex justify-center mt-6 gap-2">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-all ${
                step === s ? 'bg-[var(--accent)] w-6' : 'bg-[var(--border)]'
              }`}
            />
          ))}
        </div>

        <div className="text-center mt-4 text-xs text-[var(--muted)]">
          {t('setup.footer')}
        </div>
      </div>
    </div>
  );
}
