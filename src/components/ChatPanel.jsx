'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n';
import { MessageBubble, ChatInput, TaskStatusPanel } from './ChatShared';
import ProvidersBoard from './ProvidersBoard';

export default function ChatPanel() {
  const {
    company, chatWithSecretary,
    chatOpen, setChatOpen,
    chatPanelWidth, setChatPanelWidth,
    navigateToDepartment, navigateToRequirement,
  } = useStore();
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [localHistory, setLocalHistory] = useState([]);
  const [showProviders, setShowProviders] = useState(false);
  const messagesEndRef = useRef(null);
  const panelRef = useRef(null);
  const isResizingRef = useRef(false);

  // Check if any provider is enabled across all categories
  const hasAnyProvider = useMemo(() => {
    const dashboard = company?.providerDashboard;
    if (!dashboard) return false;
    return Object.values(dashboard).some(cat => cat.enabled > 0);
  }, [company?.providerDashboard]);

  useEffect(() => {
    if (company?.chatHistory) {
      setLocalHistory(company.chatHistory);
    }
  }, [company?.chatHistory]);

  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [localHistory, chatOpen]);

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

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);

    setLocalHistory(prev => [...prev, { role: 'boss', content: msg, time: new Date().toISOString() }]);

    try {
      await chatWithSecretary(msg);
    } catch (e) {
      setLocalHistory(prev => [...prev, {
        role: 'secretary',
        content: `${t('chat.errorPrefix')}${e.message}`,
        time: new Date().toISOString(),
      }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          className="w-10 h-10 rounded-full bg-[var(--border)]"
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
      ) : (<>
      {/* Messages area */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {localHistory.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">💬</div>
            <p className="text-sm text-[var(--muted)]">
              {t('chat.welcome', { name: secretary?.name || t('setup.defaultSecretary') })}
            </p>
            <div className="mt-3 space-y-1">
              {t('chat.suggestions').map((q, i) => (
                <button
                  key={i}
                  className="block w-full text-xs text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--muted)] hover:text-white transition-all"
                  onClick={() => { setMessage(q); }}
                >
                  💡 {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {localHistory.map((msg, i) => (
          <MessageBubble
            key={i}
            isMe={msg.role === 'boss'}
            avatar={msg.role === 'secretary' ? (secretary?.avatar || getAvatarUrl('secretary')) : null}
            name={msg.role === 'boss' ? company.boss : (secretary?.name || t('setup.defaultSecretary'))}
            content={msg.content}
            time={msg.time}
            action={msg.action}
            agentId={null}
            onClickAvatar={null}
            bossAvatar={company?.bossAvatar}
            onViewDepartment={navigateToDepartment}
            onViewRequirement={navigateToRequirement}
          />
        ))}

        {sending && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              <span className="animate-pulse text-[var(--muted)]">{t('chat.typing')}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Task status panel */}
      <TaskStatusPanel />

      {/* Input area */}
      <ChatInput
        value={message}
        onChange={setMessage}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        sending={sending}
        placeholder={t('chat.inputPlaceholder', { name: secretary?.name || t('setup.defaultSecretary') })}
      />
      </>)}

      {/* Resize handle on the right edge */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent)]/40 active:bg-[var(--accent)]/60 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
