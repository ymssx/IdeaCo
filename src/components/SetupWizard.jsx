'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarChoices } from '@/lib/avatar';
import { useI18n, LanguageSelector, LANGUAGES } from '@/lib/i18n';
import { ModelProviders, JobCategory } from '@/core/providers';
import AvatarGrid from './AvatarGrid';

// Extract GENERAL models from brain providers
const AVAILABLE_MODELS = Object.values(ModelProviders)
  .filter(m => m.category === JobCategory.GENERAL)
  .map(m => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    rating: m.rating || 0,
    price: m.priceLabel || '',
    priceLevel: m.priceLevel || 2,
  }));

const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];

const AVATAR_CHOICES_COUNT = 16;

export default function SetupWizard() {
  const { createCompany, loading, fetchCLIBackends, detectCLIBackends } = useStore();
  const { t, lang } = useI18n();
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState(t('setup.defaultCompany'));
  const [bossName, setBossName] = useState('');
  const [selectedModel, setSelectedModel] = useState('deepseek-v3');
  const [apiKey, setApiKey] = useState('');
  const [cliBackends, setCliBackends] = useState([]);
  const [cliDetecting, setCliDetecting] = useState(false);
  const [cliDetected, setCliDetected] = useState(false);
  const [secretaryName, setSecretaryName] = useState(t('setup.defaultSecretary'));

  // Track previous language to auto-update defaults on language switch
  const prevLangRef = useRef(lang);
  const prevDefaultCompanyRef = useRef(t('setup.defaultCompany'));
  const prevDefaultSecretaryRef = useRef(t('setup.defaultSecretary'));
  useEffect(() => {
    if (prevLangRef.current !== lang) {
      // If company name is still the old default, update to new language default
      if (companyName === prevDefaultCompanyRef.current) {
        setCompanyName(t('setup.defaultCompany'));
      }
      // If secretary name is still the old default, update to new language default
      if (secretaryName === prevDefaultSecretaryRef.current) {
        setSecretaryName(t('setup.defaultSecretary'));
      }
      prevLangRef.current = lang;
      prevDefaultCompanyRef.current = t('setup.defaultCompany');
      prevDefaultSecretaryRef.current = t('setup.defaultSecretary');
    }
  }, [lang, t, companyName, secretaryName]);
  // Secretary gender and age (default: 18-year-old female)
  const [secretaryGender, setSecretaryGender] = useState('female');
  const [secretaryAge, setSecretaryAge] = useState(18);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [avatarChoices, setAvatarChoices] = useState([]);

  // Regenerate avatar choices when gender/age changes (debounced)
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

  // Shuffle avatar choices
  const refreshChoices = () => {
    const choices = getAvatarChoices(AVATAR_CHOICES_COUNT, secretaryGender, secretaryAge);
    setAvatarChoices(choices);
  };

  // Detect CLI backends when entering step 3
  useEffect(() => {
    if (step !== 3 || cliDetected) return;
    (async () => {
      setCliDetecting(true);
      try {
        await detectCLIBackends();
        const backends = await fetchCLIBackends();
        setCliBackends(backends || []);
        // Auto-select the first available CLI backend
        const available = (backends || []).find(b => b.status === 'detected');
        if (available) {
          setSelectedModel(`cli-${available.id}`);
        }
      } catch { /* ignore */ }
      setCliDetecting(false);
      setCliDetected(true);
    })();
  }, [step, cliDetected, detectCLIBackends, fetchCLIBackends]);

  const handleCreate = async () => {
    try {
      await createCompany(companyName, bossName, {
        providerId: selectedModel,
        apiKey: apiKey,
        secretaryName: secretaryName || t('setup.defaultSecretary'),
        secretaryAvatar: secretaryAvatar,
        secretaryGender,
        secretaryAge,
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
          {/* 语言选择器 */}
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

            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('setup.bossTitle')}</label>
              <input
                className="input w-full"
                placeholder={t('setup.bossPlaceholder')}
                value={bossName}
                onChange={(e) => setBossName(e.target.value)}
              />
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

        {/* Step 2 */}
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

            {/* 性别 & 年龄 */}
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
                    {/* 底色轨道 */}
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[var(--border)] pointer-events-none" />
                    {/* 渐变进度条 */}
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-purple-400 pointer-events-none"
                      style={{ width: `${((secretaryAge - 18) / 42) * 100}%` }}
                    />
                    {/* 滑块 input（轨道透明，只保留 thumb） */}
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

            {/* 头像选择 */}
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
              <button className="btn-primary flex-1" onClick={() => setStep(3)}>
                {t('common.next')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">{t('setup.step3Title')}</h2>
            <p className="text-sm text-[var(--muted)]">{t('setup.step3Desc')}</p>

            {/* CLI Agent Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-emerald-400">🖥️ {t('setup.cliAgentLocal')}</label>
                {cliDetecting && <span className="text-[10px] text-[var(--muted)] animate-pulse">{t('systemSettings.cliBackends.detecting')}</span>}
              </div>
              {cliBackends.length > 0 ? (
                cliBackends.map((cli) => {
                  const isAvailable = cli.status === 'detected';
                  const cliModelId = `cli-${cli.id}`;
                  return (
                    <label
                      key={cli.id}
                      className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                        !isAvailable ? 'opacity-40 cursor-not-allowed' :
                        selectedModel === cliModelId
                          ? 'border-emerald-400 bg-emerald-400/10'
                          : 'border-[var(--border)] hover:border-emerald-400/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name="model"
                        value={cliModelId}
                        checked={selectedModel === cliModelId}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={!isAvailable}
                        className="mr-3"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{cli.name || cli.id}</span>
                          {isAvailable ? (
                            <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-1.5 py-0.5 rounded">✓ {t('setup.cliAvailable')}</span>
                          ) : (
                            <span className="text-[10px] bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{t('setup.cliNotFound')}</span>
                          )}
                          {cli.rating && (
                            <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">
                              ⭐ {cli.rating}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-[var(--muted)]">{t('setup.localCli')}</span>
                          <span className="text-xs text-green-400">{t('setup.freeLocal')}</span>
                        </div>
                      </div>
                    </label>
                  );
                })
              ) : !cliDetecting ? (
                <p className="text-xs text-[var(--muted)] px-1">{t('providers.noCliDetected')}</p>
              ) : null}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span>{t('providers.cloudApiModels')}</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>

            <div className="space-y-2">
              {AVAILABLE_MODELS.map((model) => (
                <label
                  key={model.id}
                  className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedModel === model.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] hover:border-[var(--border)]/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={model.id}
                    checked={selectedModel === model.id}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="mr-3"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">
                        ⭐ {model.rating}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-[var(--muted)]">{model.provider}</span>
                      <span className={`text-xs ${PRICE_COLORS[model.priceLevel - 1]}`}>
                        {model.price}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        {t('setup.priceLabels')[model.priceLevel - 1]}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {!selectedModel?.startsWith('cli-') && (
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('setup.apiKeyLabel')}</label>
              <input
                type="password"
                className="input w-full"
                placeholder={t('setup.apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-[var(--muted)] mt-1">{t('setup.apiKeyHint')}</p>
            </div>
            )}

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setStep(2)}>
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
          {[1, 2, 3].map((s) => (
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
