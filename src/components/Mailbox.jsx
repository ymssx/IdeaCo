'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import AgentDetailModal from './AgentDetailModal';
import { useI18n } from '@/lib/i18n';
import GroupChatView from './GroupChatView';
import { MessageBubble, ChatInput, TaskStatusPanel, formatTime } from './ChatShared';
import CachedAvatar from './CachedAvatar';

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
    sendGroupChatMessage,
    sendDeptGroupChatMessage, fetchDeptGroupChat,
  } = useStore();

  const [activeChat, setActiveChat] = useState(null); // { type: 'secretary' } | { type: 'agent-chat', agentId, ... }
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingTargetId, setSendingTargetId] = useState(null); // 追踪正在发送消息的目标ID，防止typing状态串台
  const [secretaryHistory, setSecretaryHistory] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null); // View employee detail
  const [chatFilter, setChatFilter] = useState('all'); // Chat filter: all | group | private | important
  const [requirements, setRequirements] = useState([]); // Requirements list (for group chat sessions)
  const [activeReqChat, setActiveReqChat] = useState(null); // Current active requirement group chat
  const [reqChatDetail, setReqChatDetail] = useState(null); // Requirement group chat detail
  const [activeDeptChat, setActiveDeptChat] = useState(null); // Current active department group chat
  const [deptChatDetail, setDeptChatDetail] = useState(null); // Department group chat detail
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
for (const agent of (dept.members || dept.agents || [])) {
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

  // Department group chat polling
  const deptChatPollRef = useRef(null);
  useEffect(() => {
    if (deptChatPollRef.current) clearInterval(deptChatPollRef.current);
    if (activeDeptChat) {
      const loadDetail = () => {
        fetchDeptGroupChat(activeDeptChat).then(data => {
          if (data) {
            // 合并部门基础信息
            const dept = (company?.departments || []).find(d => d.id === activeDeptChat);
            setDeptChatDetail({
              ...data,
              id: activeDeptChat,
              name: dept?.name || '',
              members: dept?.members || [],
              leader: dept?.leader,
            });
          }
        });
      };
      loadDetail();
      deptChatPollRef.current = setInterval(loadDetail, 3000);
    } else {
      setDeptChatDetail(null);
    }
    return () => {
      if (deptChatPollRef.current) clearInterval(deptChatPollRef.current);
    };
  }, [activeDeptChat]);

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
  const allConversations = buildConversations(secretary, secretaryHistory, requirements, t, agentChatSessions, company?.departments || []);

  // Filter conversations by category
  const conversations = allConversations.filter(conv => {
    if (chatFilter === 'all') return true;
    if (chatFilter === 'group') return conv.type === 'requirement' || conv.type === 'department';
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
    // 记录当前发送目标，防止切换聊天后typing状态串台
    const currentTargetId = activeChat?.type === 'secretary' ? 'secretary'
      : activeChat?.type === 'agent-chat' ? activeChat.agentId
      : activeChat?.type === 'requirement' ? activeChat.id : null;
    setSendingTargetId(currentTargetId);

    // 用户发消息后立即滚动到底部
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      if (activeChat?.type === 'secretary') {
// Optimistic update for boss message
        setSecretaryHistory(prev => [...prev, {
          role: 'boss', content: text, time: new Date().toISOString(),
        }]);
        await chatWithSecretary(text);
        // Secretary replies sync via useEffect
      } else if (activeChat?.type === 'requirement') {
        // 群聊发送由 GroupChatView 组件内部管理，此处不再处理
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
          content: `${t('chat.errorPrefix')}${e.message}`,
          time: new Date().toISOString(),
        }]);
      }
    }
    setSending(false);
    setSendingTargetId(null);
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
      setActiveDeptChat(null);
    } else if (conv.type === 'requirement') {
      setActiveChat({ type: 'requirement', id: conv.requirementId });
      setActiveReqChat(conv.requirementId);
      setActiveDeptChat(null);
    } else if (conv.type === 'department') {
      setActiveChat({ type: 'department', id: conv.departmentId, name: conv.name });
      setActiveDeptChat(conv.departmentId);
      setActiveReqChat(null);
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
      setActiveDeptChat(null);
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
              (conv.type === 'secretary' || (conv.type === 'requirement' && activeChat?.id === conv.requirementId) || (conv.type === 'department' && activeChat?.id === conv.departmentId) || (conv.type === 'agent-chat' && activeChat?.agentId === conv.agentId));

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
                {(conv.isRequirement || conv.isDepartment) && conv.memberAvatars?.length > 0 ? (
                    <div className="w-10 h-10 rounded-xl bg-[var(--border)] overflow-hidden grid gap-[1px] p-[1px]" style={{
                      gridTemplateColumns: `repeat(${conv.memberAvatars.length <= 4 ? 2 : 3}, 1fr)`,
                    }}>
                      {conv.memberAvatars.slice(0, conv.memberAvatars.length <= 4 ? 4 : 9).map((av, i) => (
                        <img key={i} src={av} alt="" className="w-full h-full object-cover rounded-sm bg-[var(--card)]" />
                      ))}
                    </div>
                  ) : conv.isRequirement ? (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/80 to-cyan-600/80 flex items-center justify-center text-sm font-bold">
                      📋
                    </div>
                  ) : conv.isDepartment ? (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/80 to-teal-600/80 flex items-center justify-center text-lg">
                      🏢
                    </div>
                  ) : conv.avatar ? (
                    <img
                      src={conv.avatar}
                      alt={conv.name}
                      className="w-10 h-10 rounded-full bg-[var(--border)]"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-sm">
                      {(conv.name || '?').charAt(0)}
                    </div>
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

              {sending && sendingTargetId === 'secretary' && (
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

            {/* Task status panel */}
            <TaskStatusPanel />

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

              {sending && sendingTargetId === activeChat.agentId && (
                <div className="flex gap-2">
                  {activeChat.agentAvatar ? (
                    <CachedAvatar src={activeChat.agentAvatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0" />
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

            {/* Task status panel */}
            <TaskStatusPanel />

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
                  {(() => {
                    const reqDept = (company?.departments || []).find(d => d.id === reqChatDetail.departmentId);
                    const avatars = reqDept ? (reqDept.members || []).slice(0, 9).map(m => m.avatar).filter(Boolean) : [];
                    return avatars.length > 0 ? (
                      <div className="w-9 h-9 rounded-xl bg-[var(--border)] overflow-hidden grid gap-[1px] p-[1px] shrink-0" style={{
                        gridTemplateColumns: `repeat(${avatars.length <= 4 ? 2 : 3}, 1fr)`,
                      }}>
                        {avatars.map((av, i) => (
                          <img key={i} src={av} alt="" className="w-full h-full object-cover rounded-sm bg-[var(--card)]" />
                        ))}
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/80 to-cyan-600/80 flex items-center justify-center text-sm font-bold shrink-0">
                        📋
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {reqChatDetail.title}
                      {(() => {
                        const stCfg = {
                          pending: { label: t('requirements.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30' },
                          planning: { label: t('requirements.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30' },
                          in_progress: { label: t('requirements.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
                          pending_approval: { label: t('requirements.status.pending_approval'), color: 'text-orange-400', bg: 'bg-orange-900/30' },
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
                            {t('mailbox.membersCount', { n: memberCount })}
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
                      <span className="text-sm font-semibold">{t('mailbox.groupMembers', { n: members.length })}</span>
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
                            <CachedAvatar src={m.avatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)]" />
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

            {/* Requirement group chat - using shared GroupChatView */}
            <GroupChatView
              groupChat={reqChatDetail.groupChat || []}
              agentMap={agentMap}
              bossAvatar={company?.bossAvatar}
              bossName={company?.boss || 'Boss'}
              requirementId={activeReqChat}
              onSendMessage={sendGroupChatMessage}
              fetchDetail={async (reqId) => {
                const detail = await fetchRequirementDetail(reqId);
                if (detail) setReqChatDetail(detail);
                return detail;
              }}
              leaderInfo={(() => {
                const leaderMsg = (reqChatDetail.groupChat || []).find(m => m.from?.id !== 'boss' && m.from?.role !== 'system' && m.type !== 'system');
                return leaderMsg ? { name: leaderMsg.from?.name, avatar: leaderMsg.from?.avatar } : null;
              })()}
              chatEndRef={messagesEndRef}
              embedded
            />
          </>
        ) : activeChat?.type === 'department' && deptChatDetail ? (
          /* Department group chat */
          <>
            {/* Department group chat header */}
            <div className="px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {(deptChatDetail.members || []).length > 0 ? (
                  <div className="w-9 h-9 rounded-xl bg-[var(--border)] overflow-hidden grid gap-[1px] p-[1px] shrink-0" style={{
                    gridTemplateColumns: `repeat(${(deptChatDetail.members || []).length <= 4 ? 2 : 3}, 1fr)`,
                  }}>
                    {(deptChatDetail.members || []).slice(0, 9).map((m, i) => (
                      <img key={i} src={m.avatar} alt="" className="w-full h-full object-cover rounded-sm bg-[var(--card)]" />
                    ))}
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/80 to-teal-600/80 flex items-center justify-center text-sm font-bold shrink-0">
                    🏢
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{t('mailbox.deptGroup', { name: deptChatDetail.name })}</div>
                  <div className="text-[10px] text-[var(--muted)] truncate">
                    {t('mailbox.deptGroupInfo', { count: (deptChatDetail.members || []).length, msgs: (deptChatDetail.groupChat || []).filter(m => m.visibility !== 'flow').length })}
                  </div>
                </div>
              </div>
            </div>

            {/* Department group chat - using shared GroupChatView */}
            <GroupChatView
              groupChat={deptChatDetail.groupChat || []}
              agentMap={agentMap}
              bossAvatar={company?.bossAvatar}
              bossName={company?.boss || 'Boss'}
              requirementId={`dept-${activeDeptChat}`}
              onSendMessage={async (_id, msg) => {
                await sendDeptGroupChatMessage(activeDeptChat, msg);
                // 刷新部门群聊
                const data = await fetchDeptGroupChat(activeDeptChat);
                if (data) {
                  const dept = (company?.departments || []).find(d => d.id === activeDeptChat);
                  setDeptChatDetail({ ...data, id: activeDeptChat, name: dept?.name || '', members: dept?.members || [], leader: dept?.leader });
                }
              }}
              fetchDetail={async () => {
                const data = await fetchDeptGroupChat(activeDeptChat);
                if (data) {
                  const dept = (company?.departments || []).find(d => d.id === activeDeptChat);
                  setDeptChatDetail({ ...data, id: activeDeptChat, name: dept?.name || '', members: dept?.members || [], leader: dept?.leader });
                }
              }}
              leaderInfo={null}
              chatEndRef={messagesEndRef}
              embedded
            />
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

// ============ Utility functions ============

/**
 * Build conversation list: secretary pinned on top + employees sorted by latest message desc
 */
function buildConversations(secretary, secretaryHistory, requirements = [], t = (k) => k, agentChatSessions = [], departments = []) {
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

  // Department group chat sessions (every active department gets one)
  for (const dept of departments) {
    if (dept.status === 'disbanded') continue;
    const deptChat = dept.groupChat || [];
    const lastMsg = deptChat.length > 0 ? deptChat[deptChat.length - 1] : null;
    const visibleMsgs = deptChat.filter(m => m.visibility !== 'flow');
    convs.push({
      key: `dept-${dept.id}`,
      type: 'department',
      departmentId: dept.id,
      name: `🏢 ${dept.name}`,
      avatar: null,
      memberAvatars: (dept.members || []).slice(0, 9).map(m => m.avatar).filter(Boolean),
      role: t('mailbox.membersCount', { n: (dept.members || []).length }),
      lastMessage: lastMsg ? `${lastMsg.from?.name || ''}: ${(lastMsg.content || '').slice(0, 30)}` : t('mailbox.deptGroupChat'),
      lastTime: lastMsg?.time || dept.createdAt,
      unread: visibleMsgs.length > 0,
      pinned: true,
      isDepartment: true,
    });
  }

  // Requirement group chat sessions (pinned below secretary)
  const activeReqs = requirements.filter(r =>
    r.status === 'in_progress' || r.status === 'planning' || r.status === 'pending_approval' || r.status === 'completed' || r.status === 'failed'
  );
  for (const req of activeReqs) {
    const statusEmoji = {
      planning: '📝',
      in_progress: '⚙️',
      pending_approval: '🔍',
      completed: '✅',
      failed: '❌',
    };
    const reqDept = departments.find(d => d.id === req.departmentId);
    const reqMemberAvatars = reqDept ? (reqDept.members || []).slice(0, 9).map(m => m.avatar).filter(Boolean) : [];
    convs.push({
      key: `req-${req.id}`,
      type: 'requirement',
      requirementId: req.id,
      name: `📋 ${req.title}`,
      avatar: null,
      memberAvatars: reqMemberAvatars,
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


