
'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import AgentDetailModal from './AgentDetailModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CachedAvatar from './CachedAvatar';

// 复用 Mailbox 的 Markdown 渲染组件映射
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

// 清理消息内容中的内部标签
function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content;
}

/**
 * 渲染 @[id] 或 @Name mention 高亮
 * 同时兼容新格式 @[agentId] 和旧格式 @AgentName
 */
function renderMentions(text, agentMap, onClickMention) {
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
function groupConsecutiveMessages(messages, getSenderId) {
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

/**
 * AgentSpyModal — 🕵️ 偷窥某员工的IM界面
 * 左边：同事头像列表（会话列表）
 * 右边：聊天窗口
 */
export default function AgentSpyModal({ agentId, agentName, agentAvatar, onClose }) {
  const { t } = useI18n();
  const { fetchAgentConversations, fetchAgentConversationHistory } = useStore();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionParticipants, setSessionParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(null); // 点击头像/消息弹出员工详情
  const messagesEndRef = useRef(null);

  // 构建 agentId -> agentName 映射（用于 @[id] 渲染）
  const { company } = useStore();
  const agentMap = {};
  if (company?.departments) {
    for (const dept of company.departments) {
      for (const agent of (dept.members || dept.agents || [])) {
        agentMap[agent.id] = agent.name;
      }
    }
  }
  // 秘书也是员工，加入映射
  if (company?.secretary?.id) {
    agentMap[company.secretary.id] = company.secretary.name;
  }

  // 加载会话列表
  useEffect(() => {
    setLoading(true);
    fetchAgentConversations(agentId).then(data => {
      setConversations(data);
      // 自动选中第一个会话
      if (data.length > 0) {
        setSelectedConv(data[0]);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [agentId]);

  // 选中会话后加载消息
  useEffect(() => {
    if (selectedConv) {
      setMsgLoading(true);
      fetchAgentConversationHistory(agentId, selectedConv.sessionId).then(result => {
        setMessages(result.messages || []);
        setSessionParticipants(result.participants || []);
        setMsgLoading(false);
      }).catch(() => setMsgLoading(false));
    }
  }, [selectedConv]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] !m-0" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-3xl w-full mx-4 h-[75vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--card)]">
          <div className="text-lg">🕵️</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2">
              {t('agent.spyTitle', { name: agentName })}
              <span className="text-[10px] text-[var(--muted)] font-normal bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-full">
                {t('agent.spyMode')}
              </span>
            </div>
            <div className="text-[10px] text-[var(--muted)]">{t('agent.spyHint')}</div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-white text-xl w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>

        {/* Body: 左边联系人列表 + 右边聊天区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：联系人列表 */}
          <div className="w-[200px] shrink-0 border-r border-[var(--border)] overflow-auto bg-[var(--background)]/50">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-2xl animate-pulse">🔍</div>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                <div className="text-3xl mb-2">🤫</div>
                <p className="text-xs text-[var(--muted)]">{t('agent.noConversations')}</p>
                <p className="text-[10px] text-[var(--muted)] mt-1">{t('agent.noConversationsHint')}</p>
              </div>
            ) : (
              <div className="py-1">
                {conversations.map(conv => {
                  const isActive = selectedConv?.sessionId === conv.sessionId;
                  return (
                    <div
                      key={conv.sessionId}
                      onClick={() => setSelectedConv(conv)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[var(--accent)]/10 border-l-2 border-[var(--accent)]'
                          : 'hover:bg-white/5 border-l-2 border-transparent'
                      }`}
                    >
                      {/* 头像 */}
                      {conv.peerAvatar ? (
                        <img
                          src={conv.peerAvatar}
                          alt=""
                          className={`w-9 h-9 rounded-full bg-[var(--border)] shrink-0 ${isActive ? 'ring-2 ring-[var(--accent)]/50' : ''}`}
                        />
                      ) : (
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm shrink-0 ${isActive ? 'ring-2 ring-[var(--accent)]/50' : ''}`}>
                          {conv.type === 'boss-agent' ? '👤' : '🤖'}
                        </div>
                      )}
                      {/* 名字和简介 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{conv.peerName}</div>
                        {conv.peerRole && (
                          <div className="text-[10px] text-[var(--muted)] truncate">{conv.peerRole}</div>
                        )}
                        {conv.lastMessage && (
                          <div className="text-[10px] text-[var(--muted)] truncate mt-0.5 italic">{conv.lastMessage}</div>
                        )}
                      </div>
                      {/* 消息数气泡 */}
                      {conv.totalMessages > 0 && (
                        <span className="text-[9px] bg-white/10 text-[var(--muted)] px-1.5 py-0.5 rounded-full shrink-0">
                          {conv.totalMessages}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 右侧：聊天窗口 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedConv ? (
              /* 未选中会话 */
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="text-5xl mb-3 opacity-30">🕵️</div>
                <p className="text-sm text-[var(--muted)]">{t('agent.spySelectHint')}</p>
              </div>
            ) : (
              <>
                {/* 聊天对象信息 header */}
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] shrink-0 bg-[var(--background)]/30">
                  {selectedConv.peerAvatar ? (
                    <CachedAvatar src={selectedConv.peerAvatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)]" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm">
                      {selectedConv.type === 'boss-agent' ? '👤' : '🤖'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      <span className="truncate">{selectedConv.peerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedConv.peerRole && (
                        <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1.5 py-0.5 rounded">{selectedConv.peerRole}</span>
                      )}
                      {selectedConv.peerDepartment && (
                        <span className="text-[10px] text-[var(--muted)]">· {selectedConv.peerDepartment}</span>
                      )}
                      <span className="text-[10px] text-[var(--muted)]">· {selectedConv.totalMessages} {t('agent.spyMsgCount')}</span>
                    </div>
                  </div>
                </div>

                {/* 消息列表 */}
                <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
                  {msgLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="text-2xl animate-pulse">🔍</div>
                        <p className="text-xs text-[var(--muted)] mt-2">{t('agent.spyLoading')}</p>
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="text-3xl mb-2 opacity-30">💬</div>
                        <p className="text-sm text-[var(--muted)]">{t('agent.noConversationMessages')}</p>
                      </div>
                    </div>
                  ) : (
                    groupConsecutiveMessages(messages, m => {
                      // 判断消息发送者ID
                      if (m.fromAgentId) return m.fromAgentId;
                      // 旧数据 fallback: boss-agent 会话根据 role 判断
                      if (selectedConv.type === 'boss-agent') {
                        return m.role === 'boss' ? 'boss' : agentId;
                      }
                      // 旧数据 fallback: agent-agent 会话，如果消息内容 @了对方，说明是目标员工发的
                      const peerId = selectedConv.peerId;
                      if (peerId && m.content) {
                        const peerName = agentMap[peerId];
                        if (peerName && (m.content.includes(`@${peerName}`) || m.content.includes(`@[${peerId}]`))) {
                          return agentId; // 目标员工 @ 了对方 → 是目标员工发的
                        }
                        const agentName_ = agentMap[agentId];
                        if (agentName_ && (m.content.includes(`@${agentName_}`) || m.content.includes(`@[${agentId}]`))) {
                          return peerId; // 对方 @ 了目标员工 → 是对方发的
                        }
                      }
                      // 最终 fallback: 交替分配
                      return '__unknown__';
                    }).map((group, gi) => {
                      const firstMsg = group.messages[0];
                      // 判断消息是否由目标员工发出
                      const isFromAgent = firstMsg.fromAgentId === agentId
                        || (selectedConv.type === 'boss-agent' && firstMsg.role !== 'boss')
                        || (!firstMsg.fromAgentId && selectedConv.type !== 'boss-agent' && (() => {
                          // 旧数据 fallback 判断
                          const peerId = selectedConv.peerId;
                          const peerName = agentMap[peerId];
                          if (peerName && firstMsg.content && (firstMsg.content.includes(`@${peerName}`) || firstMsg.content.includes(`@[${peerId}]`))) {
                            return true;
                          }
                          return false;
                        })());
                      const isBoss = firstMsg.role === 'boss';
                      const isRight = isFromAgent && !isBoss;
                      const isMerged = group.messages.length > 1;

                      return (
                        <div key={`group-${gi}`} className={`flex gap-2 ${isRight ? 'flex-row-reverse' : ''}`}>
                          {/* Avatar */}
                          {isRight ? (
                            agentAvatar ? (
                              <CachedAvatar src={agentAvatar} alt="" className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5 cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all" onClick={() => setSelectedAgentId(agentId)} />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs shrink-0 mt-0.5">🤖</div>
                            )
                          ) : (
                            selectedConv.peerAvatar ? (
                              <img
                                src={selectedConv.peerAvatar}
                                alt=""
                                className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0 mt-0.5 cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all"
                                onClick={() => {
                                  const peerId = selectedConv.peerId;
                                  if (peerId) setSelectedAgentId(peerId);
                                }}
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs shrink-0 mt-0.5">
                                {isBoss ? '👤' : '🤖'}
                              </div>
                            )
                          )}

                          <div className={`max-w-[70%] ${isRight ? 'text-right' : ''}`}>
                            {/* Name + Time */}
                            <div className={`flex items-center gap-2 mb-0.5 ${isRight ? 'flex-row-reverse' : ''}`}>
                              <span className="text-[10px] text-[var(--muted)]">
                                {isRight ? agentName : (firstMsg.fromAgentName || selectedConv.peerName)}
                              </span>
                              {firstMsg.time && (
                                <span className="text-[10px] text-[var(--muted)]/60">
                                  {new Date(firstMsg.time).toLocaleTimeString()}
                                </span>
                              )}
                            </div>
                            {/* Bubble */}
                            {isMerged ? (
                              <div className={`inline-block rounded-2xl px-3 py-2 text-sm leading-relaxed text-left ${
                                isRight
                                  ? 'bg-indigo-500/15 border border-indigo-500/20 rounded-br-sm'
                                  : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-sm'
                              }`}>
                                {group.messages.map((msg, mi) => (
                                  <div key={mi}>
                                    {mi > 0 && <div className="border-t border-white/[0.06] my-1.5" />}
                                    <div className="break-words chat-markdown">
                                      {renderMentions(cleanMessageContent(msg.content), agentMap, setSelectedAgentId) || (
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                          {cleanMessageContent(msg.content)}
                                        </ReactMarkdown>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={`inline-block rounded-2xl px-3 py-2 text-sm leading-relaxed text-left ${isRight
                                ? 'bg-indigo-500/15 border border-indigo-500/20 rounded-br-sm'
                                : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-sm'
                              }`}>
                                <div className="break-words chat-markdown">
                                  {renderMentions(cleanMessageContent(firstMsg.content), agentMap, setSelectedAgentId) || (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                      {cleanMessageContent(firstMsg.content)}
                                    </ReactMarkdown>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* 底部提示 */}
                <div className="px-4 py-2 border-t border-[var(--border)] shrink-0 bg-[var(--background)]/30">
                  <div className="text-[10px] text-[var(--muted)] text-center flex items-center justify-center gap-1">
                    🔒 {t('agent.spyReadonly')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 员工详情弹窗 */}
        {selectedAgentId && (
          <AgentDetailModal agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
        )}
      </div>
    </div>
  );
}


