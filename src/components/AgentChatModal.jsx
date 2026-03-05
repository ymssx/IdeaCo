'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import ReactMarkdown from 'react-markdown';

export default function AgentChatModal({ agentId, agentName, agentAvatar, agentRole, agentSignature, agentDepartment, onClose }) {
  const { t } = useI18n();
  const { chatWithAgent, fetchAgentChatHistory, company } = useStore();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // 加载聊天历史
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

  // 手动滚动到底部（仅在用户发送消息时调用）
  const scrollToBottom = useCallback(() => {
    // 使用双重rAF确保DOM更新完成后再滚动
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }, []);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);

    // 乐观更新：先在本地添加 boss 消息
    const optimisticMsg = { role: 'boss', content: userMessage, time: new Date().toISOString() };
    setMessages(prev => [...prev, optimisticMsg]);

    // 用户发送消息后自动滚动到底部
    scrollToBottom();

    try {
      const data = await chatWithAgent(agentId, userMessage);
      // 用服务端返回的完整历史替换
      if (data.chatHistory) {
        setMessages(data.chatHistory);
      } else if (data.reply) {
        // fallback: 追加 agent 回复
        setMessages(prev => [...prev, {
          role: 'agent',
          content: data.reply.reply,
          time: data.reply.time,
        }]);
      }
    } catch (e) {
      // 回滚并显示错误
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
  const bossName = company?.boss || 'Boss';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] !m-0" onClick={onClose}>
      <div className="card max-w-lg w-full mx-4 h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 -mx-4 -mt-4 px-4 py-3 border-b border-[var(--border)] shrink-0">
          <img src={agentAvatar} alt={agentName} className="w-10 h-10 rounded-full bg-[var(--border)]" />
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

        {/* Messages */}
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
            messages.map((msg, i) => {
              const isBoss = msg.role === 'boss';
              return (
                <div key={i} className={`flex gap-2 ${isBoss ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  {isBoss ? (
                    bossAvatar ? (
                      <img src={bossAvatar} alt="boss" className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                        👤
                      </div>
                    )
                  ) : (
                    <img src={agentAvatar} alt={agentName} className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
                  )}

                  {/* Bubble */}
                  <div className={`max-w-[75%] ${isBoss ? 'text-right' : ''}`}>
                    <div className={`inline-block rounded-xl px-3 py-2 text-sm ${
                      isBoss
                        ? 'bg-[var(--accent)]/20 text-[var(--foreground)]'
                        : 'bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)]'
                    }`}>
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          code: ({ inline, children }) => inline
                            ? <code className="bg-white/10 px-1 rounded text-xs">{children}</code>
                            : <pre className="bg-black/30 rounded p-2 my-1 overflow-auto text-xs"><code>{children}</code></pre>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    {msg.time && (
                      <div className={`text-[10px] text-[var(--muted)] mt-0.5 ${isBoss ? 'text-right' : ''}`}>
                        {new Date(msg.time).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {sending && (
            <div className="flex gap-2">
              <img src={agentAvatar} alt={agentName} className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
              <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm">
<span className="animate-pulse">💭 {t('agentChat.typing')}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="pt-3 -mx-4 -mb-4 px-4 pb-4 border-t border-[var(--border)] shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="input flex-1"
              placeholder={t('agentChat.inputPlaceholder', { name: agentName })}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              className="btn-primary px-4"
              onClick={handleSend}
              disabled={!input.trim() || sending}
            >
              {sending ? '⏳' : '📤'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
