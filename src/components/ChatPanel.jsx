'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFileReferences, FileRefList } from './FileReference';
import CachedAvatar from './CachedAvatar';

export default function ChatPanel() {
  const { company, chatWithSecretary, chatOpen, setChatOpen, chatMinimized, setChatMinimized } = useStore();
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [localHistory, setLocalHistory] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (company?.chatHistory) {
      setLocalHistory(company.chatHistory);
    }
  }, [company?.chatHistory]);

  // Auto scroll to bottom: on message update or panel open
  useEffect(() => {
    if (chatOpen && !chatMinimized) {
      // Use setTimeout to ensure DOM is rendered before scrolling
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [localHistory, chatOpen, chatMinimized]);

  if (!company || !chatOpen) return null;

  const secretary = company.secretary;

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);

    // Optimistic update
    setLocalHistory(prev => [...prev, { role: 'boss', content: msg, time: new Date().toISOString() }]);

    try {
      await chatWithSecretary(msg);
      // Secretary replies auto-sync to localHistory via chatHistory -> useEffect
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

  // 收起状态：只显示一个浮动气泡
  if (chatMinimized) {
    return (
      <button
        onClick={() => setChatMinimized(false)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-2xl flex items-center justify-center z-[70] hover:scale-110 transition-all animate-fade-in group"
        title={t('chat.openChat', { name: secretary?.name || t('setup.defaultSecretary') })}
      >
        <img
          src={secretary?.avatar || getAvatarUrl('secretary')}
          alt={t('chat.secretary')}
          className="w-11 h-11 rounded-full border-2 border-white/20"
        />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#0d0d0d] animate-pulse" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[440px] h-[600px] bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col z-[70] animate-fade-in overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-gradient-to-r from-blue-900/30 to-purple-900/30 shrink-0">
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => setChatMinimized(true)}
            className="text-[var(--muted)] hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
            title={t('common.minimize')}
          >
            ▾
          </button>
          <button
            onClick={() => setChatOpen(false)}
            className="text-[var(--muted)] hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Welcome message */}
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

        {localHistory.map((msg, i) => {
          const { cleanContent, fileRefs } = parseFileReferences(msg.content);
          return (
          <div key={i} className={`flex gap-2 ${msg.role === 'boss' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'boss' ? (
              company?.bossAvatar ? (
                <CachedAvatar src={company.bossAvatar} alt="boss" className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  👤
                </div>
              )
            ) : (
              <img
                src={secretary?.avatar || getAvatarUrl('secretary')}
                alt={t('chat.secretary')}
                className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5"
              />
            )}
            <div className={`max-w-[min(75%,480px)] rounded-xl px-3 py-2 text-sm ${
              msg.role === 'boss'
                ? 'bg-[var(--accent)] text-white rounded-br-sm'
                : 'bg-[var(--background)] border border-[var(--border)] rounded-bl-sm'
            }`}>
              <div className="break-words chat-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Custom render components for chat bubble styling
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li className="text-sm">{children}</li>,
                    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    code: ({ inline, className, children }) => {
                      if (inline) {
                        return <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
                      }
                      return (
                        <pre className="bg-black/30 rounded-lg p-2 my-1 overflow-x-auto">
                          <code className="text-xs font-mono">{children}</code>
                        </pre>
                      );
                    },
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
                        {children}
                      </a>
                    ),
                    h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-semibold mb-0.5">{children}</h3>,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-white/30 pl-2 my-1 text-[var(--muted)]">{children}</blockquote>
                    ),
                    hr: () => <hr className="my-2 border-white/10" />,
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-1">
                        <table className="text-xs border-collapse">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => <th className="border border-white/20 px-2 py-1 bg-white/5 font-semibold">{children}</th>,
                    td: ({ children }) => <td className="border border-white/20 px-2 py-1">{children}</td>,
                  }}
                >
                  {cleanContent}
                </ReactMarkdown>
              </div>
              <FileRefList fileRefs={fileRefs} />
              {msg.action?.type === 'task_assigned' && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-blue-300">
                  {t('chat.taskAssigned', { dept: msg.action.departmentName })}{msg.action.taskStatus === 'running' && <span className="ml-1 animate-pulse">{t('chat.running')}</span>}
                </div>
              )}
              {msg.action?.type === 'need_new_department' && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-blue-300">{t('chat.needNewDept')}</div>
              )}
              {msg.action?.type === 'progress_report' && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-blue-300">{t('chat.progressReport')}</div>
              )}
            </div>
          </div>
          );
        })}

        {sending && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl rounded-bl-sm px-3 py-2 text-sm">
<span className="animate-pulse text-[var(--muted)]">{t('chat.typing')}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-[var(--border)]">
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            placeholder={t('chat.inputPlaceholder', { name: secretary?.name || t('setup.defaultSecretary') })}
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            className="btn-primary px-3 py-2 text-sm"
            disabled={!message.trim() || sending}
            onClick={handleSend}
          >
            {sending ? '⏳' : '📤'}
          </button>
        </div>
      </div>
    </div>
  );
}
