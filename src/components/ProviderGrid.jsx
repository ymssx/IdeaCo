'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import TalentMarket from './TalentMarket';

const CATEGORY_ICONS = { general: '💬', drawing: '🎨', music: '🎵', video: '🎬', cli: '🖥️', browser: '🌐' };
const CATEGORY_ORDER = { cli: 0, browser: 1, general: 2, drawing: 3, music: 4, video: 5 };
const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];
const PRICE_DOTS = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];
const RATING_COLORS = { high: 'text-green-400', mid: 'text-yellow-400', low: 'text-orange-400' };

function RatingBadge({ rating }) {
  const color = rating >= 90 ? RATING_COLORS.high : rating >= 80 ? RATING_COLORS.mid : RATING_COLORS.low;
  return <span className={`text-xs font-bold ${color}`}>⭐ {rating}</span>;
}

/**
 * Shared provider grid with all config modals.
 * Used by both ProvidersBoard and SystemMonitor.
 *
 * @param {object} props
 * @param {boolean} [props.showHeader] - show title + subtitle
 * @param {boolean} [props.showDescription] - show hint card + talent market
 * @param {boolean} [props.showSecretary] - show secretary provider card
 * @param {boolean} [props.showStatusDot] - show green/red dot per category header
 * @param {function} [props.onCLIDetected] - callback after CLI detect/register (for local state refresh)
 */
