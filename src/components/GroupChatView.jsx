'use client';

import { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFileReferences, FileRefList } from './FileReference';
import AgentDetailModal from './AgentDetailModal';

// ============ 共享工具函数 ============

/**
 * 根据名字生成唯一hash深色背景色
 */
export function nameToColor(name) {
  if (!name) return 'bg-gradient-to-br from-indigo-600 to-blue-700';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const darkColors = [
    'bg-gradient-to-br from-rose-700 to-pink-900',
    'bg-gradient-to-br from-violet-700 to-purple-900',
    'bg-gradient-to-br from-indigo-700 to-blue-900',
    'bg-gradient-to-br from-cyan-700 to-teal-900',
    'bg-gradient-to-br from-emerald-700 to-green-900',
    'bg-gradient-to-br from-amber-700 to-orange-900',
    'bg-gradient-to-br from-red-700 to-rose-900',
    'bg-gradient-to-br from-fuchsia-700 to-pink-900',
    'bg-gradient-to-br from-blue-700 to-indigo-900',
    'bg-gradient-to-br from-teal-700 to-cyan-900',
    'bg-gradient-to-br from-lime-700 to-green-900',
    'bg-gradient-to-br from-orange-700 to-red-900',
  ];
  return darkColors[Math.abs(hash) % darkColors.length];
}

/**
 * Clean message content: filter out leaked LLM internal tags
 */
export function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content;
}

/**
 * Render @[id] or @Name mention as highlighted tag
 */
export function renderMentions(text, agentMap, onClickMention) {
  if (!text || typeof text !== 'string') return null;

  const nameToId = {};
  if (agentMap) {
    for (const [id, name] of Object.entries(agentMap)) {
      nameToId[name] = id;
    }
  }

  const hasNewFormat = /@\[[^\]]+\]/.test(text);
  const names = Object.keys(nameToId).sort((a, b) => b.length - a.length);
  const hasOldFormat = names.length > 0 && names.some(n => text.includes(`@${n}`));

  if (!hasNewFormat && !hasOldFormat) return null;

  const regexParts = ['(@\\[[^\\]]+\\])'];
  if (names.length > 0) {
    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    regexParts.push(`(@(?:${escapedNames.join('|')}))`);
  }
  const regex = new RegExp(regexParts.join('|'), 'g');
  const parts = text.split(regex).filter(p => p !== undefined);

  if (parts.length <= 1) return null;

  const renderTag = (key, displayName, agentId) => (
    <span
      key={key}
      className={`inline-flex items-center bg-blue-500/30 text-blue-200 px-1.5 py-0.5 rounded text-xs font-semibold mx-0.5 border border-blue-500/20 ${onClickMention ? 'cursor-pointer hover:bg-blue-500/40 transition-colors' : ''}`}
      onClick={() => agentId && onClickMention?.(agentId)}
    >
      @{displayName}
    </span>
  );

  return parts.map((part, i) => {
    const newMatch = part.match(/^@\[([^\]]+)\]$/);
    if (newMatch) {
      const id = newMatch[1];
      const name = agentMap?.[id] || id;
      return renderTag(i, name, id);
    }
    const oldMatch = part.match(/^@(.+)$/);
    if (oldMatch && nameToId[oldMatch[1]]) {
      const name = oldMatch[1];
      const id = nameToId[name];
      return renderTag(i, name, id);
    }
    return part;
  });
}

/**
 * 消息分组：将同一发送者连续的短消息合并到一组
 */
export function groupConsecutiveMessages(messages, getSenderId) {
  if (!messages?.length) return [];
  const groups = [];
  let currentGroup = null;

  for (const msg of messages) {
    const senderId = getSenderId(msg);
    const isShort = (msg.content?.length || 0) <= 120;
    const timeDiff = currentGroup
      ? Math.abs(new Date(msg.time) - new Date(currentGroup.messages[currentGroup.messages.length - 1].time)) / 1000
      : Infinity;

    if (currentGroup && currentGroup.senderId === senderId && isShort && timeDiff <= 60 && currentGroup.isShort) {
      currentGroup.messages.push(msg);
    } else {
      currentGroup = { senderId, messages: [msg], isShort };
      groups.push(currentGroup);
    }
  }
  return groups;
}

