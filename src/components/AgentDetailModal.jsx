'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import AgentChatModal from './AgentChatModal';
import AgentSpyModal from './AgentSpyModal';
import ReactMarkdown from 'react-markdown';

export default function AgentDetailModal({ agentId, onClose }) {
  const { t } = useI18n();
  const { fetchAgentDetail } = useStore();
  const [agent, setAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('info');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showSpy, setShowSpy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingDetail(true);
      try {
        const data = await fetchAgentDetail(agentId);
        setAgent(data);
      } catch (e) { /* handled */ }
      setLoadingDetail(false);
    })();
  }, [agentId, fetchAgentDetail]);



  if (loadingDetail) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
        <div className="card p-8 text-center" onClick={e => e.stopPropagation()}>
          <div className="text-2xl animate-pulse">⏳</div>
          <p className="text-sm text-[var(--muted)] mt-2">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
        <div className="card p-8 text-center" onClick={e => e.stopPropagation()}>
          <p>{t('agent.notFound')}</p>
          <button className="btn-secondary mt-4" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'info', label: t('agent.tabs.info') },
    { id: 'memory', label: t('agent.tabs.memory') },
    { id: 'performance', label: t('agent.tabs.performance') },
    { id: 'tasks', label: t('agent.tabs.tasks') },
    { id: 'usage', label: t('agent.tabs.usage') },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
      <div className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-4 pb-4 border-b border-[var(--border)]">
          <div className="relative shrink-0">
            <img src={agent.avatar} alt={agent.name} className="w-16 h-16 rounded-full bg-[var(--border)]" />
            {agent.avgScore >= 80 && (
              <span className="absolute -top-1 -right-1 text-base animate-pulse drop-shadow-lg" title="高绩效员工">🌸</span>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{agent.name}</h2>
              <span className={`status-dot ${agent.status}`} />
              <button
                className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors flex items-center gap-1"
                onClick={() => setShowChat(true)}
              >
                💬 {t('agentChat.chatBtn').replace('💬 ', '')}
              </button>
              <button
                className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors flex items-center gap-1"
                onClick={() => setShowSpy(true)}
              >
                🕵️ {t('agent.spyBtn')}
              </button>
            </div>
            <div className="text-sm text-[var(--muted)]">{agent.role} · {agent.department}</div>
            <div className="text-xs text-[var(--muted)] mt-1">
              {agent.gender === 'female' ? '👩' : '👨'} {agent.age ? t('display.ageYears', { n: agent.age }) : ''}
              {agent.personality?.trait && <span className="ml-2 text-purple-400">· {agent.personality.trait}</span>}
            </div>
            <div className="text-xs text-[var(--muted)] italic mt-1">"{agent.signature}"</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded ${agent.cliBackend ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-900/30 text-blue-400'}`}>
                {agent.cliBackend ? '🖥️ ' : ''}{agent.provider.name}
              </span>
              {agent.avgScore && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  agent.avgScore >= 80 ? 'bg-green-900/30 text-green-400' :
                  agent.avgScore >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                  'bg-red-900/30 text-red-400'
                }`}>
                  {t('agent.avgPerformance', { score: agent.avgScore })}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 pt-3 pb-2 border-b border-[var(--border)]">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                activeTab === t.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--muted)] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto px-0 py-4">
          {activeTab === 'info' && (
            <div className="space-y-4 animate-fade-in">
              {/* 基本信息 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('setup.gender')}</div>
                  <div className="text-sm font-medium">{agent.gender === 'female' ? t('display.genderFemaleText') : t('display.genderMaleText')}</div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('display.ageLabel')}</div>
                  <div className="text-sm font-medium">{agent.age ? t('display.ageYears', { n: agent.age }) : t('display.ageUnknown')}</div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('display.personality')}</div>
                  <div className="text-sm font-medium text-purple-400">{agent.personality?.trait || t('display.ageUnknown')}</div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.rolePrompt')}</h4>
                <div className="bg-[var(--background)] p-3 rounded-lg text-sm whitespace-pre-wrap max-h-40 overflow-auto">
                  {agent.prompt}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.skills')}</h4>
                <div className="flex flex-wrap gap-2">
                  {agent.skills.map((s, i) => (
                    <span key={i} className="text-sm bg-[var(--accent)]/10 text-[var(--accent)] px-2 py-1 rounded-lg">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <h4 className="text-sm font-medium mb-2 text-yellow-400">{t('agent.shortTermMemory', { n: agent.memory.shortTermCount })}</h4>
                <div className="space-y-1.5">
                  {agent.memory.shortTerm.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">{t('agent.noShortTerm')}</p>
                  ) : agent.memory.shortTerm.map((m) => (
                    <div key={m.id} className="bg-yellow-900/10 border border-yellow-900/20 rounded-lg p-2 text-xs">
                      <span className="text-yellow-500">[{m.category}]</span> {m.content}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 text-purple-400">{t('agent.longTermMemory', { n: agent.memory.longTermCount })}</h4>
                <div className="space-y-1.5 max-h-60 overflow-auto">
                  {agent.memory.longTerm.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">{t('agent.noLongTerm')}</p>
                  ) : agent.memory.longTerm.map((m) => (
                    <div key={m.id} className="bg-purple-900/10 border border-purple-900/20 rounded-lg p-2 text-xs">
                      <span className="text-purple-500">[{m.category}]</span> {m.content}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'performance' && (
            <div className="space-y-3 animate-fade-in">
              {/* 激励展示区 */}
              {agent.incentives?.length > 0 && (
                <div className="bg-gradient-to-r from-pink-900/15 to-orange-900/15 border border-pink-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🌸</span>
                    <span className="text-sm font-semibold text-pink-300">{t('agent.incentiveTitle', { n: agent.incentives.length })}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {agent.incentives.map((inc, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-pink-500/10 border border-pink-500/15 rounded-lg px-2.5 py-1.5">
                        <span className="text-sm">{inc.emoji}</span>
                        <div>
                          <div className="text-xs font-medium text-pink-200">{t(`agent.incentive_${inc.label}`)}</div>
                          <div className="text-[10px] text-pink-300/60 truncate max-w-[120px]" title={inc.task}>{inc.task}</div>
                        </div>
                        <span className="text-[10px] text-pink-400 font-bold ml-1">{t('agent.scorePoints', { score: inc.score })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {agent.reviews.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t('agent.noPerformance')}</p>
              ) : agent.reviews.map((r) => (
                <div key={r.id} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{r.task}</span>
                    <span className={`text-sm font-bold ${
                      r.overallScore >= 80 ? 'text-green-400' :
                      r.overallScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {t('agent.score', { score: r.overallScore, level: r.level })}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {Object.entries(r.scores).map(([dim, score]) => (
                      <div key={dim} className="text-center">
                        <div className="text-[10px] text-[var(--muted)]">{dim}</div>
                        <div className="text-xs font-medium">{score}</div>
                      </div>
                    ))}
                  </div>
                  {r.comment && <p className="text-xs text-[var(--muted)]">📝 {r.comment}</p>}
                  {r.selfReflection && <p className="text-xs text-blue-400 mt-1">💭 {r.selfReflection}</p>}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-2 animate-fade-in">
              {agent.taskHistory.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t('agent.noTasks')}</p>
              ) : agent.taskHistory.map((t, i) => (
                <div key={i} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-sm flex items-center gap-3">
                  <span>{t.success ? '✅' : '❌'}</span>
                  <div className="flex-1">
                    <div className="font-medium">{t.task}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {t.toolsUsed > 0 && `🔧 ${t.toolsUsed} tool calls`}
                      {t.completedAt && ` · ${new Date(t.completedAt).toLocaleString()}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('agent.totalCost')}</div>
                  <div className="text-2xl font-bold text-green-400">
                    ${(agent.tokenUsage?.totalCost || 0).toFixed(4)}
                  </div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('agent.totalTokens')}</div>
                  <div className="text-2xl font-bold text-blue-400">
                    {(agent.tokenUsage?.totalTokens || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">Prompt Tokens</div>
                  <div className="text-lg font-bold text-purple-400">
                    {(agent.tokenUsage?.promptTokens || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">Completion Tokens</div>
                  <div className="text-lg font-bold text-orange-400">
                    {(agent.tokenUsage?.completionTokens || 0).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                <div className="text-xs text-[var(--muted)] mb-1">{t('agent.callCount')}</div>
                <div className="text-lg font-bold">
                  {agent.tokenUsage?.callCount || 0} {t('agent.callUnit')}
                </div>
              </div>
              <div className="text-xs text-[var(--muted)]">
                💡 {t('agent.usageHint')}
              </div>
            </div>
          )}
        </div>

        {/* Agent Chat Modal */}
        {showChat && agent && (
          <AgentChatModal
            agentId={agent.id}
            agentName={agent.name}
            agentAvatar={agent.avatar}
            agentRole={agent.role}
            agentSignature={agent.signature}
            agentDepartment={agent.department}
            onClose={() => setShowChat(false)}
          />
        )}

        {/* Agent Spy Modal — 偷窥IM */}
        {showSpy && agent && (
          <AgentSpyModal
            agentId={agent.id}
            agentName={agent.name}
            agentAvatar={agent.avatar}
            onClose={() => setShowSpy(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * AgentMention - 渲染 @Name 为高亮标签
 */
function AgentMention({ content }) {
  if (!content || typeof content !== 'string') return <span>{content}</span>;

  // 匹配 @Name 格式（支持中英文名字、空格）
  const parts = content.split(/(@[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5\s]*?)(?=\s|$|[,，.。!！?？])/g);

  return (
    <span className="break-words">
      {parts.map((part, i) => {
        if (part && part.startsWith('@')) {
          return (
            <span key={i} className="inline-flex items-center bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded text-xs font-medium mx-0.5">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
