'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import AgentChatModal from './AgentChatModal';
import AgentSpyModal from './AgentSpyModal';
import ReactMarkdown from 'react-markdown';
import CachedAvatar from './CachedAvatar';

export default function AgentDetailModal({ agentId, onClose }) {
  const { t } = useI18n();
  const { fetchAgentDetail, updateAgent } = useStore();
  const [agent, setAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('info');
  const [memorySubTab, setMemorySubTab] = useState('personal');
  const [soulSection, setSoulSection] = useState('memory');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showSpy, setShowSpy] = useState(false);

  // Config tab state
  const [configProviderId, setConfigProviderId] = useState('');
  const [configPrompt, setConfigPrompt] = useState('');
  const [configCustomPrompt, setConfigCustomPrompt] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState(null); // { type: 'ok' | 'err', text }

  useEffect(() => {
    (async () => {
      setLoadingDetail(true);
      try {
        const data = await fetchAgentDetail(agentId);
        setAgent(data);
        // Initialize config form from fetched data
        // If the current provider is not in availableProviders (e.g. CLI backend expired),
        // default to the first available provider so user can save immediately
        const currentPid = data.provider?.id || '';
        const isCurrentAvailable = (data.availableProviders || []).some(p => p.id === currentPid);
        setConfigProviderId(isCurrentAvailable ? currentPid : (data.availableProviders?.[0]?.id || ''));
        setConfigPrompt(data.prompt || '');
        setConfigCustomPrompt(data.customPrompt || '');
      } catch (e) { /* handled */ }
      setLoadingDetail(false);
    })();
  }, [agentId, fetchAgentDetail]);



  const handleSaveConfig = useCallback(async () => {
    if (!agent) return;
    setConfigSaving(true);
    setConfigMsg(null);
    try {
      const updates = {};
      if (configProviderId && configProviderId !== agent.provider?.id) {
        updates.providerId = configProviderId;
      }
      if (configPrompt !== agent.prompt) {
        updates.prompt = configPrompt;
      }
      if (configCustomPrompt !== (agent.customPrompt || '')) {
        updates.customPrompt = configCustomPrompt;
      }
      if (Object.keys(updates).length === 0) {
        setConfigSaving(false);
        return;
      }
      const result = await updateAgent(agent.id, updates);
      // Update local state to reflect changes
      setAgent(prev => ({
        ...prev,
        provider: result.provider || prev.provider,
        prompt: result.prompt ?? prev.prompt,
        customPrompt: result.customPrompt ?? prev.customPrompt,
        signature: result.signature ?? prev.signature,
        personalityBio: result.personalityBio ?? prev.personalityBio,
      }));
      setConfigMsg({ type: 'ok', text: t('agent.configSaved') });
      setTimeout(() => setConfigMsg(null), 3000);
    } catch (e) {
      setConfigMsg({ type: 'err', text: t('agent.configSaveFailed') });
    }
    setConfigSaving(false);
  }, [agent, configProviderId, configPrompt, configCustomPrompt, updateAgent, t]);


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
    { id: 'soul', label: t('agent.tabs.soul') },
    { id: 'work', label: t('agent.tabs.work') },
    { id: 'usage', label: t('agent.tabs.usage') },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
      <div className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-4 pb-4 border-b border-[var(--border)]">
          <div className="relative shrink-0">
            <CachedAvatar src={agent.avatar} alt={agent.name} className="w-24 h-24 rounded-full bg-[var(--border)]" />
            {agent.avgScore >= 80 && (
              <span className="absolute -top-1 -right-1 text-base animate-pulse drop-shadow-lg" title={t('agent.highPerformer')}>🌸</span>
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
              {agent.stamina && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  agent.stamina.zone === 'green' ? 'bg-green-900/30 text-green-400' :
                  agent.stamina.zone === 'yellow' ? 'bg-yellow-900/30 text-yellow-400' :
                  'bg-red-900/30 text-red-400'
                }`}>
                  {agent.stamina.zone === 'green' ? '😊' : agent.stamina.zone === 'yellow' ? '😐' : '😫'} {t('agent.stamina.comfort')}: {agent.stamina.comfort}
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
              {/* Basic Info */}
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
              {/* Personality Bio */}
              {agent.personalityBio && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.personalityBio')}</h4>
                  <div className="bg-purple-900/10 border border-purple-900/20 rounded-lg p-3 text-sm text-purple-200/90 leading-relaxed">
                    {agent.personalityBio}
                  </div>
                </div>
              )}
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

          {activeTab === 'soul' && (
            <div className="space-y-4 animate-fade-in">
              {/* Soul Sub-tabs */}
              <div className="flex gap-1 pb-2 border-b border-[var(--border)]">
                {['memory', 'stamina', 'config'].map(sec => (
                  <button
                    key={sec}
                    onClick={() => setSoulSection(sec)}
                    className={`px-3 py-1 text-xs rounded-lg transition-all ${
                      soulSection === sec
                        ? sec === 'memory' ? 'bg-purple-500/15 text-purple-400'
                          : sec === 'stamina' ? 'bg-cyan-500/15 text-cyan-400'
                          : 'bg-blue-500/15 text-blue-400'
                        : 'text-[var(--muted)] hover:text-white'
                    }`}
                  >
                    {t(`agent.soulSections.${sec}`)}
                  </button>
                ))}
              </div>

              {/* Memory Section */}
              {soulSection === 'memory' && (
                <div className="space-y-4">
                  {/* Memory Sub-tabs */}
                  <div className="flex gap-1 pb-2 border-b border-[var(--border)]">
                    <button
                      onClick={() => setMemorySubTab('personal')}
                      className={`px-3 py-1 text-xs rounded-lg transition-all ${memorySubTab === 'personal' ? 'bg-purple-500/15 text-purple-400' : 'text-[var(--muted)] hover:text-white'}`}
                    >
                      {t('agent.memorySubTabs.personal')}
                    </button>
                    <button
                      onClick={() => setMemorySubTab('social')}
                      className={`px-3 py-1 text-xs rounded-lg transition-all ${memorySubTab === 'social' ? 'bg-pink-500/15 text-pink-400' : 'text-[var(--muted)] hover:text-white'}`}
                    >
                      {t('agent.memorySubTabs.social')} ({agent.memory.relationships?.length || 0})
                    </button>
                  </div>

                  {memorySubTab === 'personal' && (
                    <div className="space-y-4">
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

                  {memorySubTab === 'social' && (
                    <div>
                      {(!agent.memory.relationships || agent.memory.relationships.length === 0) ? (
                        <p className="text-sm text-[var(--muted)] text-center py-8">{t('agent.noRelationships')}</p>
                      ) : (
                        <div className="overflow-auto max-h-80">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-[var(--muted)] border-b border-[var(--border)]">
                                <th className="text-left py-2 px-2 w-10"></th>
                                <th className="text-left py-2 px-2">{t('agent.relationshipName')}</th>
                                <th className="text-left py-2 px-2">{t('agent.relationshipAffinity')}</th>
                                <th className="text-left py-2 px-2">{t('agent.relationshipImpression')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {agent.memory.relationships.map((rel) => {
                                const aff = rel.affinity || 50;
                                const heart = aff >= 80 ? '❤️' : aff >= 60 ? '😊' : aff >= 40 ? '😐' : aff >= 20 ? '😒' : '💢';
                                const barColor = aff >= 80 ? 'bg-red-400' : aff >= 60 ? 'bg-green-400' : aff >= 40 ? 'bg-yellow-400' : aff >= 20 ? 'bg-orange-400' : 'bg-red-600';
                                return (
                                  <tr key={rel.employeeId} className="border-b border-[var(--border)] hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2 px-2">
                                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-[10px]">
                                        {rel.name?.charAt(0) || '?'}
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 font-medium text-white">{rel.name}</td>
                                    <td className="py-2 px-2">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">{heart}</span>
                                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${aff}%` }} />
                                        </div>
                                        <span className="text-[10px] text-[var(--muted)]">{aff}</span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 text-[var(--muted)] italic">{rel.impression}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Stamina Section */}
              {soulSection === 'stamina' && (
                <StaminaTab stamina={agent.stamina} t={t} />
              )}

              {/* Config Section */}
              {soulSection === 'config' && (
                <div className="space-y-5">
                  {/* Provider Selector */}
                  <div>
                    <h4 className="text-sm font-medium mb-1">{t('agent.providerLabel')}</h4>
                    <p className="text-xs text-[var(--muted)] mb-2">{t('agent.providerHint')}</p>
                    {agent.availableProviders?.length > 0 ? (
                      <select
                        value={configProviderId}
                        onChange={e => setConfigProviderId(e.target.value)}
                        className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                      >
                        {(() => {
                          // Group providers by category for clearer display
                          const groups = {};
                          (agent.availableProviders || []).forEach(p => {
                            const cat = p.category || 'general';
                            if (!groups[cat]) groups[cat] = [];
                            groups[cat].push(p);
                          });
                          const categoryKeys = Object.keys(groups);
                          // If only one category, render flat list; otherwise use optgroup
                          if (categoryKeys.length <= 1) {
                            return (agent.availableProviders || []).map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.provider} · {p.model})
                              </option>
                            ));
                          }
                          return categoryKeys.map(cat => (
                            <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                              {groups[cat].map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.provider} · {p.model})
                                </option>
                              ))}
                            </optgroup>
                          ));
                        })()}
                      </select>
                    ) : (
                      <p className="text-xs text-[var(--muted)] italic">{t('agent.noProviders')}</p>
                    )}
                  </div>

                  {/* Role Prompt Editor */}
                  <div>
                    <h4 className="text-sm font-medium mb-1">{t('agent.promptLabel')}</h4>
                    <p className="text-xs text-[var(--muted)] mb-2">{t('agent.promptHint')}</p>
                    <textarea
                      value={configPrompt}
                      onChange={e => setConfigPrompt(e.target.value)}
                      rows={5}
                      className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>

                  {/* Custom Prompt Editor */}
                  <div>
                    <h4 className="text-sm font-medium mb-1">{t('agent.customPromptLabel')}</h4>
                    <p className="text-xs text-[var(--muted)] mb-2">{t('agent.customPromptHint')}</p>
                    <textarea
                      value={configCustomPrompt}
                      onChange={e => setConfigCustomPrompt(e.target.value)}
                      placeholder={t('agent.customPromptPlaceholder')}
                      rows={4}
                      className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--muted)]/50"
                    />
                  </div>

                  {/* Save button + feedback */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSaveConfig}
                      disabled={configSaving}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {configSaving ? t('agent.saving') : t('agent.saveConfig')}
                    </button>
                    {configMsg && (
                      <span className={`text-xs ${configMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                        {configMsg.text}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'work' && (
            <div className="space-y-3 animate-fade-in">
              {/* Incentives */}
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

              {/* Performance Reviews */}
              {agent.reviews.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.tabs.performanceSection')}</h4>
                  {agent.reviews.map((r) => (
                    <div key={r.id} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 mb-2">
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

              {/* Task History */}
              <div>
                <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.tabs.taskSection')}</h4>
                {agent.taskHistory.length === 0 && agent.reviews.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t('agent.noTasks')}</p>
                ) : agent.taskHistory.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t('agent.noTasks')}</p>
                ) : (
                  <div className="space-y-2">
                    {agent.taskHistory.map((tk, i) => (
                      <div key={i} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-sm flex items-center gap-3">
                        <span>{tk.success ? '✅' : '❌'}</span>
                        <div className="flex-1">
                          <div className="font-medium">{tk.task}</div>
                          <div className="text-xs text-[var(--muted)]">
                            {tk.toolsUsed > 0 && t('agent.toolCalls', { n: tk.toolsUsed })}
                            {tk.completedAt && ` · ${new Date(tk.completedAt).toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                  <div className="text-xs text-[var(--muted)] mb-1">{t('agent.promptTokens')}</div>
                  <div className="text-lg font-bold text-purple-400">
                    {(agent.tokenUsage?.promptTokens || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('agent.completionTokens')}</div>
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
                {t('agent.usageHint')}
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
 * StaminaTab — Displays employee comfort / fatigue / stress status
 */
const ZONE_CONFIG = {
  green:  { emoji: '😊', color: 'text-green-400', bg: 'bg-green-400', border: 'border-green-500/20', gradientFrom: 'from-green-900/15', gradientTo: 'to-emerald-900/15' },
  yellow: { emoji: '😐', color: 'text-yellow-400', bg: 'bg-yellow-400', border: 'border-yellow-500/20', gradientFrom: 'from-yellow-900/15', gradientTo: 'to-orange-900/15' },
  red:    { emoji: '😫', color: 'text-red-400', bg: 'bg-red-400', border: 'border-red-500/20', gradientFrom: 'from-red-900/15', gradientTo: 'to-pink-900/15' },
};

const EVENT_LABELS = {
  llmCall: { emoji: '🤖', label: 'LLM Call' },
  toolCall: { emoji: '🔧', label: 'Tool Call' },
  taskAssigned: { emoji: '📋', label: 'Task Assigned' },
  taskComplete: { emoji: '✅', label: 'Task Complete' },
  taskFail: { emoji: '❌', label: 'Task Failed' },
  reviewPass: { emoji: '🎉', label: 'Review Passed' },
  reviewReject1: { emoji: '📝', label: 'Review Rejected (R1)' },
  reviewReject2: { emoji: '📝', label: 'Review Rejected (R2)' },
  reviewReject3Plus: { emoji: '🔴', label: 'Review Rejected (R3+)' },
  rebuttalAccepted: { emoji: '💪', label: 'Rebuttal Accepted' },
  rebuttalRejected: { emoji: '😤', label: 'Rebuttal Rejected' },
  chatPositive: { emoji: '💚', label: 'Positive Chat' },
  chatNegative: { emoji: '💔', label: 'Negative Chat' },
  chatNeutral: { emoji: '💬', label: 'Neutral Chat' },
  repetitionDetected: { emoji: '🔄', label: 'Repetition Detected' },
  tokenThreshold: { emoji: '💸', label: 'Token Threshold' },
  naturalRecovery: { emoji: '🌿', label: 'Natural Recovery' },
};

function StaminaTab({ stamina, t }) {
  if (!stamina) {
    return <p className="text-sm text-[var(--muted)] text-center py-8">{t('agent.stamina.noData')}</p>;
  }

  const zone = stamina.zone || 'green';
  const zc = ZONE_CONFIG[zone] || ZONE_CONFIG.green;
  const history = stamina.history || [];

  const MeterBar = ({ label, value, color, icon }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">{icon} {label}</span>
        <span className={`font-mono font-bold ${color}`}>{value}</span>
      </div>
      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${color.replace('text-', 'bg-')} rounded-full transition-all duration-500`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Comfort Zone Header */}
      <div className={`bg-gradient-to-r ${zc.gradientFrom} ${zc.gradientTo} border ${zc.border} rounded-xl p-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{zc.emoji}</span>
            <div>
              <div className={`text-lg font-bold ${zc.color}`}>
                {t('agent.stamina.comfort')}: {stamina.comfort}/100
              </div>
              <div className="text-xs text-[var(--muted)]">
                {t(`agent.stamina.zone_${zone}`)}
              </div>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${zc.bg}/20 ${zc.color}`}>
            {zone}
          </div>
        </div>
      </div>

      {/* Three Base Metrics */}
      <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-4 space-y-3">
        <MeterBar label={t('agent.stamina.patience')} value={stamina.patience} color="text-cyan-400" icon="🧘" />
        <MeterBar label={t('agent.stamina.fatigue')} value={stamina.fatigue} color="text-orange-400" icon="😮‍💨" />
        <MeterBar label={t('agent.stamina.stress')} value={stamina.stress} color="text-red-400" icon="😤" />
      </div>

      {/* Formula explanation */}
      <div className="text-xs text-[var(--muted)] bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
        💡 {t('agent.stamina.formula')}
      </div>

      {/* Recent Events */}
      <div>
        <h4 className="text-sm font-medium mb-2 text-[var(--muted)]">{t('agent.stamina.recentEvents')}</h4>
        {history.length === 0 ? (
          <p className="text-xs text-[var(--muted)] text-center py-4">{t('agent.stamina.noEvents')}</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-auto">
            {[...history].reverse().map((h, i) => {
              const evtInfo = EVENT_LABELS[h.event] || { emoji: '📌', label: h.event };
              const deltaStr = Object.entries(h.deltas || {})
                .filter(([, v]) => v !== 0)
                .map(([k, v]) => `${k}: ${v > 0 ? '+' : ''}${v}`)
                .join(', ');
              const evtZone = ZONE_CONFIG[h.zone] || ZONE_CONFIG.green;
              const time = h.timestamp ? new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
              return (
                <div key={i} className="flex items-center gap-2 bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs">
                  <span className="shrink-0">{evtInfo.emoji}</span>
                  <span className="flex-1 font-medium">{evtInfo.label}</span>
                  <span className="text-[var(--muted)] font-mono">{deltaStr}</span>
                  <span className={`${evtZone.color} font-bold`}>{h.comfort}</span>
                  <span className="text-[10px] text-[var(--muted)]">{time}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * AgentMention - Renders @Name as highlighted tag
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
