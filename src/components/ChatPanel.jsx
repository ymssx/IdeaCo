'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatPanel() {
  const { company, chatWithSecretary, chatOpen, setChatOpen } = useStore();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [localHistory, setLocalHistory] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (company?.chatHistory) {
      setLocalHistory(company.chatHistory);
    }
  }, [company?.chatHistory]);

  // 自动滚到底部：消息更新 或 面板打开时
  useEffect(() => {
    if (chatOpen) {
      // 用 setTimeout 确保 DOM 渲染完成后再滚动
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [localHistory, chatOpen]);

  if (!company || !chatOpen) return null;

  const secretary = company.secretary;

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);

    // 乐观更新
    setLocalHistory(prev => [...prev, { role: 'boss', content: msg, time: new Date().toISOString() }]);

    try {
      await chatWithSecretary(msg);
      // 秘书回复会通过 chatHistory -> useEffect 自动同步到 localHistory
    } catch (e) {
      setLocalHistory(prev => [...prev, {
        role: 'secretary',
        content: `抱歉，处理消息时出错：${e.message}`,
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
    <div className="fixed bottom-4 right-4 w-96 h-[520px] bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col z-50 animate-fade-in overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-3 border-b border-[var(--border)] bg-gradient-to-r from-blue-900/30 to-purple-900/30">
        <img
          src={secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
          alt="秘书"
          className="w-9 h-9 rounded-full bg-[var(--border)]"
        />
        <div className="flex-1">
          <div className="text-sm font-semibold">{secretary?.name || '小秘'}</div>
          <div className="text-[10px] text-[var(--muted)]">专属秘书 · 在线</div>
        </div>
        <button
          onClick={() => setChatOpen(false)}
          className="text-[var(--muted)] hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 欢迎消息 */}
        {localHistory.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">💬</div>
            <p className="text-sm text-[var(--muted)]">
              和{secretary?.name || '秘书'}说点什么吧
            </p>
            <div className="mt-3 space-y-1">
              {['查看各部门进度', '帮我开发一个计算器', '公司现在什么情况？'].map((q, i) => (
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
          <div key={i} className={`flex gap-2 ${msg.role === 'boss' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'secretary' && (
              <img
                src={secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
                alt="秘书"
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
                    // 自定义渲染组件，适配聊天气泡样式
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
                  {msg.content}
                </ReactMarkdown>
              </div>
              {msg.action && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-blue-300">
                  {msg.action.type === 'task_assigned' && (
                    <>📋 已分配至: {msg.action.departmentName}{msg.action.taskStatus === 'running' && <span className="ml-1 animate-pulse">⚙️ 执行中...</span>}</>
                  )}
                  {msg.action.type === 'need_new_department' && `💡 建议开设新部门`}
                  {msg.action.type === 'progress_report' && `📊 进度汇报完成`}
                </div>
              )}
            </div>
            {msg.role === 'boss' && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                👤
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
              alt="秘书"
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl rounded-bl-sm px-3 py-2 text-sm">
<span className="animate-pulse text-[var(--muted)]">正在敲键盘中...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-t border-[var(--border)]">
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            placeholder="跟秘书说点什么..."
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
