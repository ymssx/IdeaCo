'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import AgentDetailModal from './AgentDetailModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/lib/i18n';
import { parseFileReferences, FileRefList } from './FileReference';

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
 * Clean message content: filter out leaked LLM internal tags (e.g. DeepSeek DSML tool call format)
 */
function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  // Remove <｜DSML｜...> tags and their wrapped tool call content
  // Match complete DSML tool call blocks (from <｜DSML｜function_calls> to end of message)
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  // Also handle possible half-width variants
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  // Remove other common leaked LLM internal tags
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content; // If cleaned result is empty, return original content
}

/**
 * Render @[id] or @Name mention as highlighted tag
 * 同时兼容新格式 @[agentId] 和旧格式 @AgentName
 * onClickMention: optional callback (agentId) => void
 */
function renderMentions(text, agentMap, onClickMention) {
  if (!text || typeof text !== 'string') return null;

  // 构建 name -> id 反向映射（用于旧格式 @Name 匹配）
  const nameToId = {};
  if (agentMap) {
    for (const [id, name] of Object.entries(agentMap)) {
      nameToId[name] = id;
    }
  }

  // 先尝试新格式 @[id]
  const hasNewFormat = /@\[[^\]]+\]/.test(text);
  // 构建旧格式名字匹配正则（按名字长度降序，避免短名匹配到长名的前缀）
  const names = Object.keys(nameToId).sort((a, b) => b.length - a.length);
  const hasOldFormat = names.length > 0 && names.some(n => text.includes(`@${n}`));

  if (!hasNewFormat && !hasOldFormat) return null;

  // 构建综合正则：同时匹配 @[id] 和 @Name
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
    // 新格式 @[id]
    const newMatch = part.match(/^@\[([^\]]+)\]$/);
    if (newMatch) {
      const id = newMatch[1];
      const name = agentMap?.[id] || id;
      return renderTag(i, name, id);
    }
    // 旧格式 @Name
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
 * 短消息阈值：内容长度 <= 120 字符 且 时间间隔 <= 60秒
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
 * IM chat interface - Lark style
 * Left: conversation list (secretary pinned on top), Right: chat bubbles
 */