// Markdown render component mapping for chat bubbles
const chatMarkdownComponents = {
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

/**
 * 共享的群聊消息渲染组件
 *
 * Props:
 * - groupChat: 群聊消息数组
 * - agentMap: agentId -> agentName 映射
 * - bossAvatar: Boss头像URL
 * - bossName: Boss名字
 * - requirementId: 需求ID（用于发送消息）
 * - onSendMessage: 发送消息函数 (reqId, text) => Promise
 * - fetchDetail: 刷新详情函数 (reqId) => Promise
 * - sendingPlaceholder: 发送中的占位提示
 * - inputPlaceholder: 输入框占位提示
 * - typingLabel: "正在思考回复..." 前面显示的负责人名称
 * - leaderInfo: { name, avatar } 负责人信息，用于typing提示
 * - chatEndRef: 外部传入的滚动ref（可选，不传则内部创建）
 * - embedded: 是否是嵌入模式（如RequirementDetail中，true则不显示sticky input）
 */
export default function GroupChatView({
  groupChat = [],
  agentMap = {},
  bossAvatar,
  bossName = 'Boss',
  requirementId,
  onSendMessage,
  fetchDetail,
  inputPlaceholder,
  leaderInfo,
  chatEndRef: externalChatEndRef,
  embedded = false,
}) {
  const { t } = useI18n();
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState([]);
  const internalChatEndRef = useRef(null);
  const chatEndRef = externalChatEndRef || internalChatEndRef;

  // 合并真实消息和乐观消息
  const allMessages = [...groupChat, ...optimisticMessages];

  // 发送消息的通用逻辑
  const doSend = async () => {
    if (!inputText.trim() || sending || !requirementId || !onSendMessage) return;
    const msg = inputText.trim();
    setInputText('');
    setSending(true);

    // 乐观更新：立即添加Boss消息
    const optimisticMsg = {
      id: `boss-opt-${Date.now()}`,
      from: { id: 'boss', name: bossName, avatar: bossAvatar, role: 'Boss' },
      content: msg,
      type: 'message',
      time: new Date().toISOString(),
    };
    setOptimisticMessages(prev => [...prev, optimisticMsg]);

    // 立即滚动到底部
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      await onSendMessage(requirementId, msg);
      if (fetchDetail) await fetchDetail(requirementId);
      // API返回后清除乐观消息（真实数据已更新）
      setOptimisticMessages([]);
      // 再次滚动（leader回复可能已加入）
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      console.error('Send message failed:', err);
      setOptimisticMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        from: { id: 'system', name: 'System' },
        content: `⚠️ ${t('mailbox.sendFailed') || '发送失败'}: ${err.message}`,
        type: 'system',
        time: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  };

  if (allMessages.length === 0 && !sending) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">💬</div>
          <p>{t('reqDetail.chat.noMessages')}</p>
        </div>
      </div>
    );
  }

  // 渲染单条消息气泡内容（支持Markdown + @提及 + 文件引用）
  const renderMessageContent = (content) => {
    const { cleanContent, fileRefs } = parseFileReferences(content);
    const cleaned = cleanMessageContent(cleanContent);
    const mentionRendered = renderMentions(cleaned, agentMap, setSelectedAgentId);
    return (
      <>
        <div className="break-words text-sm leading-relaxed chat-markdown">
          {mentionRendered || (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
              {cleaned}
            </ReactMarkdown>
          )}
        </div>
        <FileRefList fileRefs={fileRefs} />
      </>
    );
  };

  // Boss消息内容渲染（纯文本 + 文件引用）
  const renderBossContent = (content) => {
    const { cleanContent, fileRefs } = parseFileReferences(content);
    return (
      <>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {cleanMessageContent(cleanContent)}
        </div>
        <FileRefList fileRefs={fileRefs} />
      </>
    );
  };

  return (
    <div className={`flex flex-col ${embedded ? 'flex-1 min-h-0' : ''}`}>
      <div className={`${embedded ? 'flex-1 overflow-auto' : ''} p-4 space-y-3`}>
        {groupConsecutiveMessages(
          allMessages,
          m => m.type === 'system' ? '__system__' : (m.from?.id || m.from?.name || '__unknown__')
        ).map((group, gi) => {
          const firstMsg = group.messages[0];
          if (firstMsg.type === 'system') {
            return group.messages.map(msg => (
              <div key={msg.id} className="text-center">
                <span className="text-[10px] text-[var(--muted)] bg-white/5 px-3 py-1 rounded-full">
                  {msg.content}
                </span>
              </div>
            ));
          }

          const isMerged = group.messages.length > 1;
          const isBoss = firstMsg.from?.id === 'boss';

          // Boss 消息右对齐渲染
          if (isBoss) {
            return (
              <div key={`group-${gi}`} className="flex gap-2 flex-row-reverse">
                {bossAvatar ? (
                  <img src={bossAvatar} alt="boss" className="w-8 h-8 rounded-lg bg-[var(--border)] shrink-0 mt-0.5" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">👤</div>
                )}
                <div className="flex flex-col items-end min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-row-reverse">
                    <span className="text-xs font-medium">{firstMsg.from?.name || bossName}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {new Date(firstMsg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  {group.messages.map((msg) => (
                    <div key={msg.id} className="rounded-2xl rounded-br-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] bg-[var(--accent)] text-white mb-1">
                      {renderBossContent(msg.content)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div key={`group-${gi}`} className="flex gap-2">
              {firstMsg.from?.avatar ? (
                <img
                  src={firstMsg.from.avatar}
                  alt=""
                  className="w-8 h-8 rounded-lg bg-[var(--border)] shrink-0 mt-0.5 cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all"
                  onClick={() => firstMsg.from?.id && firstMsg.from.id !== 'system' && setSelectedAgentId(firstMsg.from.id)}
                />
              ) : (
                <div className={`w-8 h-8 rounded-lg ${nameToColor(firstMsg.from?.name)} flex items-center justify-center text-xs shrink-0 mt-0.5`}>
                  {firstMsg.from?.name?.charAt(0) || '🤖'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-xs font-medium ${firstMsg.from?.id && firstMsg.from.id !== 'system' ? 'cursor-pointer hover:text-[var(--accent)] transition-colors' : ''}`}
                    onClick={() => firstMsg.from?.id && firstMsg.from.id !== 'system' && setSelectedAgentId(firstMsg.from.id)}
                  >{firstMsg.from?.name}</span>
                  {firstMsg.from?.role && (
                    <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1 py-0.5 rounded">{firstMsg.from.role}</span>
                  )}
                  <span className="text-[10px] text-[var(--muted)]">
                    {new Date(firstMsg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                {isMerged ? (
                  <div className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] bg-[var(--card)] border border-[var(--border)]">
                    {group.messages.map((msg, mi) => (
                      <div key={msg.id}>
                        {mi > 0 && <div className="border-t border-white/[0.06] my-1.5" />}
                        {renderMessageContent(msg.content)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] ${
                    firstMsg.type === 'output'
                      ? 'bg-green-900/20 border border-green-500/20'
                      : firstMsg.type === 'tool_call'
                      ? 'bg-purple-900/20 border border-purple-500/20'
                      : 'bg-[var(--card)] border border-[var(--border)]'
                  }`}>
                    {renderMessageContent(firstMsg.content)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {sending && leaderInfo && (
          <div className="flex gap-2">
            {leaderInfo.avatar ? (
              <img src={leaderInfo.avatar} alt={leaderInfo.name} className="w-8 h-8 rounded-lg bg-[var(--border)] shrink-0 mt-0.5" />
            ) : (
              <div className={`w-8 h-8 rounded-lg ${nameToColor(leaderInfo.name)} flex items-center justify-center text-xs shrink-0 mt-0.5`}>
                {leaderInfo.name?.charAt(0) || '🤖'}
              </div>
            )}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              <span className="animate-pulse text-[var(--muted)]">{leaderInfo.name} {t('mailbox.thinkingReply') || '正在思考回复...'}</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* 发消息输入框 */}
      {requirementId && onSendMessage && (
        <div className={`${embedded ? 'sticky bottom-0' : ''} pt-3 px-4 pb-4`}>
          <div className="flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] rounded-xl px-3 py-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && inputText.trim() && !sending) {
                  e.preventDefault();
                  doSend();
                }
              }}
              placeholder={inputPlaceholder || t('mailbox.groupChatInput') || '在群聊中发言，负责人会看到并做出响应...'}
              disabled={sending}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
            />
            <button
              onClick={doSend}
              disabled={!inputText.trim() || sending}
              className="text-sm px-3 py-1 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {sending ? '✉️' : t('mailbox.sendBtn')}
            </button>
          </div>
        </div>
      )}

      {/* 员工详情弹窗 */}
      {selectedAgentId && (
        <AgentDetailModal agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      )}
    </div>
  );
}
