'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n';
import ProvidersBoard from './ProvidersBoard';
import SecretaryChatView from './SecretaryChatView';
import AgentDetailModal from './AgentDetailModal';

export default function ChatPanel() {
  const {
    company,
    chatOpen, setChatOpen,
    chatPanelWidth, setChatPanelWidth,
  } = useStore();
  const { t } = useI18n();
  const [showProviders, setShowProviders] = useState(false);
  const [showSecretaryDetail, setShowSecretaryDetail] = useState(false);
  const panelRef = useRef(null);
  const isResizingRef = useRef(false);

  // Check if any provider is enabled across all categories
  const hasAnyProvider = useMemo(() => {
    const dashboard = company?.providerDashboard;
    if (!dashboard) return false;
    return Object.values(dashboard).some(cat => cat.enabled > 0);
  }, [company?.providerDashboard]);

  // Drag-to-resize logic
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = chatPanelWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startX;
      setChatPanelWidth(startWidth + delta);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [chatPanelWidth, setChatPanelWidth]);

  if (!company || !chatOpen) return null;

  const secretary = company.secretary;

  return (
    <div
      ref={panelRef}
      className="h-screen bg-[var(--card)] border-r border-[var(--border)] flex flex-col shrink-0 relative"
      style={{ width: chatPanelWidth }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-gradient-to-r from-blue-900/30 to-purple-900/30 shrink-0"
        style={{ paddingTop: 'calc(0.75rem + var(--titlebar-height))' }}
      >
        <img
          src={secretary?.avatar || getAvatarUrl('secretary')}
          alt={t('chat.secretary')}
          className="w-10 h-10 rounded-full bg-[var(--border)] cursor-pointer hover:ring-2 hover:ring-purple-500/50 transition-all"
          onClick={() => secretary?.id && setShowSecretaryDetail(true)}
          title={t('reqDetail.members.viewProfile')}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            {secretary?.name || t('setup.defaultSecretary')}
            <span className="w-2 h-2 bg-green-500 rounded-full" />
          </div>
          {secretary?.signature ? (
            <div className="text-[10px] text-[var(--muted)] italic truncate" title={secretary.signature}>"{secretary.signature}"</div>
          ) : (
            <div className="text-[10px] text-[var(--muted)]">{t('chat.online')}</div>
          )}
        </div>
        <button
          onClick={() => setChatOpen(false)}
          className="text-[var(--muted)] hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
          title={t('common.close')}
        >
          ✕
        </button>
      </div>

      {/* No provider configured — block chat and show setup prompt */}
      {!hasAnyProvider ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="text-5xl mb-4">🧠</div>
          <h3 className="text-base font-semibold text-yellow-400 mb-2">{t('chat.noProviderTitle')}</h3>
          <p className="text-xs text-[var(--muted)] mb-5 max-w-xs leading-relaxed">{t('chat.noProviderDesc')}</p>
          <button
            onClick={() => setShowProviders(true)}
            className="px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-all"
          >
            {t('chat.noProviderBtn')}
          </button>

          {/* Inline ProvidersBoard modal */}
          {showProviders && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80] !m-0" onClick={() => setShowProviders(false)}>
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-end p-3 pb-0">
                  <button onClick={() => setShowProviders(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
                </div>
                <ProvidersBoard />
              </div>
            </div>
          )}
        </div>
      ) : (
        <SecretaryChatView
          active={chatOpen}
        />
      )}

      {/* Resize handle on the right edge */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent)]/40 active:bg-[var(--accent)]/60 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />

      {/* Secretary detail modal */}
      {showSecretaryDetail && secretary?.id && (
        <AgentDetailModal agentId={secretary.id} onClose={() => setShowSecretaryDetail(false)} />
      )}
    </div>
  );
}
