'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import { MessageBubble, ChatInput } from './ChatShared';
import CachedAvatar from './CachedAvatar';

export default function AgentChatModal({ agentId, agentName, agentAvatar, agentRole, agentSignature, agentDepartment, onClose }) {
  const { t } = useI18n();
  const { chatWithAgent, fetchAgentChatHistory, company } = useStore();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoadingHistory(true);
      try {
        const history = await fetchAgentChatHistory(agentId);
        setMessages(history);
      } catch (e) { /* handled */ }
      setLoadingHistory(false);
    })();
  }, [agentId, fetchAgentChatHistory]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);

    const optimisticMsg = { role: 'boss', content: userMessage, time: new Date().toISOString() };
    setMessages(prev => [...prev, optimisticMsg]);
    scrollToBottom();

    try {
      const data = await chatWithAgent(agentId, userMessage);
      if (data.chatHistory) {
        setMessages(data.chatHistory);
      } else if (data.reply) {
        setMessages(prev => [...prev, {
          role: 'agent',
          content: data.reply.reply,
          time: data.reply.time,
        }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'agent',
        content: `😵 ${t('agentChat.error')}: ${e.message}`,
        time: new Date().toISOString(),
      }]);
    }
    setSending(false);
    inputRef.current?.focus();
  }, [input, sending, agentId, chatWithAgent, t]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const bossAvatar = company?.bossAvatar;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] !m-0" onClick={onClose}>
      <div className="card max-w-lg w-full mx-4 h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 -mx-4 -mt-4 px-4 py-3 border-b border-[var(--border)] shrink-0">
          <CachedAvatar src={agentAvatar} alt={agentName} className="w-10 h-10 rounded-full bg-[var(--border)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2">
              {agentName}
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              {(agentRole || agentDepartment) && (
                <span className="text-[10px] text-[var(--muted)] font-normal">
                  {agentRole}{agentDepartment ? ` · ${agentDepartment}` : ''}
                </span>
              )}
            </div>
            {agentSignature ? (
              <div className="text-[10px] text-[var(--muted)] italic truncate" title={agentSignature}>"{agentSignature}"</div>
            ) : (
              <div className="text-[10px] text-[var(--muted)]">{t('agentChat.empty', { name: agentName })}</div>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all">✕</button>
        </div>

        {/* Messages - reuse MessageBubble */}
        <div className="flex-1 overflow-auto py-3 space-y-3">
          {loadingHistory ? (
            <div className="text-center text-[var(--muted)] py-8">
              <div className="text-2xl animate-pulse">💬</div>
              <p className="text-xs mt-2">{t('common.loading')}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-[var(--muted)] py-8">
              <div className="text-3xl">👋</div>
              <p className="text-sm mt-2">{t('agentChat.empty', { name: agentName })}</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={i}
                isMe={msg.role === 'boss'}
                avatar={msg.role !== 'boss' ? agentAvatar : null}
                name={msg.role === 'boss' ? (company?.boss || 'Boss') : agentName}
                content={msg.content}
                time={msg.time}
                agentId={null}
                onClickAvatar={null}
                bossAvatar={bossAvatar}
              />
            ))
          )}
          {sending && (
            <div className="flex gap-2">
              <CachedAvatar src={agentAvatar} alt={agentName} className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
                <span className="animate-pulse text-[var(--muted)]">{t('agentChat.typing')}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input - reuse ChatInput, with negative margin to match card padding */}
        <div className="-mx-4 -mb-4">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            sending={sending}
            placeholder={t('agentChat.inputPlaceholder', { name: agentName })}
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}
