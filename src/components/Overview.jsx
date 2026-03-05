'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import SystemMonitor from './SystemMonitor';
import CachedAvatar from './CachedAvatar';

export default function Overview() {
  const { company, planDepartment, confirmPlan, pendingPlan, setPendingPlan, loading, setActiveTab, fetchRequirements, navigateToRequirement } = useStore();
  const { t } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState('dashboard');
  const [showCreate, setShowCreate] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [activeReqId, setActiveReqId] = useState(null); // unused, kept for compat

  if (!company) return null;

  // Load requirements list
  useEffect(() => {
    fetchRequirements().then(setRequirements);
  }, [company]);

  // Step 1: Generate recruitment plan
  const handlePlan = async () => {
    if (!deptName || !deptMission) return;
    try {
      await planDepartment(deptName, deptMission);
    } catch (e) { /* handled */ }
  };

  // Step 2: Confirm plan
  const handleConfirm = async () => {
    if (!pendingPlan?.planId) return;
    try {
      await confirmPlan(pendingPlan.planId);
      setShowCreate(false);
      setDeptName('');
      setDeptMission('');
    } catch (e) { /* handled */ }
  };

  const deptCount = company.departments?.length || 0;
  const agentCount = company.departments?.reduce((s, d) => s + d.members.length, 0) || 0;
  const enabledProviders = Object.values(company.providerDashboard || {}).reduce((s, c) => s + c.enabled, 0);
  const talentCount = company.talentMarket?.length || 0;
  const budget = company.budget || {};

  const SUB_TABS = [
    { id: 'dashboard', label: t('sidebar.nav.overview'), icon: '📊' },
    { id: 'system-settings', label: t('sidebar.nav.systemSettings'), icon: '⚙️' },
  ];

  // 如果切换到系统设置，直接渲染 SystemMonitor
  if (activeSubTab === 'system-settings') {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('overview.title')}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">{t('overview.subtitle')}</p>
          </div>
        </div>
        {/* Sub Tabs */}
        <div className="flex gap-2">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all ${
                activeSubTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-white/5 text-[var(--muted)] hover:bg-white/10'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <SystemMonitor embedded />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">{t('overview.title')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t('overview.subtitle')}</p>
      </div>

      {/* Sub Tabs */}
      <div className="flex gap-2">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all ${
              activeSubTab === tab.id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-white/5 text-[var(--muted)] hover:bg-white/10'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: t('overview.stats.departments'), value: deptCount, icon: '🏭', color: 'blue' },
          { label: t('overview.stats.workers'), value: agentCount, icon: '🤖', color: 'green' },
          { label: t('overview.stats.providers'), value: enabledProviders, icon: '⚡', color: 'purple' },
          { label: t('overview.stats.talents'), value: talentCount, icon: '🏪', color: 'yellow' },
          { label: t('overview.stats.burned'), value: `$${(budget.totalCost || 0).toFixed(4)}`, icon: '🔥', color: 'red', isText: true },
        ].map((stat) => (
          <div key={stat.label} className="card">
            <div className="flex items-center justify-between">
              <span className="text-2xl">{stat.icon}</span>
              <span className={`${stat.isText ? 'text-xl' : 'text-3xl'} font-bold text-${stat.color}-400`}>{stat.value}</span>
            </div>
            <div className="text-sm text-[var(--muted)] mt-2">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Budget management */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{t('overview.budget.title')}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <div className="text-sm text-[var(--muted)] mb-2">{t('overview.budget.totalBurn')}</div>
            <div className="text-2xl font-bold text-red-400">${(budget.totalCost || 0).toFixed(4)}</div>
            <div className="text-xs text-[var(--muted)] mt-1">Token: {(budget.totalTokens || 0).toLocaleString()}</div>
            <div className="flex gap-4 mt-3 text-xs">
              <div><span className="text-[var(--muted)]">{t('overview.budget.secretary') + ': '}</span><span className="text-blue-400">{(budget.secretaryUsage?.totalTokens || 0).toLocaleString()}</span></div>
              <div><span className="text-[var(--muted)]">{t('overview.budget.hr') + ': '}</span><span className="text-purple-400">{(budget.hrUsage?.totalTokens || 0).toLocaleString()}</span></div>
            </div>
          </div>
          {company.departments?.slice(0, 2).map((dept) => (
            <div key={dept.id} className="card">
              <div className="text-sm text-[var(--muted)] mb-2">{dept.name}</div>
              <div className="text-2xl font-bold text-blue-400">${(dept.tokenUsage?.totalCost || 0).toFixed(4)}</div>
              <div className="text-xs text-[var(--muted)] mt-1">Token: {(dept.tokenUsage?.totalTokens || 0).toLocaleString()}</div>
              <div className="mt-3 space-y-1">
                {dept.members.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <CachedAvatar src={m.avatar} alt="" className="w-4 h-4 rounded-full" />
                      <span className="text-[var(--muted)]">{m.name}</span>
                    </div>
                    <span className="text-green-400">${(m.tokenUsage?.totalCost || 0).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Requirements management */}
      {/* Create department modal (two-step flow) */}
      {showCreate && (
<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowCreate(false); setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan ? (
              <>
                <h3 className="text-lg font-semibold">{t('overview.createDept.title')}</h3>
                <p className="text-sm text-[var(--muted)]">{t('overview.createDept.desc')}</p>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('overview.createDept.nameLabel')}</label>
                  <input className="input w-full" placeholder={t('overview.createDept.namePlaceholder')} value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('overview.createDept.missionLabel')}</label>
                  <textarea className="input w-full h-24 resize-none" placeholder={t('overview.createDept.missionPlaceholder')} value={deptMission} onChange={e => setDeptMission(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowCreate(false)}>{t('overview.createDept.cancelBtn')}</button>
                  <button className="btn-primary flex-1" disabled={!deptName || !deptMission || loading} onClick={handlePlan}>
                    {loading ? t('overview.createDept.planning') : t('overview.createDept.planBtn')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">{t('overview.planReview.title')}</h3>
                <p className="text-sm text-[var(--muted)]">
                  {t('overview.planReview.desc', { dept: pendingPlan.departmentName })}
                </p>

                {/* Secretary analysis reasoning */}
                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">{t('overview.planReview.analysis')}</div>
                    <div className="text-sm text-[var(--muted)]">{pendingPlan.reasoning}</div>
                  </div>
                )}

                {/* Plan display */}
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 space-y-2">
                  <div className="text-xs text-[var(--muted)]">{t('overview.planReview.mission')}: {pendingPlan.mission}</div>
                  <div className="text-xs text-[var(--muted)] mb-2">{t('overview.planReview.teamSize', { n: pendingPlan.members?.length || 0 })}</div>

                  {pendingPlan.members?.map((m, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${m.isLeader ? 'bg-yellow-900/10 border border-yellow-500/20' : 'bg-white/5'}`}>
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-full flex items-center justify-center text-xs">
                        {m.isLeader ? '👔' : '🤖'}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-xs text-[var(--muted)]">{m.title}</div>
                        {m.providerName && <div className="text-[10px] text-purple-400/80 mt-0.5">⚡ {m.providerName}</div>}
                        {m.reason && <div className="text-[10px] text-blue-400/70 mt-0.5">💡 {m.reason}</div>}
                      </div>
                      <div className="text-right">
                        {m.isLeader && <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">{t('overview.planReview.leader')}</span>}
                        {m.reportsTo && <span className="text-[10px] text-[var(--muted)]">→ {m.reportsTo}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>{t('overview.planReview.rejectBtn')}</button>
                  <button className="btn-primary flex-1" disabled={loading} onClick={handleConfirm}>
                    {loading ? t('overview.planReview.hiring') : t('overview.planReview.approveBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Requirements management */}
      {(company.requirements?.length > 0 || requirements.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{t('requirements.title')}</h2>
            <span className="text-xs text-[var(--muted)]">{t('overview.requirements.count', { n: (company.requirements || requirements).length })}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(company.requirements || requirements).map((req) => {
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
                  className="card cursor-pointer hover:border-[var(--accent)]/30"
                  onClick={() => navigateToRequirement(req.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span>{st.icon}</span>
                      <span className="font-medium text-sm truncate">{req.title}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color} shrink-0`}>{st.label}</span>
                  </div>
                  <p className="text-xs text-[var(--muted)] line-clamp-2 mb-2">{req.description}</p>
                  <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                    <span>🏢 {req.departmentName}</span>
                    <div className="flex items-center gap-2">
                      {req.workflow && <span>📊 {req.workflow.completedCount || 0}/{req.workflow.nodeCount || 0}</span>}
                      {req.chatCount > 0 && <span>💬 {req.chatCount}</span>}
                      {req.outputCount > 0 && <span>📦 {req.outputCount}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Requirement detail is now a standalone page, no longer using modal */}

      {/* Department list */}
      <div>
<h2 className="text-lg font-semibold mb-3">{t('overview.departments.title')}</h2>
        {deptCount === 0 ? (
          <div className="card text-center py-8 text-[var(--muted)]">
            <div className="text-4xl mb-3">🏗️</div>
            <p>{t('overview.departments.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {company.departments.map((dept) => (
              <div key={dept.id} className="card cursor-pointer" onClick={() => setActiveTab('departments')}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{dept.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">🔥 ${(dept.tokenUsage?.totalCost || 0).toFixed(4)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      dept.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                      dept.status === 'active' ? 'bg-yellow-900/30 text-yellow-400' :
                      'bg-blue-900/30 text-blue-400'
                    }`}>{dept.status}</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mb-3 line-clamp-2">{dept.mission}</p>
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {dept.members.slice(0, 5).map((m) => (
                      <CachedAvatar key={m.id} src={m.avatar} alt={m.name} title={`${m.name} (${m.role})`} className="w-7 h-7 rounded-full border-2 border-[var(--card)] bg-[var(--border)]" />
                    ))}
                  </div>
                  <span className="text-xs text-[var(--muted)]">{t('overview.departments.workers', { n: dept.members.length })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>



    </div>
  );
}
