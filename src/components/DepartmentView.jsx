'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import AgentDetailModal from './AgentDetailModal';
import AgentChatModal from './AgentChatModal';
import OrgTree from './OrgTree';
import RequirementDetail from './RequirementDetail';
import { useI18n } from '@/lib/i18n';

export default function DepartmentView() {
  const { t } = useI18n();
  const {
    company, dismissAgent, planDepartment, confirmPlan, pendingPlan, setPendingPlan,
    planAdjustment, confirmAdjustment, disbandDepartment, loading,
    fetchDepartmentRequirements,
  } = useStore();

  // Modal states
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showOrgTree, setShowOrgTree] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detailDept, setDetailDept] = useState(null); // Department detail modal
  const [showAdjust, setShowAdjust] = useState(null); // Adjust modal departmentId
  const [showDisband, setShowDisband] = useState(null); // Disband confirm departmentId
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const [disbandReason, setDisbandReason] = useState('');
  const [adjustGoal, setAdjustGoal] = useState('');
  const [activeReqId, setActiveReqId] = useState(null); // Requirement detail
  const [deptRequirements, setDeptRequirements] = useState([]); // Department requirements list
const [chatAgent, setChatAgent] = useState(null); // Agent chat target { id, name, avatar, role, signature, department }

  // Create department
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');

  if (!company) return null;

  const handleDismiss = async () => {
    if (!dismissTarget) return;
    try {
      await dismissAgent(dismissTarget.deptId, dismissTarget.agentId, dismissReason || 'Boss decision');
      setDismissTarget(null);
      setDismissReason('');
    } catch (e) { /* handled */ }
  };

  const handlePlan = async () => {
    if (!deptName || !deptMission) return;
    try {
      await planDepartment(deptName, deptMission);
    } catch (e) { /* handled */ }
  };

  const handleConfirm = async () => {
    if (!pendingPlan?.planId) return;
    try {
      if (pendingPlan.type === 'adjustment') {
        await confirmAdjustment(pendingPlan.planId);
        setShowAdjust(null);
      } else {
        await confirmPlan(pendingPlan.planId);
        setShowCreate(false);
      }
      setDeptName('');
      setDeptMission('');
      setAdjustGoal('');
    } catch (e) { /* handled */ }
  };

  const handleAdjustPlan = async (deptId) => {
    if (!adjustGoal) return;
    try {
      await planAdjustment(deptId, adjustGoal);
    } catch (e) { /* handled */ }
  };

  const handleDisband = async () => {
    if (!showDisband) return;
    try {
      await disbandDepartment(showDisband, disbandReason || 'Organization restructuring');
      setShowDisband(null);
      setDisbandReason('');
      setDetailDept(null);
    } catch (e) { /* handled */ }
  };

  // Get latest data for current detail department
  const currentDetailDept = detailDept ? company.departments.find(d => d.id === detailDept) : null;

  // Load department requirements
  useEffect(() => {
    if (detailDept) {
      fetchDepartmentRequirements(detailDept).then(setDeptRequirements);
    }
  }, [detailDept]);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Top title bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('dept.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t('dept.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowOrgTree(true)}
            className="btn-secondary flex items-center gap-1.5"
          >
            {t('dept.viewOrgTree')}
          </button>
          <button
            onClick={() => { setShowCreate(true); setPendingPlan && setPendingPlan(null); }}
            className="btn-primary"
          >{t('dept.createDept')}</button>
        </div>
      </div>

      {/* Department list */}
      {company.departments.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">🏗️</div>
          <p className="text-lg">{t('dept.empty')}</p>
          <p className="text-sm mt-1">{t('dept.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {company.departments.map((dept) => (
            <div key={dept.id} className="card hover:border-[var(--accent)]/20 transition-all">
              {/* Department header - click to open detail */}
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setDetailDept(dept.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-lg flex items-center justify-center text-lg">
                    🏢
                  </div>
                  <div>
                    <h3 className="font-semibold">{dept.name}</h3>
                    <p className="text-xs text-[var(--muted)] max-w-md truncate">{dept.mission}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    dept.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                    dept.status === 'active' ? 'bg-yellow-900/30 text-yellow-400' :
                    'bg-blue-900/30 text-blue-400'
                  }`}>
                    {dept.status}
                  </span>
                  <span className="text-xs text-green-400">
                    ${(dept.tokenUsage?.totalCost || 0).toFixed(4)}
                  </span>
                  <span className="text-sm text-[var(--muted)]">{t('dept.members.count', { n: dept.members.length })}</span>
                  <span className="text-[var(--muted)] text-xs">{t('dept.viewDetail')}</span>
                </div>
              </div>

              {/* Employee avatar preview */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                <div className="flex -space-x-2">
                  {dept.members.slice(0, 6).map((m) => (
                    <img
                      key={m.id}
                      src={m.avatar}
                      alt={m.name}
                      title={`${m.name} (${m.role})`}
                      className="w-7 h-7 rounded-full border-2 border-[var(--card)] bg-[var(--border)]"
                    />
                  ))}
                  {dept.members.length > 6 && (
                    <div className="w-7 h-7 rounded-full border-2 border-[var(--card)] bg-[var(--border)] flex items-center justify-center text-[10px] text-[var(--muted)]">
                      +{dept.members.length - 6}
                    </div>
                  )}
                </div>
                <div className="flex-1" />
                {/* Quick action buttons */}
                <button
                  className="text-xs text-[var(--muted)] hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-blue-900/10"
                  onClick={(e) => { e.stopPropagation(); setShowAdjust(dept.id); setAdjustGoal(''); setPendingPlan(null); }}
                >{t('dept.detail.adjustBtn')}</button>
                <button
                  className="text-xs text-[var(--muted)] hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-900/10"
                  onClick={(e) => { e.stopPropagation(); setShowDisband(dept.id); setDisbandReason(''); }}
                >
                  {t('dept.detail.disbandBtn')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========== Org tree modal ========== */}
      {showOrgTree && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowOrgTree(false)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-5xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('dept.orgTree.title')}</h2>
              <button onClick={() => setShowOrgTree(false)} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
            </div>
            <div className="p-2">
              <OrgTree embedded />
            </div>
          </div>
        </div>
      )}

      {/* ========== Department detail modal ========== */}
      {currentDetailDept && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => setDetailDept(null)}>
          <div className="card max-w-3xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  🏢 {currentDetailDept.name}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    currentDetailDept.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                    currentDetailDept.status === 'active' ? 'bg-yellow-900/30 text-yellow-400' :
                    'bg-blue-900/30 text-blue-400'
                  }`}>
                    {currentDetailDept.status}
                  </span>
                </h2>
                <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{currentDetailDept.mission}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
                  <span>👥 {t('dept.members.count', { n: currentDetailDept.members.length })}</span>
                  <span>💰 ${(currentDetailDept.tokenUsage?.totalCost || 0).toFixed(4)}</span>
                  <span>🔢 {(currentDetailDept.tokenUsage?.totalTokens || 0).toLocaleString()} tokens</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1.5 rounded-lg transition-colors"
                  onClick={() => { setShowAdjust(currentDetailDept.id); setAdjustGoal(''); setPendingPlan(null); }}
                >{t('dept.detail.adjustBtn')}</button>
                <button
                  className="text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-3 py-1.5 rounded-lg transition-colors"
                  onClick={() => { setShowDisband(currentDetailDept.id); setDisbandReason(''); }}
                >{t('dept.detail.disbandBtn')}</button>
                <button onClick={() => setDetailDept(null)} className="text-[var(--muted)] hover:text-white text-xl ml-2">✕</button>
              </div>
            </div>

            {/* Member list */}
            <div className="mt-4">
              <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{t('dept.detail.members')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentDetailDept.members.map((member) => (
                  <div
                    key={member.id}
                    className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 hover:border-[var(--accent)]/30 transition-all cursor-pointer group"
                    onClick={() => setSelectedAgent(member.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full bg-[var(--border)]" />
                        {member.avgScore >= 80 && (
                          <span className="absolute -top-1 -right-1 text-xs animate-pulse drop-shadow-lg">🌸</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{member.name}</span>
                          {currentDetailDept.leader === member.id && (
                            <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">{t('dept.detail.leader')}</span>
                          )}
                          <span className={`status-dot ${member.status}`} />
                        </div>
                        <div className="text-xs text-[var(--muted)]">
{member.gender === 'female' ? '👩' : '👨'}{member.age ? ` ${t('display.ageYears', { n: member.age })}` : ''} · {member.role}
                        </div>
                        <div className="text-[10px] text-[var(--muted)] italic mt-1 truncate">"{member.signature}"</div>
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 text-sm transition-opacity"
                        title={t('agentChat.chatBtn')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatAgent({ id: member.id, name: member.name, avatar: member.avatar, role: member.role, signature: member.signature, department: currentDetailDept?.name });
                        }}
                      >
                        💬
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-sm transition-opacity"
                        title={t('dept.dismiss.title')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDismissTarget({ deptId: currentDetailDept.id, agentId: member.id, name: member.name });
                        }}
                      >
                        🔥
                      </button>
                    </div>

                    {/* Tags */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">{member.provider.name}</span>
                      {member.avgScore && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          member.avgScore >= 80 ? 'bg-green-900/30 text-green-400' :
                          member.avgScore >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-red-900/30 text-red-400'
                        }`}>
                          {t('dept.detail.performance', { score: member.avgScore })}
                        </span>
                      )}
                      <span className="text-[10px] bg-purple-900/30 text-purple-400 px-1.5 py-0.5 rounded">
                        {t('dept.detail.memory', { n: (member.memory?.shortTermCount || 0) + (member.memory?.longTermCount || 0) })}
                      </span>
                      {member.taskCount > 0 && (
                        <span className="text-[10px] bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded">
                          {t('dept.detail.tasks', { n: member.taskCount })}
                        </span>
                      )}
                      {member.tokenUsage?.totalTokens > 0 && (
                        <span className="text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded">
                          ${(member.tokenUsage.totalCost || 0).toFixed(4)}
                        </span>
                      )}
                    </div>

                    {/* Skills */}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {member.skills.slice(0, 3).map((s, i) => (
                        <span key={i} className="text-[10px] text-[var(--muted)] bg-white/5 px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                      {member.skills.length > 3 && (
                        <span className="text-[10px] text-[var(--muted)]">+{member.skills.length - 3}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Requirements list */}
            {deptRequirements.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{t('dept.detail.requirements')}</h3>
                <div className="space-y-2">
                  {deptRequirements.map((req) => {
                    const statusCfg = {
                      pending: { label: t('requirements.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30', icon: '⏳' },
                      planning: { label: t('requirements.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30', icon: '📝' },
                      in_progress: { label: t('requirements.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30', icon: '⚙️' },
                      completed: { label: t('requirements.stats.completed'), color: 'text-green-400', bg: 'bg-green-900/30', icon: '✅' },
                      failed: { label: t('requirements.status.failed'), color: 'text-red-400', bg: 'bg-red-900/30', icon: '❌' },
                    };
                    const st = statusCfg[req.status] || statusCfg.pending;
                    return (
                      <div
                        key={req.id}
                        className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 cursor-pointer hover:border-[var(--accent)]/30 transition-all"
                        onClick={() => setActiveReqId(req.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{st.icon}</span>
                            <span className="text-sm font-medium">{req.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                            {req.workflow && <span className="text-[10px] text-[var(--muted)]">📊 {req.workflow.completedCount || 0}/{req.workflow.nodeCount || 0}</span>}
                            {req.chatCount > 0 && <span className="text-[10px] text-[var(--muted)]">💬 {req.chatCount}</span>}
                            {req.outputCount > 0 && <span className="text-[10px] text-[var(--muted)]">📦 {req.outputCount}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Project reports */}            {company.progressReports?.length > 0 && (() => {
              const deptReports = company.progressReports
                .slice().reverse()
                .filter(pr => pr.reports.some(r => r.department === currentDetailDept.name))
                .slice(0, 5);
              if (deptReports.length === 0) return null;
              return (
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{t('dept.detail.reports')}</h3>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {deptReports.map((pr, i) => {
                      const r = pr.reports.find(r => r.department === currentDetailDept.name);
                      if (!r) return null;
                      return (
                        <div key={i} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-sm flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--muted)]">{new Date(pr.time).toLocaleString()}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              r.status === 'completed' ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400'
                            }`}>{r.status}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                            <span>🤖 {r.memberCount}</span>
                            <span>📝 {r.completedTasks}</span>
                            {r.avgScore && <span className="text-yellow-400">⭐ {r.avgScore}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Requirement detail modal */}
      {activeReqId && (
        <RequirementDetail
          requirementId={activeReqId}
          onClose={() => setActiveReqId(null)}
        />
      )}

      {/* ========== Agent detail modal ========== */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}

      {/* ========== Agent chat modal ========== */}
      {chatAgent && (
        <AgentChatModal
          agentId={chatAgent.id}
          agentName={chatAgent.name}
          agentAvatar={chatAgent.avatar}
          agentRole={chatAgent.role}
          agentSignature={chatAgent.signature}
          agentDepartment={chatAgent.department}
          onClose={() => setChatAgent(null)}
        />
      )}

      {/* ========== Dismiss confirm modal ========== */}
      {dismissTarget && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => setDismissTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">{t('dept.dismiss.title')}</h3>
            <p className="text-sm">{t('dept.dismiss.desc', { name: '' })}<strong>{dismissTarget.name}</strong></p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.dismiss.reasonLabel')}</label>
              <input className="input w-full" placeholder={t('dept.dismiss.reasonPlaceholder')} value={dismissReason} onChange={e => setDismissReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setDismissTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-danger flex-1" onClick={handleDismiss}>{t('dept.dismiss.confirmBtn')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Disband department confirm modal ========== */}
      {showDisband && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowDisband(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">{t('dept.detail.disbandBtn')}</h3>
            <p className="text-sm">
              {t('dept.disband.desc', { name: '' })}<strong>{company.departments.find(d => d.id === showDisband)?.name}</strong>
              <br />{t('dept.disband.descSuffix')}
            </p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.disband.reasonLabel')}</label>
              <input className="input w-full" placeholder={t('dept.disband.reasonPlaceholder')} value={disbandReason} onChange={e => setDisbandReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setShowDisband(null)}>{t('common.cancel')}</button>
              <button className="btn-danger flex-1" onClick={handleDisband} disabled={loading}>
                {loading ? t('dept.disband.disbanding') : t('dept.disband.confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Adjust workforce modal (two-step flow) ========== */}
      {showAdjust && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowAdjust(null); setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan || pendingPlan.type !== 'adjustment' ? (
              <>
                <h3 className="text-lg font-semibold">{t('dept.detail.adjustBtn')}</h3>
                <p className="text-sm text-[var(--muted)]">
                  {t('dept.adjust.desc')}
                </p>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('dept.adjust.currentDept')}</div>
                  <div className="font-medium">{company.departments.find(d => d.id === showAdjust)?.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    {t('dept.adjust.currentMembers', { n: company.departments.find(d => d.id === showAdjust)?.members.length })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.adjust.goalLabel')}</label>
                  <textarea
                    className="input w-full h-20 resize-none"
                    placeholder={t('dept.adjust.goalPlaceholder')}
                    value={adjustGoal}
                    onChange={e => setAdjustGoal(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowAdjust(null)}>{t('common.cancel')}</button>
                  <button className="btn-primary flex-1" disabled={!adjustGoal || loading} onClick={() => handleAdjustPlan(showAdjust)}>
                    {loading ? t('dept.adjust.planning') : t('dept.adjust.planBtn')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">{t('dept.adjust.reviewTitle')}</h3>
                <p className="text-sm text-[var(--muted)]">
                  {t('dept.adjust.reviewDesc', { dept: pendingPlan.departmentName })}
                </p>

                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">{t('overview.planReview.analysis')}</div>
                    <div className="text-sm text-[var(--muted)]">{pendingPlan.reasoning}</div>
                  </div>
                )}

                {/* Layoff list */}
                {pendingPlan.fires?.length > 0 && (
                  <div className="bg-red-900/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-red-400 mb-1">{t('dept.adjust.firesTitle', { n: pendingPlan.fires.length })}</div>
                    {pendingPlan.fires.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-red-400">✕</span>
                        <span className="font-medium">{f.name}</span>
                        <span className="text-xs text-[var(--muted)]">- {f.reason}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expansion list */}
                {pendingPlan.hires?.length > 0 && (
                  <div className="bg-green-900/10 border border-green-500/20 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-green-400 mb-1">{t('dept.adjust.hiresTitle', { n: pendingPlan.hires.length })}</div>
                    {pendingPlan.hires.map((h, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                        <span>🤖</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{h.name}</div>
                          <div className="text-xs text-[var(--muted)]">{h.templateTitle || h.templateId}</div>
                          {h.reason && <div className="text-[10px] text-blue-400/70 mt-0.5">💡 {h.reason}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {pendingPlan.fires?.length === 0 && pendingPlan.hires?.length === 0 && (
                  <div className="text-center text-[var(--muted)] py-4">
                    {t('dept.adjust.noChanges')}
                  </div>
                )}

                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>{t('overview.planReview.rejectBtn')}</button>
                  <button
                    className="btn-primary flex-1"
                    disabled={loading || (pendingPlan.fires?.length === 0 && pendingPlan.hires?.length === 0)}
                    onClick={handleConfirm}
                  >
                    {loading ? t('dept.adjust.executing') : t('dept.adjust.approveBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========== Create department modal (two-step flow) ========== */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowCreate(false); setPendingPlan && setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan || pendingPlan.type === 'adjustment' ? (
              <>
                <h3 className="text-lg font-semibold">{t('dept.create.title')}</h3>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('overview.createDept.nameLabel')}</label>
                  <input className="input w-full" placeholder={t('dept.create.namePlaceholder')} value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('overview.createDept.missionLabel')}</label>
                  <textarea className="input w-full h-24 resize-none" placeholder={t('dept.create.missionPlaceholder')} value={deptMission} onChange={e => setDeptMission(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
                  <button className="btn-primary flex-1" disabled={!deptName || !deptMission || loading} onClick={handlePlan}>
                    {loading ? t('dept.create.planning') : t('dept.create.planBtn')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">{t('overview.planReview.title')}</h3>
                <p className="text-sm text-[var(--muted)]">{t('dept.create.reviewDesc', { dept: pendingPlan.departmentName })}</p>

                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">{t('overview.planReview.analysis')}</div>
                    <div className="text-sm text-[var(--muted)]">{pendingPlan.reasoning}</div>
                  </div>
                )}

                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 space-y-2">
                  {pendingPlan.members?.map((m, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${m.isLeader ? 'bg-yellow-900/10 border border-yellow-500/20' : 'bg-white/5'}`}>
                      <span>{m.isLeader ? '👔' : '🤖'}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-xs text-[var(--muted)]">{m.title} {m.reportsTo ? `→ ${m.reportsTo}` : ''}</div>
                        {m.reason && <div className="text-[10px] text-blue-400/70 mt-0.5">💡 {m.reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>{t('overview.planReview.rejectBtn')}</button>
                  <button className="btn-primary flex-1" disabled={loading} onClick={handleConfirm}>
                    {loading ? t('overview.planReview.hiring') : t('dept.create.approveBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
