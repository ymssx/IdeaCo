'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';

export default function AgentDetailModal({ agentId, onClose }) {
  const { fetchAgentDetail } = useStore();
  const [agent, setAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('info');
  const [loadingDetail, setLoadingDetail] = useState(true);

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
          <p className="text-sm text-[var(--muted)] mt-2">加载中...</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
        <div className="card p-8 text-center" onClick={e => e.stopPropagation()}>
          <p>员工信息未找到</p>
          <button className="btn-secondary mt-4" onClick={onClose}>关闭</button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'info', label: '📋 基本信息' },
    { id: 'memory', label: '🧠 记忆' },
    { id: 'performance', label: '📊 绩效' },
    { id: 'tasks', label: '📝 任务历史' },
    { id: 'usage', label: '💰 消耗' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
      <div className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-start gap-4 pb-4 border-b border-[var(--border)]">
          <img src={agent.avatar} alt={agent.name} className="w-16 h-16 rounded-full bg-[var(--border)]" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{agent.name}</h2>
              <span className={`status-dot ${agent.status}`} />
            </div>
            <div className="text-sm text-[var(--muted)]">{agent.role} · {agent.department}</div>
            <div className="text-xs text-[var(--muted)] italic mt-1">"{agent.signature}"</div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded">{agent.provider.name}</span>
              {agent.avgScore && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  agent.avgScore >= 80 ? 'bg-green-900/30 text-green-400' :
                  agent.avgScore >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                  'bg-red-900/30 text-red-400'
                }`}>
                  平均绩效 {agent.avgScore}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
        </div>

        {/* 标签页 */}
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

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'info' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">角色 Prompt</h4>
                <div className="bg-[var(--background)] p-3 rounded-lg text-sm whitespace-pre-wrap max-h-40 overflow-auto">
                  {agent.prompt}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">技能</h4>
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
                <h4 className="text-sm font-medium mb-2 text-yellow-400">⚡ 短期记忆 ({agent.memory.shortTermCount})</h4>
                <div className="space-y-1.5">
                  {agent.memory.shortTerm.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">暂无短期记忆</p>
                  ) : agent.memory.shortTerm.map((m) => (
                    <div key={m.id} className="bg-yellow-900/10 border border-yellow-900/20 rounded-lg p-2 text-xs">
                      <span className="text-yellow-500">[{m.category}]</span> {m.content}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 text-purple-400">💾 长期记忆 ({agent.memory.longTermCount})</h4>
                <div className="space-y-1.5 max-h-60 overflow-auto">
                  {agent.memory.longTerm.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">暂无长期记忆</p>
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
              {agent.reviews.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">暂无绩效记录</p>
              ) : agent.reviews.map((r) => (
                <div key={r.id} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{r.task}</span>
                    <span className={`text-sm font-bold ${
                      r.overallScore >= 80 ? 'text-green-400' :
                      r.overallScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {r.overallScore}分 {r.level}
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
                <p className="text-sm text-[var(--muted)]">暂无任务记录</p>
              ) : agent.taskHistory.map((t, i) => (
                <div key={i} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-sm flex items-center gap-3">
                  <span>{t.success ? '✅' : '❌'}</span>
                  <div className="flex-1">
                    <div className="font-medium">{t.task}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {t.toolsUsed > 0 && `🔧 ${t.toolsUsed}次工具调用`}
                      {t.completedAt && ` · ${new Date(t.completedAt).toLocaleString('zh')}`}
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
                  <div className="text-xs text-[var(--muted)] mb-1">总费用</div>
                  <div className="text-2xl font-bold text-green-400">
                    ${(agent.tokenUsage?.totalCost || 0).toFixed(4)}
                  </div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">总 Token</div>
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
                <div className="text-xs text-[var(--muted)] mb-1">LLM 调用次数</div>
                <div className="text-lg font-bold">
                  {agent.tokenUsage?.callCount || 0} 次
                </div>
              </div>
              <div className="text-xs text-[var(--muted)]">
                💡 消耗数据基于实际 LLM API 调用返回的 usage 信息累计
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