export default function ProviderGrid({
  showHeader = false,
  showDescription = true,
  showSecretary = true,
  showStatusDot = false,
  onCLIDetected,
}) {
  const { t } = useI18n();
  const { company, configureProvider, fetchCLIBackends, detectCLIBackends, manageCLIBackend, updateSecretarySettings } = useStore();

  // CLI management state
  const [cliDetecting, setCLIDetecting] = useState(false);
  const [showRegisterCLI, setShowRegisterCLI] = useState(false);
  const [newCLI, setNewCLI] = useState({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });

  // API Key config state
  const [configTarget, setConfigTarget] = useState(null);
  const [apiKey, setApiKey] = useState('');

  // Custom OpenAI config state
  const [customOpenAITarget, setCustomOpenAITarget] = useState(null);
  const [customBaseURL, setCustomBaseURL] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');

  // Web agent config state
  const [webConfigTarget, setWebConfigTarget] = useState(null);
  const [cookieValue, setCookieValue] = useState('');
  const [cookieTestResult, setCookieTestResult] = useState(null);
  const [cookieTesting, setCookieTesting] = useState(false);
  const [cookieLogging, setCookieLogging] = useState(false);
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  // Selector calibration state
  const [calibrating, setCalibrating] = useState(false);
  const [selectorStatus, setSelectorStatus] = useState(null);

  // Secretary state
  const [showSecretaryPicker, setShowSecretaryPicker] = useState(false);
  const [secretaryProviderId, setSecretaryProviderId] = useState(company?.secretary?.providerId || '');
  const [savingSecretary, setSavingSecretary] = useState(false);

  // Talent Market
  const [showTalentMarket, setShowTalentMarket] = useState(false);

  const categoryLabels = {
    general: t('providers.categories.general'),
    drawing: t('providers.categories.drawing'),
    music: t('providers.categories.music'),
    video: t('providers.categories.video'),
    cli: t('providers.categories.cli'),
    browser: t('providers.categories.browser'),
  };

  if (!company) return null;

  const dashboard = company.providerDashboard || {};

  const handleConfigure = async () => {
    if (!configTarget || !apiKey) return;
    try {
      await configureProvider(configTarget.id, apiKey);
      setConfigTarget(null);
      setApiKey('');
    } catch (e) { /* handled */ }
  };

  const handleCLIDetect = async () => {
    setCLIDetecting(true);
    await detectCLIBackends();
    const updated = await fetchCLIBackends();
    onCLIDetected?.(updated);
    setCLIDetecting(false);
  };

  const handleCLIRegister = async () => {
    if (!newCLI.id || !newCLI.execCommand) return;
    const config = {
      ...newCLI,
      execArgs: newCLI.execArgs.split(',').map(s => s.trim()),
      detectCommand: newCLI.detectCommand || `${newCLI.execCommand} --version`,
      memoryDir: newCLI.memoryDir || `.${newCLI.id}`,
      nvmNode: newCLI.nvmNode || null,
    };
    const updated = await manageCLIBackend('register', { config });
    onCLIDetected?.(updated);
    setShowRegisterCLI(false);
    setNewCLI({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });
  };

  return (
    <>
      {showHeader && (
        <div>
          <h1 className="text-2xl font-bold">{t('providers.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t('providers.subtitle')}</p>
        </div>
      )}

      {/* Description card */}
      {showDescription && (
        <div className="card bg-gradient-to-r from-blue-900/10 to-purple-900/10 border-blue-500/20">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💡</span>
            <div className="text-sm text-[var(--muted)] flex-1">
              <p className="font-medium text-[var(--foreground)] mb-1">{t('providers.hint.title')}</p>
              <p dangerouslySetInnerHTML={{ __html: t('providers.hint.desc') }} />
            </div>
            <button
              onClick={() => setShowTalentMarket(true)}
              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-900/20 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-900/30 transition-all text-sm"
            >
              <span>🏪</span>
              <span>{t('providers.talentMarket.btn')}</span>
              {(company?.talentMarket?.length || 0) > 0 && (
                <span className="text-xs bg-yellow-500/20 px-1.5 py-0.5 rounded-full">{company.talentMarket.length}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Secretary provider card */}
      {showSecretary && (
        <div className="card bg-gradient-to-r from-purple-900/10 to-blue-900/10 border-purple-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <h3 className="font-semibold">{t('providers.secretaryProvider.title')}</h3>
                <p className="text-xs text-[var(--muted)] mt-0.5 max-w-md">{t('providers.secretaryProvider.desc')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-sm font-medium">
                  {company?.secretary?.provider && company?.secretary?.providerId !== 'none'
                    ? <span className="text-green-400">{t('providers.secretaryProvider.current', { name: company.secretary.provider })}</span>
                    : <span className="text-yellow-400">{t('providers.secretaryProvider.noneConfigured')}</span>
                  }
                </div>
              </div>
              <button
                onClick={() => {
                  const avail = company?.secretary?.availableProviders || [];
                  const currentId = company?.secretary?.providerId || '';
                  const inList = avail.some(p => p.id === currentId);
                  setSecretaryProviderId(inList ? currentId : (avail[0]?.id || ''));
                  setShowSecretaryPicker(true);
                }}
                className="px-3 py-2 rounded-lg text-xs bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-all"
              >
                {t('providers.secretaryProvider.changeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secretary provider picker modal */}
      {showSecretaryPicker && company?.secretary?.availableProviders && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setShowSecretaryPicker(false)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('secretarySettings.providerLabel')}</h3>
            <p className="text-xs text-[var(--muted)]">{t('secretarySettings.providerDesc')}</p>
            {company.secretary?.availableProviders?.length > 0 ? (
              <select
                className="input w-full"
                value={secretaryProviderId}
                onChange={e => setSecretaryProviderId(e.target.value)}
              >
                {company.secretary.availableProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-yellow-400 p-2 rounded bg-yellow-400/10 border border-yellow-400/20">
                {t('secretarySettings.noProviders')}
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setShowSecretaryPicker(false)}>{t('common.cancel')}</button>
              <button
                className="btn-primary flex-1"
                disabled={!secretaryProviderId || savingSecretary}
                onClick={async () => {
                  setSavingSecretary(true);
                  try {
                    await updateSecretarySettings({ providerId: secretaryProviderId });
                    setShowSecretaryPicker(false);
                  } catch {}
                  setSavingSecretary(false);
                }}
              >
                {savingSecretary ? t('secretarySettings.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category grids */}
      {Object.entries(dashboard)
        .sort(([a], [b]) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99))
        .map(([category, info]) => (
        <div key={category} className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{CATEGORY_ICONS[category]}</span>
              <div>
                <h3 className="font-semibold">{categoryLabels[category] || category}</h3>
                <div className="text-xs text-[var(--muted)]">
                  {t('providers.enabled', { n: info.enabled, total: info.total })}
                </div>
              </div>
            </div>
            {showStatusDot && (
              <div className={`w-3 h-3 rounded-full ${info.enabled > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
            )}
            {category === 'cli' && (
              <div className="flex gap-2 ml-auto mr-3">
                <button
                  onClick={handleCLIDetect}
                  disabled={cliDetecting}
                  className="px-2.5 py-1 rounded text-[10px] bg-[var(--accent)] text-white hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {cliDetecting ? t('systemSettings.cliBackends.detecting') : `🔍 ${t('systemSettings.cliBackends.detectAll')}`}
                </button>
                <button
                  onClick={() => setShowRegisterCLI(!showRegisterCLI)}
                  className="px-2.5 py-1 rounded text-[10px] bg-white/10 text-[var(--muted)] hover:bg-white/20 transition-all"
                >
                  + {t('systemSettings.cliBackends.registerCustom')}
                </button>
              </div>
            )}
          </div>

          {/* CLI category: register custom CLI form */}
          {category === 'cli' && showRegisterCLI && (
            <div className="p-4 rounded-lg bg-white/5 border border-[var(--border)] mb-4 space-y-3 animate-fade-in">
              <h4 className="text-xs font-semibold">{t('systemSettings.cliBackends.registerCustom')}</h4>
              <div className="grid grid-cols-2 gap-3">
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.id')} value={newCLI.id} onChange={e => setNewCLI({...newCLI, id: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.name')} value={newCLI.name} onChange={e => setNewCLI({...newCLI, name: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.execCommand')} value={newCLI.execCommand} onChange={e => setNewCLI({...newCLI, execCommand: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.execArgs')} value={newCLI.execArgs} onChange={e => setNewCLI({...newCLI, execArgs: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.detectCommand')} value={newCLI.detectCommand} onChange={e => setNewCLI({...newCLI, detectCommand: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.memoryDir')} value={newCLI.memoryDir} onChange={e => setNewCLI({...newCLI, memoryDir: e.target.value})} />
                <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.memoryFile')} value={newCLI.memoryFile} onChange={e => setNewCLI({...newCLI, memoryFile: e.target.value})} />
                <div>
                  <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.nvmNode')} value={newCLI.nvmNode} onChange={e => setNewCLI({...newCLI, nvmNode: e.target.value})} />
                  <p className="text-[10px] text-[var(--muted)] mt-0.5">{t('systemSettings.cliBackends.form.nvmNodeHint')}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowRegisterCLI(false)} className="px-3 py-1 text-xs text-[var(--muted)] hover:text-white transition-all">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCLIRegister}
                  disabled={!newCLI.id || !newCLI.execCommand}
                  className="px-3 py-1 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {t('systemSettings.cliBackends.registerCustom')}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {info.providers.map((p) => (
              <div
                key={p.id}
                className={`p-3 rounded-lg border transition-all ${
                  p.enabled
                    ? 'border-green-500/30 bg-green-900/10'
                    : 'border-[var(--border)] bg-[var(--background)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.cliIcon && <span className="text-sm">{p.cliIcon}</span>}
                    <span className={`status-dot ${p.enabled ? 'active' : 'idle'}`} />
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  </div>
                  {p.isCLI ? (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-green-900/30 hover:text-green-400'
                      }`}
                      onClick={async () => {
                        await configureProvider(p.id, p.enabled ? '' : 'cli-local');
                      }}
                    >
                      {p.enabled ? t('common.disable') : t('common.enable')}
                    </button>
                  ) : p.isCustomOpenAI ? (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                      }`}
                      onClick={() => { setCustomOpenAITarget(p); setCustomBaseURL(p.baseURL || ''); setCustomApiKey(''); }}
                    >
                      {p.enabled ? t('common.manage') : t('common.configure')}
                    </button>
                  ) : p.isWeb ? (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                          : 'bg-cyan-900/20 text-cyan-400 hover:bg-cyan-900/30'
                      }`}
                      onClick={async () => {
                        setWebConfigTarget(p); setCookieValue(''); setCookieTestResult(null);
                        if (isElectron && window.electronAPI.getSelectorStatus) {
                          try { setSelectorStatus(await window.electronAPI.getSelectorStatus()); } catch {}
                        }
                      }}
                    >
                      {p.enabled ? t('common.manage') : '🌐 Login'}
                    </button>
                  ) : (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                      }`}
                      onClick={() => { setConfigTarget(p); setApiKey(''); }}
                    >
                      {p.enabled ? t('common.manage') : t('common.configure')}
                    </button>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)] mb-2">
                  {p.provider}
                  {p.cliVersion && <span className="ml-2 text-[10px] opacity-60">v{p.cliVersion}</span>}
                  {p.cliState && p.cliState !== 'detected' && (
                    <span className="ml-2 text-[10px] text-yellow-400">({t(`systemSettings.cliBackends.status.${p.cliState}`)})</span>
                  )}
                  {p.isCustomOpenAI && p.baseURL && (
                    <div className="text-[10px] text-cyan-400/70 mt-0.5 truncate" title={p.baseURL}>🔗 {p.baseURL}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <RatingBadge rating={p.rating} />
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${PRICE_DOTS[(p.priceLevel || 1) - 1]}`} />
                    <span className={`text-xs ${PRICE_COLORS[(p.priceLevel || 1) - 1]}`}>
                      {p.priceLabel || t('providers.unknown')}
                    </span>
                  </div>
                </div>
                {p.capabilities && (
                  <div className="flex gap-1 flex-wrap">
                    {p.capabilities.slice(0, 4).map((c, i) => (
                      <span key={i} className="text-[9px] bg-white/5 text-[var(--muted)] px-1.5 py-0.5 rounded">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* API Key config modal */}
      {configTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setConfigTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('providers.configure.title', { name: configTarget.name })}</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">{t('providers.configure.provider', { name: configTarget.provider })}</span>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400">⭐ {configTarget.rating}</span>
                <span className={`${PRICE_COLORS[(configTarget.priceLevel || 1) - 1]}`}>
                  {configTarget.priceLabel}
                </span>
              </div>
            </div>
            {configTarget.description && (
              <p className="text-xs text-[var(--muted)]">{configTarget.description}</p>
            )}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('providers.apiKeyLabel')}</label>
              <input
                type="password"
                className="input w-full"
                placeholder={t('providers.configure.apiKeyPlaceholder')}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfigTarget(null)}>{t('common.cancel')}</button>
              {configTarget.enabled && (
                <button
                  className="btn-danger flex-1"
                  onClick={async () => { await configureProvider(configTarget.id, ''); setConfigTarget(null); }}
                >
                  {t('common.disable')}
                </button>
              )}
              <button className="btn-primary flex-1" disabled={!apiKey} onClick={handleConfigure}>
                {configTarget.enabled ? t('common.update') : t('common.enable')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Web Agent config modal */}
      {webConfigTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setWebConfigTarget(null)}>
          <div className="card max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('providers.webConfigure.title', { name: webConfigTarget.name })}</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">{t('providers.configure.provider', { name: webConfigTarget.provider })}</span>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400">⭐ {webConfigTarget.rating}</span>
                <span className="text-green-400">{webConfigTarget.priceLabel}</span>
              </div>
            </div>
            {webConfigTarget.description && (
              <p className="text-xs text-[var(--muted)]">{webConfigTarget.description}</p>
            )}
            {/* One-click login button */}
            <button
              className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-gradient-to-r from-green-900/30 to-cyan-900/30 border border-green-500/30 text-green-400 hover:from-green-900/50 hover:to-cyan-900/50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={cookieLogging}
              onClick={async () => {
                if (!isElectron) {
                  setCookieTestResult({ ok: false, error: t('providers.webConfigure.desktopOnly') });
                  return;
                }
                setCookieLogging(true);
                setCookieTestResult(null);
                try {
                  const result = await window.electronAPI.loginChatGPT();
                  if (result.ok && result.cookie) {
                    setCookieValue(result.cookie);
                    await configureProvider(webConfigTarget.id, result.cookie);
                    setWebConfigTarget(null);
                  } else {
                    setCookieTestResult({ ok: false, error: result.error || 'Login cancelled' });
                  }
                } catch (e) {
                  setCookieTestResult({ ok: false, error: e.message });
                }
                setCookieLogging(false);
              }}
            >
              {cookieLogging ? (
                <>{t('providers.webConfigure.loggingIn')}</>
              ) : (
                <>🚀 {t('providers.webConfigure.autoLoginBtn')}</>
              )}
            </button>
            <p className="text-[10px] text-[var(--muted)]">{t('providers.webConfigure.loginHint')}</p>
            {/* Selector Calibration */}
            {isElectron && (
              <div className="p-3 rounded-lg bg-white/5 border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-medium">{t('providers.webConfigure.calibrate.title')}</h4>
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">{t('providers.webConfigure.calibrate.desc')}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="px-3 py-1.5 rounded-lg text-xs bg-purple-900/30 border border-purple-500/30 text-purple-400 hover:bg-purple-900/50 transition-all disabled:opacity-50"
                      disabled={calibrating}
                      onClick={async () => {
                        setCalibrating(true);
                        try {
                          const result = await window.electronAPI.calibrateSelectors();
                          if (result.ok) {
                            setSelectorStatus({ recorded: result.selectors, timestamp: new Date().toISOString() });
                          }
                        } catch {}
                        setCalibrating(false);
                      }}
                    >
                      {calibrating ? t('providers.webConfigure.calibrate.running') : t('providers.webConfigure.calibrate.btn')}
                    </button>
                    {selectorStatus?.recorded && Object.keys(selectorStatus.recorded).length > 0 && (
                      <button
                        className="px-2 py-1.5 rounded-lg text-[10px] bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-all"
                        onClick={async () => {
                          await window.electronAPI.resetSelectors();
                          setSelectorStatus(null);
                        }}
                      >
                        {t('providers.webConfigure.calibrate.reset')}
                      </button>
                    )}
                  </div>
                </div>
                {selectorStatus?.recorded && Object.keys(selectorStatus.recorded).length > 0 && (
                  <div className="text-[10px] space-y-1 p-2 rounded bg-green-900/10 border border-green-500/20">
                    <div className="text-green-400 font-medium">{t('providers.webConfigure.calibrate.recorded')}</div>
                    {Object.entries(selectorStatus.recorded).map(([role, sel]) => (
                      <div key={role} className="flex gap-2 text-[var(--muted)]">
                        <span className="text-green-400 w-16 shrink-0">{role}:</span>
                        <code className="truncate opacity-70">{sel}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {cookieTestResult && (
              <div className={`text-xs p-2 rounded ${cookieTestResult.ok ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
                {cookieTestResult.ok ? t('providers.webConfigure.testSuccess') : t('providers.webConfigure.testFailed', { error: cookieTestResult.error })}
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setWebConfigTarget(null)}>{t('common.cancel')}</button>
              {webConfigTarget.enabled && (
                <button
                  className="btn-danger flex-1"
                  onClick={async () => { await configureProvider(webConfigTarget.id, ''); setWebConfigTarget(null); }}
                >
                  {t('common.disable')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom OpenAI config modal */}
      {customOpenAITarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setCustomOpenAITarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('providers.configure.title', { name: customOpenAITarget.name })}</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">{t('providers.configure.provider', { name: customOpenAITarget.provider })}</span>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400">⭐ {customOpenAITarget.rating}</span>
                <span className={`${PRICE_COLORS[(customOpenAITarget.priceLevel || 1) - 1]}`}>
                  {customOpenAITarget.priceLabel}
                </span>
              </div>
            </div>
            {customOpenAITarget.description && (
              <p className="text-xs text-[var(--muted)]">{customOpenAITarget.description}</p>
            )}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('providers.customOpenAI.baseURLLabel')}</label>
              <input
                type="text"
                className="input w-full"
                placeholder={t('providers.customOpenAI.baseURLPlaceholder')}
                value={customBaseURL}
                onChange={e => setCustomBaseURL(e.target.value)}
              />
              <p className="text-[10px] text-[var(--muted)] mt-1">{t('providers.customOpenAI.baseURLHint')}</p>
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('providers.customOpenAI.apiKeyLabel')}</label>
              <input
                type="password"
                className="input w-full"
                placeholder={t('providers.customOpenAI.apiKeyPlaceholder')}
                value={customApiKey}
                onChange={e => setCustomApiKey(e.target.value)}
              />
              <p className="text-[10px] text-[var(--muted)] mt-1">{t('providers.customOpenAI.apiKeyHint')}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setCustomOpenAITarget(null)}>{t('common.cancel')}</button>
              {customOpenAITarget.enabled && (
                <button
                  className="btn-danger flex-1"
                  onClick={async () => { await configureProvider(customOpenAITarget.id, '', { baseURL: '' }); setCustomOpenAITarget(null); }}
                >
                  {t('common.disable')}
                </button>
              )}
              <button
                className="btn-primary flex-1"
                disabled={!customBaseURL}
                onClick={async () => {
                  try {
                    await configureProvider(customOpenAITarget.id, customApiKey, { baseURL: customBaseURL });
                    setCustomOpenAITarget(null);
                    setCustomBaseURL('');
                    setCustomApiKey('');
                  } catch (e) { /* handled */ }
                }}
              >
                {customOpenAITarget.enabled ? t('common.update') : t('common.enable')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Talent Market modal */}
      {showTalentMarket && (
        <TalentMarket asModal onClose={() => setShowTalentMarket(false)} />
      )}
    </>
  );
}
