'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/lib/i18n';
import { useStore } from '@/lib/client-store';
import { parseFileReferences, FileRefList } from './FileReference';
import { cleanMessageContent } from './GroupChatView';
import CachedAvatar from './CachedAvatar';

// ============ Markdown 渲染组件 ============

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

// ============ 时间格式化 ============

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

// ============ 消息气泡组件 ============

/**
 * 共享消息气泡组件
 * 支持 Markdown 渲染、文件引用、action 标签
 */
export function MessageBubble({ isMe, avatar, name, content, time, action, subject, agentId, onClickAvatar, bossAvatar, onViewDepartment, onViewRequirement }) {
  const { t } = useI18n();
  const { cleanContent, fileRefs } = parseFileReferences(content);
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
        {/* Name + time */}
        <div className={`flex items-center gap-2 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-[var(--muted)]">{name}</span>
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
            {action.type === 'department_created' && (
              <>
                {t('chat.deptCreated', { dept: action.departmentName })}
                {action.departmentId && onViewDepartment && (
                  <button
                    onClick={() => onViewDepartment(action.departmentId)}
                    className="ml-2 text-blue-300 hover:text-blue-200 underline transition-colors"
                  >
                    {t('chat.viewDepartmentBtn')}
                  </button>
                )}
              </>
            )}
            {action.type === 'secretary_task_completed' && action.requirementId && onViewRequirement && (
              <button
                onClick={() => onViewRequirement(action.requirementId)}
                className="text-blue-300 hover:text-blue-200 underline transition-colors"
              >
                {t('chat.viewRequirementBtn')}
              </button>
            )}
            {action.type === 'progress_report' && t('chat.progressReport')}
            {action.type === 'task_completed' && (
              <>
                {t('chat.progressReport')}
                {action.requirementId && onViewRequirement && (
                  <button
                    onClick={() => onViewRequirement(action.requirementId)}
                    className="ml-2 text-blue-300 hover:text-blue-200 underline transition-colors"
                  >
                    {t('chat.viewRequirementBtn')}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 输入框组件 ============

/**
 * 共享聊天输入框组件
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

// ============ 任务状态面板 ============

/**
 * 共享任务进度/结果面板
 * 当有 runningTaskId 或 taskResult 时显示
 */
export function TaskStatusPanel() {
  const { t } = useI18n();
  const { runningTaskId, taskResult, clearTaskResult, navigateToDepartment, navigateToRequirement } = useStore();

  if (!runningTaskId && !taskResult) return null;

  return (
    <div className="border-t border-[var(--border)] bg-gradient-to-r from-blue-950/40 to-indigo-950/40 shrink-0">
      {runningTaskId && !taskResult && (
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="relative w-5 h-5 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-blue-400/30" />
            <div className="absolute inset-0 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-blue-300">{t('chat.running')}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">{t('chat.taskAssigned', { dept: '...' })}</div>
          </div>
          <div className="flex gap-1">
            <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}
      {taskResult && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{taskResult.error ? '❌' : '✅'}</span>
              <span className="text-xs font-medium text-white">{taskResult.error ? t('chat.errorPrefix') : t('chat.progressReport')}</span>
            </div>
            <button
              onClick={clearTaskResult}
              className="text-[10px] text-[var(--muted)] hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-all"
            >
              ✕
            </button>
          </div>
          {taskResult.error ? (
            <div className="text-xs text-red-300 bg-red-900/20 rounded-lg px-3 py-2 border border-red-500/20">
              {taskResult.error}
            </div>
          ) : (
            <>
              <div className="text-xs text-[var(--foreground)] bg-white/5 rounded-lg px-3 py-2 border border-white/10 max-h-32 overflow-auto">
                {typeof taskResult === 'string' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  }}>{taskResult}</ReactMarkdown>
                ) : (
                  <pre className="whitespace-pre-wrap text-[10px]">{JSON.stringify(taskResult, null, 2)}</pre>
                )}
              </div>
              {/* Quick navigation buttons */}
              <div className="flex gap-2 mt-2">
                {taskResult.departmentId && (
                  <button
                    onClick={() => { navigateToDepartment(taskResult.departmentId); clearTaskResult(); }}
                    className="text-[10px] text-blue-300 hover:text-blue-200 bg-blue-900/30 hover:bg-blue-900/50 px-2.5 py-1 rounded-md border border-blue-500/20 transition-all"
                  >
                    {t('chat.viewDepartmentBtn')}
                  </button>
                )}
                {taskResult.requirementId && (
                  <button
                    onClick={() => { navigateToRequirement(taskResult.requirementId); clearTaskResult(); }}
                    className="text-[10px] text-blue-300 hover:text-blue-200 bg-blue-900/30 hover:bg-blue-900/50 px-2.5 py-1 rounded-md border border-blue-500/20 transition-all"
                  >
                    {t('chat.viewRequirementBtn')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
