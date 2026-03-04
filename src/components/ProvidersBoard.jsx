'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import TalentMarket from './TalentMarket';

const CATEGORY_ICONS = { general: '💬', drawing: '🎨', music: '🎵', video: '🎬' };
const CATEGORY_LABELS = { general: 'General', drawing: 'Drawing', music: 'Music', video: 'Video' };
const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];
const PRICE_DOTS = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];
const RATING_COLORS = { high: 'text-green-400', mid: 'text-yellow-400', low: 'text-orange-400' };

function RatingBadge({ rating }) {
  const color = rating >= 90 ? RATING_COLORS.high : rating >= 80 ? RATING_COLORS.mid : RATING_COLORS.low;
  return <span className={`text-xs font-bold ${color}`}>⭐ {rating}</span>;
}

export default function ProvidersBoard() {
  const { t } = useI18n();
  const { company, configureProvider } = useStore();

  const categoryLabels = {
    general: t('providers.categories.general'),
    drawing: t('providers.categories.drawing'),
    music: t('providers.categories.music'),
    video: t('providers.categories.video'),
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
                  {info.enabled}/{info.total} {t('providers.enabled', { n: info.enabled, total: info.total })}
                </div>
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${info.enabled > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>

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
                    <span className={`status-dot ${p.enabled ? 'active' : 'idle'}`} />
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  </div>
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
                </div>
                <div className="text-xs text-[var(--muted)] mb-2">{p.provider}</div>
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
              <label className="block text-sm mb-1 text-[var(--muted)]">API Key</label>
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
