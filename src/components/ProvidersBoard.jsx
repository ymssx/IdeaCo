'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import TalentMarket from './TalentMarket';

const CATEGORY_ICONS = { general: '💬', drawing: '🎨', music: '🎵', video: '🎬', cli: '🖥️' };
const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];
const PRICE_DOTS = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];
const RATING_COLORS = { high: 'text-green-400', mid: 'text-yellow-400', low: 'text-orange-400' };

function RatingBadge({ rating }) {
  const color = rating >= 90 ? RATING_COLORS.high : rating >= 80 ? RATING_COLORS.mid : RATING_COLORS.low;
  return <span className={`text-xs font-bold ${color}`}>⭐ {rating}</span>;
}

export default function ProvidersBoard() {
  const { t } = useI18n();
  const { company, configureProvider, fetchCLIBackends, detectCLIBackends, manageCLIBackend } = useStore();

  // CLI management state
  const [cliDetecting, setCLIDetecting] = useState(false);
  const [showRegisterCLI, setShowRegisterCLI] = useState(false);
  const [newCLI, setNewCLI] = useState({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });

  const categoryLabels = {
    general: t('providers.categories.general'),
    drawing: t('providers.categories.drawing'),
    music: t('providers.categories.music'),
    video: t('providers.categories.video'),
    cli: t('providers.categories.cli'),
  };
  const [configTarget, setConfigTarget] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showTalentMarket, setShowTalentMarket] = useState(false);

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

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">{t('providers.title')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          {t('providers.subtitle')}
        </p>
      </div>

      {/* Description card */}
      <div className="card bg-gradient-to-r from-blue-900/10 to-purple-900/10 border-blue-500/20">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div className="text-sm text-[var(--muted)] flex-1">
            <p className="font-medium text-[var(--foreground)] mb-1">{t('providers.hint.title')}</p>
            <p dangerouslySetInnerHTML={{ __html: t('providers.hint.desc') }} />
          </div>
          {/* Talent Market entrance */}
          <button
            onClick={() => setShowTalentMarket(true)}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-900/20 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-900/30 transition-all text-sm"
          >
            <span>🏪</span>
            <span>{t('providers.talentMarket.btn')}</span>
            {(company.talentMarket?.length || 0) > 0 && (
              <span className="text-xs bg-yellow-500/20 px-1.5 py-0.5 rounded-full">{company.talentMarket.length}</span>
            )}
          </button>
        </div>
      </div>

      {Object.entries(dashboard).map(([category, info]) => (
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
            <div className={`w-3 h-3 rounded-full ${info.enabled > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
            {/* CLI category: detect & register buttons */}
            {category === 'cli' && (
              <div className="flex gap-2 ml-auto mr-3">
                <button
                  onClick={async () => {
                    setCLIDetecting(true);
                    await detectCLIBackends();
                    await fetchCLIBackends();
                    setCLIDetecting(false);
                  }}
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
                  onClick={async () => {
                    if (!newCLI.id || !newCLI.execCommand) return;
                    const config = {
                      ...newCLI,
                      execArgs: newCLI.execArgs.split(',').map(s => s.trim()),
                      detectCommand: newCLI.detectCommand || `${newCLI.execCommand} --version`,
                      memoryDir: newCLI.memoryDir || `.${newCLI.id}`,
                      nvmNode: newCLI.nvmNode || null,
                    };
                    await manageCLIBackend('register', { config });
                    setShowRegisterCLI(false);
                    setNewCLI({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });
                  }}
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
                  {/* CLI providers use a toggle switch instead of configure button */}
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
                </div>
                {/* Rating + price */}
                <div className="flex items-center gap-3 mb-2">
                  <RatingBadge rating={p.rating} />
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${PRICE_DOTS[(p.priceLevel || 1) - 1]}`} />
                    <span className={`text-xs ${PRICE_COLORS[(p.priceLevel || 1) - 1]}`}>
                      {p.priceLabel || t('providers.unknown')}
                    </span>
                  </div>
                </div>
                {/* Capability tags */}
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

      {/* Config modal */}
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

      {/* Talent Market modal */}
      {showTalentMarket && (
        <TalentMarket asModal onClose={() => setShowTalentMarket(false)} />
      )}
    </div>
  );
}