export default function Mailbox() {
  const { t } = useI18n();
  const {
    company,
    chatWithSecretary, chatOpen, setChatOpen,
    navigateToRequirement, fetchRequirements, fetchRequirementDetail,
    chatWithAgent, fetchAgentChatHistory, markAgentChatRead,
  } = useStore();

  const [activeChat, setActiveChat] = useState(null); // { type: 'secretary' } | { type: 'agent-chat', agentId, ... }
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [secretaryHistory, setSecretaryHistory] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null); // View employee detail
  const [chatFilter, setChatFilter] = useState('all'); // Chat filter: all | group | private | important
  const [requirements, setRequirements] = useState([]); // Requirements list (for group chat sessions)
  const [activeReqChat, setActiveReqChat] = useState(null); // Current active requirement group chat
  const [reqChatDetail, setReqChatDetail] = useState(null); // Requirement group chat detail
  const [agentChatMessages, setAgentChatMessages] = useState([]); // Agent 1-on-1 chat messages
  const [agentChatLoading, setAgentChatLoading] = useState(false); // Agent chat loading state
  const [showGroupMembers, setShowGroupMembers] = useState(false); // 群聊成员弹窗
  const reqChatPollRef = useRef(null);
  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(null); // 追踪当前活跃的聊天对象，防止异步消息串台

  if (!company) return null;

  const secretary = company.secretary;
  const agentChatSessions = company.agentChatSessions || [];

  // 构建 agentId -> agentName 映射（用于 @[id] 渲染）
  const agentMap = {};
  if (company?.departments) {
    for (const dept of company.departments) {
      for (const agent of (dept.agents || [])) {
        agentMap[agent.id] = agent.name;
      }
    }
  }

  // Load requirements list (for group chat sessions)
  useEffect(() => {
    fetchRequirements().then(setRequirements);
    const timer = setInterval(() => {
      fetchRequirements().then(setRequirements);
    }, 10000);
    return () => clearInterval(timer);
  }, [company]);

  // Requirement group chat polling
  useEffect(() => {
    if (reqChatPollRef.current) clearInterval(reqChatPollRef.current);
    if (activeReqChat) {
      const loadDetail = () => {
        fetchRequirementDetail(activeReqChat).then(detail => {
          if (detail) setReqChatDetail(detail);
        });
      };
      loadDetail();
      reqChatPollRef.current = setInterval(loadDetail, 3000);
    } else {
      setReqChatDetail(null);
    }
    return () => {
      if (reqChatPollRef.current) clearInterval(reqChatPollRef.current);
    };
  }, [activeReqChat]);

  // Sync secretary chat history
  useEffect(() => {
    if (company?.chatHistory) {
      setSecretaryHistory(company.chatHistory);
    }
  }, [company?.chatHistory]);

  // Track whether we should auto-scroll (only on initial load / conversation switch)
  const shouldAutoScrollRef = useRef(true);

  // Auto scroll to bottom: ONLY on conversation switch or initial load
  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [activeChat]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      shouldAutoScrollRef.current = false;
    }
  }, [activeChat, secretaryHistory, reqChatDetail, agentChatMessages]);

  // Close ChatPanel when secretary is selected to avoid conflict
  useEffect(() => {
    if (activeChat?.type === 'secretary' && chatOpen) {
      setChatOpen(false);
    }
  }, [activeChat]);

  // Build conversation list: sorted by latest message time
  const allConversations = buildConversations(secretary, secretaryHistory, requirements, t, agentChatSessions);

  // Filter conversations by category
  const conversations = allConversations.filter(conv => {
    if (chatFilter === 'all') return true;
    if (chatFilter === 'group') return conv.type === 'requirement';
    if (chatFilter === 'private') return conv.type === 'secretary' || conv.type === 'agent-chat';
    if (chatFilter === 'important') return conv.type === 'secretary' || conv.type === 'requirement';
    return true;
  });

  // Send message
  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      if (activeChat?.type === 'secretary') {
// Optimistic update for boss message
        setSecretaryHistory(prev => [...prev, {
          role: 'boss', content: text, time: new Date().toISOString(),
        }]);
        await chatWithSecretary(text);
        // Secretary replies sync via useEffect
      } else if (activeChat?.type === 'agent-chat') {
        // Agent 1-on-1 chat
        const targetAgentId = activeChat.agentId; // 捕获当前发送目标
        const optimisticMsg = { role: 'boss', content: text, time: new Date().toISOString() };
        setAgentChatMessages(prev => [...prev, optimisticMsg]);
        try {
          const data = await chatWithAgent(targetAgentId, text);
          // 只有当前仍在同一会话时才更新消息
          if (activeChatRef.current?.agentId === targetAgentId) {
            if (data.chatHistory) {
              setAgentChatMessages(data.chatHistory);
            } else if (data.reply) {
              setAgentChatMessages(prev => [...prev, {
                role: 'agent', content: data.reply.reply, time: data.reply.time,
              }]);
            }
          }
        } catch (err) {
          if (activeChatRef.current?.agentId === targetAgentId) {
            setAgentChatMessages(prev => [...prev, {
              role: 'agent', content: `😵 ${t('agentChat.error')}: ${err.message}`, time: new Date().toISOString(),
            }]);
          }
        }
      }
    } catch (e) {
      if (activeChat?.type === 'secretary') {
        setSecretaryHistory(prev => [...prev, {
          role: 'secretary',
          content: `Sorry, error processing: ${e.message}`,
          time: new Date().toISOString(),
        }]);
      }
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectConversation = (conv) => {
    if (conv.type === 'secretary') {
      setActiveChat({ type: 'secretary' });
      setActiveReqChat(null);
    } else if (conv.type === 'requirement') {
      setActiveChat({ type: 'requirement', id: conv.requirementId });
      setActiveReqChat(conv.requirementId);
    } else if (conv.type === 'agent-chat') {
      setActiveChat({
        type: 'agent-chat',
        agentId: conv.agentId,
        agentName: conv.name,
        agentAvatar: conv.avatar,
        agentRole: conv.role,
        agentSignature: conv.agentSignature,
        agentDepartment: conv.departmentName,
      });
      setActiveReqChat(null);
      // 标记为已读（持久化到后端）
      markAgentChatRead(conv.agentId);
      // 加载聊天历史
      setAgentChatLoading(true);
      fetchAgentChatHistory(conv.agentId).then(msgs => {
        setAgentChatMessages(msgs);
        setAgentChatLoading(false);
      }).catch(() => setAgentChatLoading(false));
    }
    setInputText('');
  };

  // 同步 activeChatRef
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  return (
    <div className="flex h-full animate-fade-in">
      {/* Left: conversation list */}
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col bg-[#0d0d0d]">
        {/* Search bar */}
        <div className="border-b border-white/[0.06]">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="text-sm font-semibold leading-none">{t('mailbox.title')}</h2>          </div>
          {/* Category tabs */}
          <div className="flex px-3 pb-2 gap-1">
            {[
              { key: 'all', label: t('mailbox.tabs.all') },
              { key: 'group', label: t('mailbox.tabs.group') },
              { key: 'private', label: t('mailbox.tabs.private') },
              { key: 'important', label: t('mailbox.tabs.important') },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setChatFilter(tab.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-all ${
                  chatFilter === tab.key
                    ? 'bg-[var(--accent)] text-white font-medium'
                    : 'bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-auto">
          {conversations.map((conv) => {
            const isActive = activeChat?.type === conv.type &&
              (conv.type === 'secretary' || (conv.type === 'requirement' && activeChat?.id === conv.requirementId) || (conv.type === 'agent-chat' && activeChat?.agentId === conv.agentId));

            return (
              <div
                key={conv.key}
                onClick={() => handleSelectConversation(conv)}
                className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-all border-b border-white/[0.04] ${
                  isActive
                    ? 'bg-[var(--accent)]/10 border-l-2 border-l-[var(--accent)]'
                    : 'hover:bg-white/5 border-l-2 border-l-transparent'
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  {conv.isRequirement ? (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-sm font-bold">
                      {(conv.role || '💬').charAt(0)}
                    </div>
                  ) : (
                    <img
                      src={conv.avatar}
                      alt={conv.name}
                      className="w-10 h-10 rounded-full bg-[var(--border)]"
                    />
                  )}
                  {conv.type === 'secretary' && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d0d0d]" />
                  )}
                  {conv.unread && conv.type !== 'secretary' && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-[#0d0d0d]" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate ${conv.unread ? 'font-semibold' : 'font-medium'}`}>
                      {conv.name}
                      {conv.pinned && <span className="ml-1 text-[10px] text-yellow-400">📌</span>}
                    </span>
                    <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">
                      {formatTime(conv.lastTime, t)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {conv.role && (
                      <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1 py-0.5 rounded shrink-0">{conv.role}</span>
                    )}
                    <span className={`text-xs truncate ${conv.unread ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
                      {conv.lastMessage}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {conversations.length <= 1 && (
            <div className="text-center py-8 text-[var(--muted)]">
              <div className="text-3xl mb-2">🤫</div>
              <p className="text-xs">{t('mailbox.noMessages')}</p>
              <p className="text-[10px] mt-1">{t('mailbox.noMessagesHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: chat area */}
      <div className="flex-1 flex flex-col bg-[var(--background)] min-w-0 overflow-hidden">
        {!activeChat ? (
          /* No conversation selected */
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg font-medium">{t('mailbox.selectChat')}</p>
              <p className="text-sm mt-1">{t('mailbox.selectChatHint')}</p>
            </div>
          </div>
        ) : activeChat.type === 'secretary' ? (
          /* Secretary chat */
          <>
            {/* Secretary chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <img
                src={secretary?.avatar || getAvatarUrl('secretary')}
                alt="secretary"
                className="w-9 h-9 rounded-full bg-[var(--border)]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  {secretary?.name || t('setup.defaultSecretary')}
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-[10px] text-[var(--muted)] font-normal">{t('mailbox.personalSecretary')}</span>
                </div>
                {secretary?.signature && (
                  <div className="text-[10px] text-[var(--muted)] italic truncate" title={secretary.signature}>"{secretary.signature}"</div>
                )}
              </div>
            </div>

            {/* Secretary messages area */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {secretaryHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-2">💬</div>
                  <p className="text-sm text-[var(--muted)]">{t('mailbox.chatHint', { name: secretary?.name || t('setup.defaultSecretary') })}</p>
                  <div className="mt-3 space-y-1 max-w-xs mx-auto">
                    {t('chat.suggestions').map((q, i) => (
                      <button
                        key={i}
                        className="block w-full text-xs text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--muted)] hover:text-white transition-all"
                        onClick={() => setInputText(q)}
                      >
                        💡 {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {secretaryHistory.map((msg, i) => (
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
                />
              ))}

              {sending && activeChat.type === 'secretary' && (
                <div className="flex gap-2">
                  <img
                src={secretary?.avatar || getAvatarUrl('secretary')}
                alt="secretary"
                    className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0"
                  />
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
<span className="animate-pulse text-[var(--muted)]">{t('chat.typing')}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Secretary input box */}
            <ChatInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              sending={sending}
              placeholder={t('chat.inputPlaceholder', { name: secretary?.name || t('setup.defaultSecretary') })}
            />
          </>
        ) : activeChat?.type === 'agent-chat' ? (
          /* Agent 1-on-1 private chat */
          <>
            {/* Agent chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              {activeChat.agentAvatar ? (
                <img
                  src={activeChat.agentAvatar}
                  alt={activeChat.agentName}
                  className="w-9 h-9 rounded-full bg-[var(--border)] cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all"
                  onClick={() => setSelectedAgent(activeChat.agentId)}
                  title={t('mailbox.viewAgentDetail')}
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-base shrink-0">💬</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  {activeChat.agentName}
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  {(activeChat.agentRole || activeChat.agentDepartment) && (
                    <span className="text-[10px] text-[var(--muted)] font-normal">
                      {activeChat.agentRole}{activeChat.agentDepartment ? ` · ${activeChat.agentDepartment}` : ''}
                    </span>
                  )}
                </div>
                {activeChat.agentSignature && (
                  <div className="text-[10px] text-[var(--muted)] italic truncate" title={activeChat.agentSignature}>"{activeChat.agentSignature}"</div>
                )}
              </div>
            </div>

            {/* Agent chat messages */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {agentChatLoading ? (
                <div className="text-center text-[var(--muted)] py-8">
                  <div className="text-2xl animate-pulse">💬</div>
                  <p className="text-xs mt-2">{t('common.loading')}</p>
                </div>
              ) : agentChatMessages.length === 0 ? (
                <div className="text-center text-[var(--muted)] py-8">
                  <div className="text-3xl">👋</div>
                  <p className="text-sm mt-2">{t('agentChat.empty', { name: activeChat.agentName })}</p>
                </div>
              ) : (
                agentChatMessages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    isMe={msg.role === 'boss'}
                    avatar={msg.role !== 'boss' ? activeChat.agentAvatar : null}
                    name={msg.role === 'boss' ? company.boss : activeChat.agentName}
                    content={msg.content}
                    time={msg.time}
                    agentId={msg.role !== 'boss' ? activeChat.agentId : null}
                    onClickAvatar={setSelectedAgent}
                    bossAvatar={company?.bossAvatar}
                  />
                ))
              )}

              {sending && activeChat.type === 'agent-chat' && (
                <div className="flex gap-2">
                  {activeChat.agentAvatar ? (
                    <img src={activeChat.agentAvatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs shrink-0">💬</div>
                  )}
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
                    <span className="animate-pulse text-[var(--muted)]">{t('agentChat.typing')}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Agent chat input */}
            <ChatInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              sending={sending}
              placeholder={t('agentChat.inputPlaceholder', { name: activeChat.agentName })}
            />
          </>
        ) : activeChat?.type === 'requirement' && reqChatDetail ? (
          /* Requirement group chat */
          <>
            {/* Requirement group chat header */}
            <div className="px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-sm font-bold shrink-0">
                    {(reqChatDetail.departmentName || '💬').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {reqChatDetail.title}
                      {(() => {
                        const stCfg = {
                          pending: { label: t('requirements.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30' },
                          planning: { label: t('requirements.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30' },
                          in_progress: { label: t('requirements.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
                          completed: { label: t('requirements.stats.completed'), color: 'text-green-400', bg: 'bg-green-900/30' },
                          failed: { label: t('requirements.status.failed'), color: 'text-red-400', bg: 'bg-red-900/30' },
                        };
                        const s = stCfg[reqChatDetail.status] || stCfg.pending;
                        return <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.color}`}>{s.label}</span>;
                      })()}
                    </div>
                    <div className="text-[10px] text-[var(--muted)] truncate flex items-center gap-2">
                      <span>{t('mailbox.groupChatCount', { dept: reqChatDetail.departmentName, n: reqChatDetail.groupChat?.length || 0 })}</span>
                      {(() => {
                        // 从群聊消息中提取唯一参与者
                        const memberMap = {};
                        (reqChatDetail.groupChat || []).forEach(m => {
                          if (m.from?.id && m.from.id !== 'system') {
                            memberMap[m.from.id] = m.from;
                          }
                        });
                        const memberCount = Object.keys(memberMap).length;
                        if (memberCount === 0) return null;
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowGroupMembers(true); }}
                            className="text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-1.5 py-0.5 rounded transition-colors"
                          >
                            👥 {memberCount} 人
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => navigateToRequirement(activeReqChat)}
                  className="text-xs text-[var(--accent)] hover:text-white bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shrink-0"
                >{t('mailbox.viewRequirement')}</button>
              </div>
            </div>

            {/* 群聊成员弹窗 */}
            {showGroupMembers && (() => {
              const memberMap = {};
              (reqChatDetail.groupChat || []).forEach(m => {
                if (m.from?.id && m.from.id !== 'system') {
                  memberMap[m.from.id] = m.from;
                }
              });
              const members = Object.values(memberMap);
              return (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] !m-0" onClick={() => setShowGroupMembers(false)}>
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-sm w-full mx-4 overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                      <span className="text-sm font-semibold">👥 群聊成员 ({members.length})</span>
                      <button onClick={() => setShowGroupMembers(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
                    </div>
                    <div className="max-h-[50vh] overflow-auto py-2">
                      {members.map(m => (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 cursor-pointer transition-colors"
                          onClick={() => { setShowGroupMembers(false); setSelectedAgent(m.id); }}
                        >
                          {m.avatar ? (
                            <img src={m.avatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)]" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-xs">🤖</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{m.name}</div>
                            {m.role && <div className="text-[10px] text-[var(--muted)]">{m.role}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Requirement group chat messages area */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {(!reqChatDetail.groupChat || reqChatDetail.groupChat.length === 0) ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-2">💬</div>
                  <p className="text-sm text-[var(--muted)]">{t('reqDetail.chat.noMessages')}</p>
                  <p className="text-xs text-[var(--muted)] mt-1">{t('mailbox.noGroupChatHint')}</p>
                </div>
              ) : (
                groupConsecutiveMessages(
                  reqChatDetail.groupChat,
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
                  return (
                    <div key={`group-${gi}`} className="flex gap-2">
                      {firstMsg.from?.avatar ? (
                        <img
                          src={firstMsg.from.avatar}
                          alt=""
                          className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5 cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all"
                          onClick={() => firstMsg.from?.id && firstMsg.from.id !== 'system' && setSelectedAgent(firstMsg.from.id)}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-xs shrink-0 mt-0.5">
                          🤖
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className={`text-xs font-medium ${firstMsg.from?.id && firstMsg.from.id !== 'system' ? 'cursor-pointer hover:text-[var(--accent)] transition-colors' : ''}`}
                            onClick={() => firstMsg.from?.id && firstMsg.from.id !== 'system' && setSelectedAgent(firstMsg.from.id)}
                          >{firstMsg.from?.name || t('mailbox.system')}</span>
                          {firstMsg.from?.role && (
                            <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1 py-0.5 rounded">{firstMsg.from.role}</span>
                          )}
                          <span className="text-[10px] text-[var(--muted)]">
                            {new Date(firstMsg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        {isMerged ? (
                          /* 合并气泡 */
                          <div className={`rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] bg-[var(--card)] border border-[var(--border)]`}>
                            {group.messages.map((msg, mi) => {
                              const { cleanContent: gc, fileRefs: gfr } = parseFileReferences(msg.content);
                              return (
                                <div key={msg.id}>
                                  {mi > 0 && <div className="border-t border-white/[0.06] my-1.5" />}
                                  <div className="break-words text-sm leading-relaxed chat-markdown">
                                    {renderMentions(cleanMessageContent(gc), agentMap, setSelectedAgent) || (
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                        {cleanMessageContent(gc)}
                                      </ReactMarkdown>
                                    )}
                                  </div>
                                  <FileRefList fileRefs={gfr} />
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* 单条消息 */
                          (() => {
                            const msg = firstMsg;
                            const { cleanContent: groupClean, fileRefs: groupFileRefs } = parseFileReferences(msg.content);
                            return (
                              <div className={`rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] ${
                                msg.type === 'output'
                                  ? 'bg-green-900/20 border border-green-500/20'
                                  : msg.type === 'tool_call'
                                  ? 'bg-purple-900/20 border border-purple-500/20'
                                  : 'bg-[var(--card)] border border-[var(--border)]'
                              }`}>
                                <div className="break-words text-sm leading-relaxed chat-markdown">
                                  {renderMentions(cleanMessageContent(groupClean), agentMap, setSelectedAgent) || (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                      {cleanMessageContent(groupClean)}
                                    </ReactMarkdown>
                                  )}
                                </div>
                                <FileRefList fileRefs={groupFileRefs} />
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <p>{t('mailbox.chatNotExist')}</p>
          </div>
        )}
      </div>

      {/* Employee detail modal */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}

// ============ Sub-components ============



/**
 * Message bubble
 */
function MessageBubble({ isMe, avatar, name, content, time, action, subject, agentId, onClickAvatar, bossAvatar }) {
  const { t } = useI18n();
  const { cleanContent, fileRefs } = parseFileReferences(content);
  return (
    <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {!isMe ? (
        <img
          src={avatar}
          alt=""
          className={`w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5 ${
            agentId ? 'cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all' : ''
          }`}
          onClick={() => agentId && onClickAvatar?.(agentId)}
        />
      ) : (
        bossAvatar ? (
          <img src={bossAvatar} alt="boss" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
            👤
          </div>
        )
      )}
      <div className={`max-w-[min(70%,560px)] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Name + time */}
        <div className={`flex items-center gap-2 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-[var(--muted)]">{name}</span>
          {time && (
            <span className="text-[10px] text-[var(--muted)]/60">
              {formatTime(time, t)}
            </span>
          )}
        </div>
        {/* Subject tag (first message in email) */}
        {subject && (
          <div className="text-[10px] text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded mb-1 inline-block">
            📌 {subject}
          </div>
        )}
        {/* Bubble */}
        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isMe
            ? 'bg-[var(--accent)] text-white rounded-br-sm'
            : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-sm'
        }`}>
          <div className="break-words chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
              {cleanMessageContent(cleanContent)}
            </ReactMarkdown>
          </div>
          <FileRefList fileRefs={fileRefs} />
        </div>
        {/* Action tag */}
        {action && (
          <div className="mt-1 text-[10px] text-blue-400 bg-blue-900/10 px-2 py-0.5 rounded inline-block">
            {action.type === 'task_assigned' && (
              <>
                {t('chat.taskAssigned', { dept: action.departmentName })}
                {action.taskStatus === 'running' && <span className="ml-1 animate-pulse">{t('chat.running')}</span>}
              </>
            )}
            {action.type === 'need_new_department' && t('chat.needNewDept')}
            {action.type === 'create_department' && (
              <>
                {t('chat.creatingDept', { dept: action.departmentName })}
                {action.taskStatus === 'running' && <span className="ml-1 animate-pulse">{t('chat.planningHiring')}</span>}
              </>
            )}
            {action.type === 'department_created' && t('chat.deptCreated', { dept: action.departmentName })}
            {action.type === 'progress_report' && t('chat.progressReport')}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Input box component
 */
function ChatInput({ value, onChange, onSend, onKeyDown, sending, placeholder }) {
  const { t } = useI18n();
  return (
    <div className="px-4 py-3 border-t border-white/[0.06] bg-[var(--card)]">
      <div className="flex gap-2 items-end">
        <textarea
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

// ============ Utility functions ============

/**
 * Build conversation list: secretary pinned on top + employees sorted by latest message desc
 */
function buildConversations(secretary, secretaryHistory, requirements = [], t = (k) => k, agentChatSessions = []) {
  const convs = [];

  // Pin secretary on top
  const lastSecMsg = secretaryHistory.length > 0 ? secretaryHistory[secretaryHistory.length - 1] : null;
  convs.push({
    key: 'secretary',
    type: 'secretary',
    name: secretary?.name || t('setup.defaultSecretary'),
    avatar: secretary?.avatar || getAvatarUrl('secretary'),
    role: t('mailbox.personalSecretary'),
    lastMessage: lastSecMsg ? lastSecMsg.content?.slice(0, 40) : t('mailbox.clickToChat'),
    lastTime: lastSecMsg?.time || null,
    unread: false,
    pinned: true,
  });

  // Requirement group chat sessions (pinned below secretary)
  const activeReqs = requirements.filter(r =>
    r.status === 'in_progress' || r.status === 'planning' || r.status === 'completed' || r.status === 'failed'
  );
  for (const req of activeReqs) {
    const statusEmoji = {
      planning: '📝',
      in_progress: '⚙️',
      completed: '✅',
      failed: '❌',
    };
    convs.push({
      key: `req-${req.id}`,
      type: 'requirement',
      requirementId: req.id,
      name: `📋 ${req.title}`,
      avatar: null, // Use custom icon instead
      role: req.departmentName,
      lastMessage: `${statusEmoji[req.status] || '⏳'} ${req.chatCount || 0} group msgs · ${req.workflow?.completedCount || 0}/${req.workflow?.nodeCount || 0} tasks`,
      lastTime: req.createdAt,
      unread: req.status === 'in_progress',
      pinned: true,
      isRequirement: true,
    });
  }

  // Boss-Agent 1-on-1 private chat sessions (from chatStore)
  const agentChatConvs = [];
  for (const session of agentChatSessions) {
    const lastMsgPreview = session.lastMessageRole === 'boss'
      ? `${t('mailbox.you')}${session.lastMessage || '...'}`
      : session.lastMessage || '...';
    agentChatConvs.push({
      key: `agent-chat-${session.agentId}`,
      type: 'agent-chat',
      agentId: session.agentId,
      name: session.agentName,
      avatar: session.agentAvatar,
      role: session.agentRole,
      agentSignature: session.agentSignature,
      departmentName: session.departmentName,
      lastMessage: lastMsgPreview,
      lastTime: session.lastTime,
      unread: !!session.unread,
      pinned: false,
      totalMessages: session.totalMessages,
    });
  }

  // 按时间排序
  agentChatConvs.sort((a, b) => {
    if (!a.lastTime) return 1;
    if (!b.lastTime) return -1;
    return new Date(b.lastTime) - new Date(a.lastTime);
  });

  return [...convs, ...agentChatConvs];
}

function formatTime(time, t = (k) => k) {
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
