'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import AgentDetailModal from './AgentDetailModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 聊天气泡中的 Markdown 渲染组件映射
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
 * 清理消息内容：过滤掉LLM泄漏的内部标签（如DeepSeek的DSML工具调用格式）
 */
function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  // 移除 <｜DSML｜...> 系列标签及其包裹的工具调用内容
  // 匹配完整的DSML工具调用块（从 <｜DSML｜function_calls> 到消息末尾，因为通常后面都是工具调用内容）
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  // 也处理可能的半角变体
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  // 移除其他常见的LLM内部标签泄漏
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content; // 如果清理后为空，返回原内容
}

/**
 * IM 聊天界面 - 飞书风格
 * 左侧会话列表（秘书置顶），右侧对话气泡
 */
export default function Mailbox() {
  const {
    company, replyMail, markMailRead, markAllMailRead,
    chatWithSecretary, chatOpen, setChatOpen,
    navigateToRequirement, fetchRequirements, fetchRequirementDetail,
  } = useStore();

  const [activeChat, setActiveChat] = useState(null); // { type: 'secretary' } | { type: 'mail', id: mailId }
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [secretaryHistory, setSecretaryHistory] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null); // 查看员工详情
  const [chatFilter, setChatFilter] = useState('all'); // 会话分类: all | group | private | important
  const [requirements, setRequirements] = useState([]); // 需求列表（用于群聊会话）
  const [activeReqChat, setActiveReqChat] = useState(null); // 当前活跃的需求群聊
  const [reqChatDetail, setReqChatDetail] = useState(null); // 需求群聊详情
  const reqChatPollRef = useRef(null);
  const messagesEndRef = useRef(null);

  if (!company) return null;

  const mails = company.mailbox || [];
  const secretary = company.secretary;
  const unread = mails.filter(m => !m.read).length;

  // 加载需求列表（用于显示群聊会话）
  useEffect(() => {
    fetchRequirements().then(setRequirements);
    const timer = setInterval(() => {
      fetchRequirements().then(setRequirements);
    }, 10000);
    return () => clearInterval(timer);
  }, [company]);

  // 需求群聊轮询
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

  // 同步秘书聊天记录
  useEffect(() => {
    if (company?.chatHistory) {
      setSecretaryHistory(company.chatHistory);
    }
  }, [company?.chatHistory]);

  // 自动滚到底部：切换会话、消息更新、群聊内容加载时
  useEffect(() => {
    // 用 setTimeout 确保 DOM 渲染完成后再滚动
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [activeChat, secretaryHistory, mails, reqChatDetail]);

  // 选中秘书时关闭 ChatPanel 避免冲突
  useEffect(() => {
    if (activeChat?.type === 'secretary' && chatOpen) {
      setChatOpen(false);
    }
  }, [activeChat]);

  // 构建会话列表：按最新消息时间排序
  const allConversations = buildConversations(mails, secretary, secretaryHistory, requirements);

  // 按分类过滤会话
  const conversations = allConversations.filter(conv => {
    if (chatFilter === 'all') return true;
    if (chatFilter === 'group') return conv.type === 'requirement';
    if (chatFilter === 'private') return conv.type === 'mail' || conv.type === 'secretary';
    if (chatFilter === 'important') return conv.type === 'secretary' || conv.unread || conv.type === 'requirement';
    return true;
  });

  // 获取当前活跃的聊天
  const currentMail = activeChat?.type === 'mail'
    ? mails.find(m => m.id === activeChat.id)
    : null;

  // 发送消息
  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      if (activeChat?.type === 'secretary') {
        // 乐观更新 boss 消息
        setSecretaryHistory(prev => [...prev, {
          role: 'boss', content: text, time: new Date().toISOString(),
        }]);
        await chatWithSecretary(text);
        // 秘书回复通过 useEffect 同步
      } else if (activeChat?.type === 'mail' && currentMail) {
        // 乐观更新：先在本地立即显示 boss 消息
        const { company: localCompany } = useStore.getState();
        if (localCompany?.mailbox) {
          const localMail = localCompany.mailbox.find(m => m.id === currentMail.id);
          if (localMail) {
            if (!localMail.replies) localMail.replies = [];
            localMail.replies.push({
              from: 'boss',
              content: text,
              time: new Date().toISOString(),
            });
            useStore.setState({ company: { ...localCompany } });
          }
        }
        await replyMail(currentMail.id, text);
      }
    } catch (e) {
      if (activeChat?.type === 'secretary') {
        setSecretaryHistory(prev => [...prev, {
          role: 'secretary',
          content: `抱歉，处理消息时出错：${e.message}`,
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
    } else {
      setActiveChat({ type: 'mail', id: conv.id });
      setActiveReqChat(null);
      // 标记该员工所有未读邮件为已读（不仅仅是最新的一封）
      if (conv.unread) {
        const agentMails = mails.filter(m => m.from.id === conv.fromAgentId);
        for (const m of agentMails) {
          if (!m.read) markMailRead(m.id);
        }
      }
    }
    setInputText('');
  };

  return (
    <div className="flex h-full animate-fade-in">
      {/* 左侧会话列表 */}
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col bg-[#0d0d0d]">
        {/* 搜索栏 */}
        <div className="border-b border-white/[0.06]">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="text-sm font-semibold leading-none">💬 消息</h2>
            {unread > 0 && (
              <button
                className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors leading-none"
                onClick={markAllMailRead}
              >
                全部已读
              </button>
            )}
          </div>
          {/* 分类 Tab */}
          <div className="flex px-3 pb-2 gap-1">
            {[
              { key: 'all', label: '全部' },
              { key: 'group', label: '群聊' },
              { key: 'private', label: '私聊' },
              { key: 'important', label: '重要' },
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

        {/* 会话列表 */}
        <div className="flex-1 overflow-auto">
          {conversations.map((conv) => {
            const isActive = activeChat?.type === conv.type &&
              (conv.type === 'secretary' || activeChat?.id === conv.id || (conv.type === 'requirement' && activeChat?.id === conv.requirementId));

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
                {/* 头像 */}
                <div className="relative shrink-0">
                  {conv.isRequirement ? (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-lg">
                      💬
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

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate ${conv.unread ? 'font-semibold' : 'font-medium'}`}>
                      {conv.name}
                      {conv.pinned && <span className="ml-1 text-[10px] text-yellow-400">📌</span>}
                    </span>
                    <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">
                      {formatTime(conv.lastTime)}
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
              <p className="text-xs">还没有员工消息</p>
              <p className="text-[10px] mt-1">开设部门招人后，员工会来打招呼</p>
            </div>
          )}
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div className="flex-1 flex flex-col bg-[var(--background)] min-w-0 overflow-hidden">
        {!activeChat ? (
          /* 未选中任何会话 */
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg font-medium">选择一个对话</p>
              <p className="text-sm mt-1">点击左侧的联系人开始聊天</p>
            </div>
          </div>
        ) : activeChat.type === 'secretary' ? (
          /* 秘书聊天 */
          <>
            {/* 秘书聊天头部 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <img
                src={secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
                alt="秘书"
                className="w-9 h-9 rounded-full bg-[var(--border)]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  {secretary?.name || '小秘'}
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-[10px] text-[var(--muted)] font-normal">专属秘书</span>
                </div>
                {secretary?.signature && (
                  <div className="text-[10px] text-[var(--muted)] italic truncate" title={secretary.signature}>"{secretary.signature}"</div>
                )}
              </div>
            </div>

            {/* 秘书消息区 */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {secretaryHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-2">💬</div>
                  <p className="text-sm text-[var(--muted)]">和{secretary?.name || '秘书'}说点什么吧</p>
                  <div className="mt-3 space-y-1 max-w-xs mx-auto">
                    {['查看各部门进度', '帮我开发一个计算器', '公司现在什么情况？'].map((q, i) => (
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
                  avatar={msg.role === 'secretary' ? (secretary?.avatar || getAvatarUrl('secretary', 'bottts')) : null}
                  name={msg.role === 'boss' ? company.boss : (secretary?.name || '小秘')}
                  content={msg.content}
                  time={msg.time}
                  action={msg.action}
                  agentId={null}
                  onClickAvatar={null}
                />
              ))}

              {sending && activeChat.type === 'secretary' && (
                <div className="flex gap-2">
                  <img
                    src={secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
                    alt="秘书"
                    className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0"
                  />
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
<span className="animate-pulse text-[var(--muted)]">正在敲键盘中...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 秘书输入框 */}
            <ChatInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              sending={sending}
              placeholder={`跟${secretary?.name || '秘书'}说点什么...`}
            />
          </>
        ) : currentMail ? (
          /* 员工聊天 */
          <>
            {/* 员工聊天头部 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <img
                src={currentMail.from.avatar}
                alt={currentMail.from.name}
                className="w-9 h-9 rounded-full bg-[var(--border)] cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-all"
                onClick={() => currentMail.from.id && setSelectedAgent(currentMail.from.id)}
                title="查看员工详情"
              />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  {currentMail.from.name}
                  <span className="text-[10px] text-[var(--muted)] font-normal">{currentMail.from.role}{currentMail.from.department ? ` · ${currentMail.from.department}` : ''}</span>
                </div>
                {currentMail.from.signature && (
                  <div className="text-[10px] text-[var(--muted)] italic truncate" title={currentMail.from.signature}>"{currentMail.from.signature}"</div>
                )}
              </div>
            </div>

            {/* 员工消息区 - 将邮件内容+回复渲染为气泡 */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {/* 初始邮件 = 员工发的第一条消息 */}
              <MessageBubble
                isMe={false}
                avatar={currentMail.from.avatar}
                name={currentMail.from.name}
                content={currentMail.content}
                time={currentMail.time}
                subject={currentMail.subject}
                agentId={currentMail.from.id}
                onClickAvatar={setSelectedAgent}
              />

              {/* 回复历史 = 对话气泡 */}
              {currentMail.replies?.map((reply, i) => (
                <MessageBubble
                  key={i}
                  isMe={reply.from === 'boss'}
                  avatar={reply.from !== 'boss' ? currentMail.from.avatar : null}
                  name={reply.from === 'boss' ? company.boss : reply.from}
                  content={reply.content}
                  time={reply.time}
                  agentId={reply.from !== 'boss' ? currentMail.from.id : null}
                  onClickAvatar={setSelectedAgent}
                />
              ))}

              {sending && activeChat.type === 'mail' && (
                <div className="flex gap-2">
                  <img
                    src={currentMail.from.avatar}
                    alt=""
                    className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0"
                  />
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
                    <span className="animate-pulse text-[var(--muted)]">正在回复...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 员工输入框 */}
            <ChatInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              sending={sending}
              placeholder={`回复 ${currentMail.from.name}...`}
            />
          </>
        ) : activeChat?.type === 'requirement' && reqChatDetail ? (
          /* 需求群聊 */
          <>
            {/* 需求群聊头部 */}
            <div className="px-4 py-3 border-b border-white/[0.06] bg-[var(--card)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-lg shrink-0">
                    💬
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {reqChatDetail.title}
                      {(() => {
                        const stCfg = {
                          pending: { label: '待处理', color: 'text-gray-400', bg: 'bg-gray-900/30' },
                          planning: { label: '规划中', color: 'text-blue-400', bg: 'bg-blue-900/30' },
                          in_progress: { label: '执行中', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
                          completed: { label: '已完成', color: 'text-green-400', bg: 'bg-green-900/30' },
                          failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-900/30' },
                        };
                        const s = stCfg[reqChatDetail.status] || stCfg.pending;
                        return <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.color}`}>{s.label}</span>;
                      })()}
                    </div>
                    <div className="text-[10px] text-[var(--muted)] truncate">
                      🏢 {reqChatDetail.departmentName} · {reqChatDetail.groupChat?.length || 0} 条消息
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => navigateToRequirement(activeReqChat)}
                  className="text-xs text-[var(--accent)] hover:text-white bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shrink-0"
                >
                  📋 查看需求详情 →
                </button>
              </div>
            </div>

            {/* 需求群聊消息区 */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {(!reqChatDetail.groupChat || reqChatDetail.groupChat.length === 0) ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-2">💬</div>
                  <p className="text-sm text-[var(--muted)]">暂无群聊消息</p>
                  <p className="text-xs text-[var(--muted)] mt-1">任务执行时员工的沟通消息会在这里显示</p>
                </div>
              ) : (
                reqChatDetail.groupChat.map((msg) => {
                  if (msg.type === 'system') {
                    return (
                      <div key={msg.id} className="text-center">
                        <span className="text-[10px] text-[var(--muted)] bg-white/5 px-3 py-1 rounded-full">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} className="flex gap-2">
                      {msg.from?.avatar ? (
                        <img src={msg.from.avatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-xs shrink-0 mt-0.5">
                          🤖
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium">{msg.from?.name || '系统'}</span>
                          {msg.from?.role && (
                            <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1 py-0.5 rounded">{msg.from.role}</span>
                          )}
                          <span className="text-[10px] text-[var(--muted)]">
                            {new Date(msg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <div className={`rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[min(85%,600px)] ${
                          msg.type === 'output'
                            ? 'bg-green-900/20 border border-green-500/20'
                            : msg.type === 'tool_call'
                            ? 'bg-purple-900/20 border border-purple-500/20'
                            : 'bg-[var(--card)] border border-[var(--border)]'
                        }`}>
                        <div className="break-words text-sm leading-relaxed chat-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                            {cleanMessageContent(msg.content)}
                          </ReactMarkdown>
                        </div>
                        </div>
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
            <p>该会话不存在</p>
          </div>
        )}
      </div>

      {/* 员工详情弹窗 */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}

// ============ 子组件 ============



/**
 * 消息气泡
 */
function MessageBubble({ isMe, avatar, name, content, time, action, subject, agentId, onClickAvatar }) {
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
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
          👤
        </div>
      )}
      <div className={`max-w-[min(70%,560px)] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* 名字 + 时间 */}
        <div className={`flex items-center gap-2 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-[var(--muted)]">{name}</span>
          {time && (
            <span className="text-[10px] text-[var(--muted)]/60">
              {formatTime(time)}
            </span>
          )}
        </div>
        {/* 主题标签（邮件首条消息） */}
        {subject && (
          <div className="text-[10px] text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded mb-1 inline-block">
            📌 {subject}
          </div>
        )}
        {/* 气泡 */}
        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isMe
            ? 'bg-[var(--accent)] text-white rounded-br-sm'
            : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-sm'
        }`}>
          <div className="break-words chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
              {cleanMessageContent(content)}
            </ReactMarkdown>
          </div>
        </div>
        {/* action 标签 */}
        {action && (
          <div className="mt-1 text-[10px] text-blue-400 bg-blue-900/10 px-2 py-0.5 rounded inline-block">
            {action.type === 'task_assigned' && (
              <>
                📋 已分配至: {action.departmentName}
                {action.taskStatus === 'running' && <span className="ml-1 animate-pulse">⚙️ 执行中...</span>}
              </>
            )}
            {action.type === 'need_new_department' && `💡 建议开设新部门`}
            {action.type === 'create_department' && (
              <>
                🏗️ 正在创建部门: {action.departmentName}
                {action.taskStatus === 'running' && <span className="ml-1 animate-pulse">⚙️ 规划招聘中...</span>}
              </>
            )}
            {action.type === 'department_created' && `🎉 部门「${action.departmentName}」已创建`}
            {action.type === 'progress_report' && `📊 进度汇报完成`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 输入框组件
 */
function ChatInput({ value, onChange, onSend, onKeyDown, sending, placeholder }) {
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
          {sending ? '⏳' : '发送'}
        </button>
      </div>
    </div>
  );
}

// ============ 工具函数 ============

/**
 * 构建会话列表：秘书置顶 + 员工按最新消息时间降序
 */
function buildConversations(mails, secretary, secretaryHistory, requirements = []) {
  const convs = [];

  // 秘书置顶
  const lastSecMsg = secretaryHistory.length > 0 ? secretaryHistory[secretaryHistory.length - 1] : null;
  convs.push({
    key: 'secretary',
    type: 'secretary',
    name: secretary?.name || '小秘',
    avatar: secretary?.avatar || getAvatarUrl('secretary', 'bottts'),
    role: '专属秘书',
    lastMessage: lastSecMsg ? lastSecMsg.content?.slice(0, 40) : '点击开始对话',
    lastTime: lastSecMsg?.time || null,
    unread: false,
    pinned: true,
  });

  // 需求群聊会话（置顶在秘书下方）
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
      avatar: null, // 用自定义图标代替
      role: req.departmentName,
      lastMessage: `${statusEmoji[req.status] || '⏳'} ${req.chatCount || 0}条群聊 · ${req.workflow?.completedCount || 0}/${req.workflow?.nodeCount || 0}任务`,
      lastTime: req.createdAt,
      unread: req.status === 'in_progress',
      pinned: true,
      isRequirement: true,
    });
  }

  // 员工会话：以发件人分组，取最新的邮件作为会话
  const agentMap = new Map();
  for (const mail of mails) {
    const agentId = mail.from.id;
    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, []);
    }
    agentMap.get(agentId).push(mail);
  }

  // 按最新消息时间排序
  const agentConvs = [];
  for (const [agentId, agentMails] of agentMap) {
    // 找最新的时间（可能是邮件时间或最新回复时间）
    let latestTime = null;
    let latestMail = null;
    let hasUnread = false;

    for (const mail of agentMails) {
      const mailLatest = getLatestTimeFromMail(mail);
      if (!latestTime || new Date(mailLatest) > new Date(latestTime)) {
        latestTime = mailLatest;
        latestMail = mail;
      }
      if (!mail.read) hasUnread = true;
    }

    const lastReply = latestMail.replies?.length > 0
      ? latestMail.replies[latestMail.replies.length - 1]
      : null;

    const lastMsg = lastReply
      ? `${lastReply.from === 'boss' ? '你: ' : ''}${lastReply.content?.slice(0, 30)}`
      : latestMail.content?.slice(0, 30);

    agentConvs.push({
      key: `mail-${latestMail.id}`,
      type: 'mail',
      id: latestMail.id,
      fromAgentId: agentId,
      name: latestMail.from.name,
      avatar: latestMail.from.avatar,
      role: latestMail.from.role,
      lastMessage: lastMsg || '...',
      lastTime: latestTime,
      unread: hasUnread,
      read: latestMail.read,
      pinned: false,
      mailCount: agentMails.length,
    });
  }

  // 按时间降序排列
  agentConvs.sort((a, b) => {
    if (!a.lastTime) return 1;
    if (!b.lastTime) return -1;
    return new Date(b.lastTime) - new Date(a.lastTime);
  });

  return [...convs, ...agentConvs];
}

function getLatestTimeFromMail(mail) {
  let latest = mail.time;
  if (mail.replies?.length > 0) {
    const lastReply = mail.replies[mail.replies.length - 1];
    if (lastReply.time && new Date(lastReply.time) > new Date(latest)) {
      latest = lastReply.time;
    }
  }
  return latest;
}

function formatTime(time) {
  if (!time) return '';
  const d = new Date(time);
  const now = new Date();
  const diff = now - d;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('zh', { month: 'short', day: 'numeric' });
}
