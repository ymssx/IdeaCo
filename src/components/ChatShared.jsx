'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/lib/i18n';
import { parseFileReferences, FileRefList } from './FileReference';
import { cleanMessageContent } from './GroupChatView';
import CachedAvatar from './CachedAvatar';

// ============ Markdown Components ============

export const chatMarkdownComponents = {
  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-sm">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ inline, children }) => {
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
};

// ============ Time Formatting ============

export function formatTime(time, t = (k) => k) {
  if (!time) return '';
  const d = new Date(time);
  const now = new Date();
  const diff = now - d;

  if (diff < 60 * 1000) return t('time.justNow');
  if (diff < 60 * 60 * 1000) return t('time.minutesAgo', { n: Math.floor(diff / 60000) });
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = [t('time.sun'), t('time.mon'), t('time.tue'), t('time.wed'), t('time.thu'), t('time.fri'), t('time.sat')];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('zh', { month: 'short', day: 'numeric' });
}

// ============ Message Bubble ============

/**
 * Shared message bubble component.
 * Supports Markdown rendering and file references.
 */
export function MessageBubble({ isMe, avatar, name, content, time, subject, agentId, onClickAvatar, bossAvatar, channel }) {
  const { t } = useI18n();
  const { cleanContent, fileRefs } = parseFileReferences(content);
  const isWeixin = isMe && channel === 'weixin';
  return (
    <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe ? (
        <CachedAvatar
          src={avatar}
          alt=""
          className={`w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5 ${
            agentId ? 'cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all' : ''
          }`}
          onClick={() => agentId && onClickAvatar?.(agentId)}
        />
      ) : (
        bossAvatar ? (
          <CachedAvatar src={bossAvatar} alt="boss" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
            👤
          </div>
        )
      )}
      <div className={`max-w-[min(70%,560px)] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Name + time + channel badge */}
        <div className={`flex items-center gap-2 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-[var(--muted)]">{name}</span>
          {isWeixin && (
            <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">WeChat</span>
          )}
          {time && (
            <span className="text-[10px] text-[var(--muted)]/60">
              {formatTime(time, t)}
            </span>
          )}
        </div>
        {/* Subject tag */}
        {subject && (
          <div className="text-[10px] text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded mb-1 inline-block">
            📌 {subject}
          </div>
        )}
        {/* Bubble */}
        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isMe
            ? isWeixin
              ? 'bg-[#57c457] text-white rounded-br-sm'
              : 'bg-[var(--accent)] text-white rounded-br-sm'
            : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-sm'
        }`}>
          <div className="break-words chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
              {cleanMessageContent(cleanContent)}
            </ReactMarkdown>
          </div>
          <FileRefList fileRefs={fileRefs} />
        </div>
      </div>
    </div>
  );
}

// ============ Chat Input ============

/**
 * Shared chat input component.
 */
export function ChatInput({ value, onChange, onSend, onKeyDown, sending, placeholder, inputRef }) {
  const { t } = useI18n();
  return (
    <div className="px-4 py-3 border-t border-white/[0.06] bg-[var(--card)]">
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          className="input flex-1 text-sm resize-none min-h-[40px] max-h-[120px]"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          rows={1}
          style={{ height: 'auto' }}
          onInput={e => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
        />
        <button
          className="btn-primary px-4 py-2 text-sm shrink-0"
          disabled={!value.trim() || sending}
          onClick={onSend}
        >
          {sending ? '⏳' : t('mailbox.sendBtn')}
        </button>
      </div>
    </div>
  );
}


