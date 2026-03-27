'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import { useI18n, LanguageSelector } from '@/lib/i18n';
import BossProfileModal from './BossProfileModal';
import AgentDetailModal from './AgentDetailModal';
import CachedAvatar from './CachedAvatar';

export default function Sidebar() {
  const { company, activeTab, setActiveTab, setChatOpen, chatOpen } = useStore();
  const { t } = useI18n();
  const [showBossProfile, setShowBossProfile] = useState(false);
  const [showSecretaryDetail, setShowSecretaryDetail] = useState(false);

  if (!company) return null;

  const NAV_ITEMS = [
    { id: 'requirements', label: t('sidebar.nav.requirements'), icon: '📋' },
    { id: 'mailbox', label: t('sidebar.nav.mailbox'), icon: '💬' },
    { id: 'departments', label: t('sidebar.nav.departments'), icon: '🏢' },
    { id: 'office', label: t('sidebar.nav.office'), icon: '🎮' },
    { id: 'overview', label: t('sidebar.nav.overview'), icon: '📊' },
  ];

  const deptCount = company.departments?.length || 0;
  const agentCount = company.departments?.reduce((s, d) => s + d.members.length, 0) || 0;
  const reqCount = company.requirements?.length || 0;
  const budget = company.budget || {};
  const chatSessionCount = company.agentChatSessions?.length || 0;

  return (
    <aside className="w-64 bg-[#0d0d0d] border-r border-[var(--border)] flex flex-col h-screen">
      {/* Company name - top left */}
      <div className="p-4 border-b border-[var(--border)]" style={{ paddingTop: 'calc(1rem + var(--titlebar-height))' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowBossProfile(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 transition-all hover:scale-105 hover:ring-2 hover:ring-[var(--accent)]/40 overflow-hidden"
            title={t('bossProfile.editAvatar')}
          >
            {company.bossAvatar ? (
              <CachedAvatar src={company.bossAvatar} alt="boss" className="w-10 h-10 rounded-lg" />
            ) : (
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-lg font-bold">
                {company.name.charAt(0)}
              </div>
            )}
          </button>
          <div>
            <div className="font-semibold text-sm truncate">{company.name}</div>
            <div className="text-xs text-[var(--muted)]">👤 {company.boss}</div>
          </div>
        </div>
      </div>

      {/* Secretary info - clickable to open chat */}
      <div className="mx-3 mt-3 rounded-lg bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/20">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={`w-full p-3 hover:bg-white/5 transition-all text-left rounded-lg ${chatOpen ? 'bg-white/5' : ''}`}
        >
          <div className="flex items-center gap-2">
            <img
              src={company.secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-8 h-8 rounded-full bg-[var(--card)] cursor-pointer hover:ring-2 hover:ring-purple-500/50 transition-all"
              onClick={(e) => {
                e.stopPropagation();
                if (company.secretary?.id) setShowSecretaryDetail(true);
              }}
              title={t('reqDetail.members.viewProfile')}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium flex items-center gap-1">
                {company.secretary?.name || t('setup.defaultSecretary')}
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />
              </div>
              <div className="text-[10px] text-[var(--muted)] truncate">
                {t('sidebar.clickToChat', { provider: company.secretary?.provider })}
              </div>
            </div>
            <span className={`text-sm transition-transform duration-200 ${chatOpen ? 'text-[var(--accent)]' : ''}`}>
              {chatOpen ? '◀' : '💬'}
            </span>
          </div>
        </button>
      </div>

      {/* Budget overview */}
      <div className="px-3 mt-3">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-2.5">
          <div className="text-[10px] text-[var(--muted)] mb-1.5">{t('sidebar.budgetUsage')}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-green-400">${budget.totalCost?.toFixed(4) || '0.00'}</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-1">
            {t('sidebar.tokenLabel')}: {(budget.totalTokens || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Navigation menu */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          let badge = null;
          if (item.id === 'departments') badge = deptCount;
          if (item.id === 'requirements') badge = company.requirements?.length || 0;
      if (item.id === 'mailbox') badge = chatSessionCount;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive || (item.id === 'requirements' && activeTab === 'requirement-detail') || (item.id === 'departments' && activeTab === 'department-detail')
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/5'
              }`}
            >
              <span>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/10 text-[var(--muted)]'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom statistics */}
      <div className="p-4 border-t border-[var(--border)]">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-[var(--accent)]">{deptCount}</div>
            <div className="text-[10px] text-[var(--muted)]">{t('sidebar.stats.departments')}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-400">{agentCount}</div>
            <div className="text-[10px] text-[var(--muted)]">{t('sidebar.stats.workers')}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-400">{reqCount}</div>
            <div className="text-[10px] text-[var(--muted)]">{t('sidebar.stats.requirements')}</div>
          </div>
        </div>
        {/* Language switch */}
        <div className="mt-3 flex justify-center">
          <LanguageSelector />
        </div>
      </div>

      {showBossProfile && <BossProfileModal onClose={() => setShowBossProfile(false)} />}
      {showSecretaryDetail && company.secretary?.id && (
        <AgentDetailModal agentId={company.secretary.id} onClose={() => setShowSecretaryDetail(false)} />
      )}
    </aside>
  );
}
