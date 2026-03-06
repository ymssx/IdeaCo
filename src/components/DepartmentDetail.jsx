'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import AgentDetailModal from './AgentDetailModal';
import AgentChatModal from './AgentChatModal';
import RequirementDetail from './RequirementDetail';
import { useI18n } from '@/lib/i18n';
import CachedAvatar from './CachedAvatar';

export default function DepartmentDetail() {
  const { t } = useI18n();
  const {
    company, loading, dismissAgent,
    fetchDepartmentRequirements, createRequirement,
    navigateToRequirement, navigateBackFromDepartment,
    activeDepartmentId, planAdjustment, confirmAdjustment,
    disbandDepartment, pendingPlan, setPendingPlan,
    deleteRequirement, restartRequirement,
    createTeam, fetchTeams, navigateToTeam,
  } = useStore();

  // Sub-modals
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [chatAgent, setChatAgent] = useState(null);
  const [activeReqId, setActiveReqId] = useState(null);
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustGoal, setAdjustGoal] = useState('');
  const [showDisband, setShowDisband] = useState(false);
  const [disbandReason, setDisbandReason] = useState('');

  // New requirement form (inline)
  const [showNewReq, setShowNewReq] = useState(false);
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [newReqWorkspaceDir, setNewReqWorkspaceDir] = useState('');

  const [deptRequirements, setDeptRequirements] = useState([]);

  // Folder browser state
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browseDirs, setBrowseDirs] = useState([]);
  const [browseCurrentPath, setBrowseCurrentPath] = useState('');
  const [browseParentPath, setBrowseParentPath] = useState(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Team creation form
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [selectedLeader, setSelectedLeader] = useState('');
  const [deptTeams, setDeptTeams] = useState([]);

  const fetchDirs = async (dirPath) => {
    setBrowseLoading(true);
    try {
      const url = dirPath ? `/api/browse-dir?path=${encodeURIComponent(dirPath)}` : '/api/browse-dir';
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) return;
      setBrowseDirs(data.dirs || []);
      setBrowseCurrentPath(data.current || '');
      setBrowseParentPath(data.parent || null);
    } catch (e) { /* handled */ }
    setBrowseLoading(false);
  };

  const dept = company?.departments?.find(d => d.id === activeDepartmentId);

  useEffect(() => {
    if (activeDepartmentId) {
      fetchDepartmentRequirements(activeDepartmentId).then(setDeptRequirements);
      fetchTeams(activeDepartmentId).then(teams => setDeptTeams(teams || []));
    }
  }, [activeDepartmentId]);

  if (!dept) {
    return (
      <div className="p-6 text-center text-[var(--muted)]">
        <p>{t('dept.empty')}</p>
        <button className="btn-secondary mt-4" onClick={navigateBackFromDepartment}>{t('dept.detail.back')}</button>
      </div>
    );
  }

  const handleDismiss = async () => {
    if (!dismissTarget) return;
    try {
      await dismissAgent(dismissTarget.deptId, dismissTarget.agentId, dismissReason || 'Boss decision');
      setDismissTarget(null);
      setDismissReason('');
    } catch (e) { /* handled */ }
  };

  const handleCreateRequirement = async () => {
    if (!newReqTitle) return;
    try {
      const result = await createRequirement(activeDepartmentId, newReqTitle, newReqDesc, newReqWorkspaceDir || undefined);
      setShowNewReq(false);
      setNewReqTitle('');
      setNewReqDesc('');
      setNewReqWorkspaceDir('');
      if (result?.id) {
        navigateToRequirement(result.id);
      }
      fetchDepartmentRequirements(activeDepartmentId).then(setDeptRequirements);
    } catch (e) { /* handled */ }
  };

  const handleCreateTeam = async () => {
    if (!teamName || selectedMembers.length === 0 || !selectedLeader) return;
    try {
      const result = await createTeam(activeDepartmentId, teamName, selectedMembers, selectedLeader, teamDesc);
      setShowNewTeam(false);
      setTeamName('');
      setTeamDesc('');
      setSelectedMembers([]);
      setSelectedLeader('');
      if (result?.id) {
        navigateToTeam(result.id);
      }
      fetchTeams(activeDepartmentId).then(teams => setDeptTeams(teams || []));
    } catch (e) { /* handled */ }
  };

  const handleAdjustPlan = async () => {
    if (!adjustGoal) return;
    try {
      await planAdjustment(activeDepartmentId, adjustGoal);
    } catch (e) { /* handled */ }
  };

  const handleDisband = async () => {
    try {
      await disbandDepartment(activeDepartmentId, disbandReason || 'Organization restructuring');
      setShowDisband(false);
      setDisbandReason('');
      navigateBackFromDepartment();
    } catch (e) { /* handled */ }
  };

  const deptReports = (company.progressReports || [])
    .slice().reverse()
    .filter(pr => pr.reports.some(r => r.department === dept.name))
    .slice(0, 5);

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ===== Top navigation bar ===== */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--card)]/50 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={navigateBackFromDepartment}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm flex items-center gap-1 shrink-0"
            >
              ← {t('dept.detail.back')}
            </button>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-lg flex items-center justify-center text-lg shrink-0">
                🏢
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold flex items-center gap-2 truncate">
                  {dept.name}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    dept.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                    dept.status === 'active' ? 'bg-yellow-900/30 text-yellow-400' :
                    'bg-blue-900/30 text-blue-400'
                  }`}>
                    {dept.status}
                  </span>
                </h1>
                <p className="text-xs text-[var(--muted)] truncate">{dept.mission}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary flex items-center gap-1.5"
              onClick={() => { setShowNewReq(true); setNewReqTitle(''); setNewReqDesc(''); setNewReqWorkspaceDir(''); }}
            >
              {t('dept.newReq.btn')}
            </button>
            <button
              className="text-xs bg-purple-900/20 text-purple-400 hover:bg-purple-900/40 px-3 py-1.5 rounded-lg transition-colors"
              onClick={() => { setShowNewTeam(true); setTeamName(''); setTeamDesc(''); setSelectedMembers([]); setSelectedLeader(''); }}
            >{t('team.newTeamBtn')}</button>
            <button
              className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1.5 rounded-lg transition-colors"
              onClick={() => { setShowAdjust(true); setAdjustGoal(''); setPendingPlan(null); }}
            >{t('dept.detail.adjustBtn')}</button>
            <button
              className="text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-3 py-1.5 rounded-lg transition-colors"
              onClick={() => { setShowDisband(true); setDisbandReason(''); }}
            >{t('dept.detail.disbandBtn')}</button>
          </div>
        </div>
        {/* Stats bar */}
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
          <span>👥 {t('dept.members', { n: dept.members.length })}</span>
          <span>💰 ${(dept.tokenUsage?.totalCost || 0).toFixed(4)}</span>
          <span>🔢 {(dept.tokenUsage?.totalTokens || 0).toLocaleString()} tokens</span>
          <span>📋 {deptRequirements.length} {t('dept.detail.requirements')}</span>
          <span>👥 {deptTeams.length} {t('team.teamsCount')}</span>
        </div>
      </div>

      {/* ===== Main content (scrollable) ===== */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* New requirement form (expandable card) */}
        {showNewReq && (
          <div className="card border-[var(--accent)]/30 animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{t('dept.newReq.title')}</h3>
              <button onClick={() => setShowNewReq(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.newReq.nameLabel')}</label>
              <input
                className="input w-full"
                placeholder={t('dept.newReq.namePlaceholder')}
                value={newReqTitle}
                onChange={e => setNewReqTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.newReq.descLabel')}</label>
              <textarea
                className="input w-full h-20 resize-none"
                placeholder={t('dept.newReq.descPlaceholder')}
                value={newReqDesc}
                onChange={e => setNewReqDesc(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.newReq.workspaceDirLabel')}</label>
              <div className="flex gap-2">
                <input
                  className="input w-full font-mono text-xs min-h-[36px]"
                  value={newReqWorkspaceDir}
                  onChange={e => setNewReqWorkspaceDir(e.target.value)}
                  placeholder={t('dept.newReq.workspaceDirPlaceholder')}
                />
                <button
                  className="btn-secondary shrink-0 text-sm px-3"
                  onClick={() => { setShowFolderBrowser(true); fetchDirs(newReqWorkspaceDir || ''); }}
                  title={t('dept.newReq.browseTitle')}
                >📁</button>
                {newReqWorkspaceDir && (
                  <button
                    className="text-[var(--muted)] hover:text-red-400 text-sm px-1 shrink-0"
                    onClick={() => setNewReqWorkspaceDir('')}
                    title={t('common.delete')}
                  >✕</button>
                )}
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1">{t('dept.newReq.workspaceDirHint')}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNewReq(false)}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                disabled={!newReqTitle || loading}
                onClick={handleCreateRequirement}
              >
                {loading ? t('dept.newReq.creating') : t('dept.newReq.submitBtn')}
              </button>
            </div>
          </div>
        )}

        {/* New team form (expandable card) */}
        {showNewTeam && (
          <div className="card border-purple-500/30 animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">👥 {t('team.newTeamBtn')}</h3>
              <button onClick={() => setShowNewTeam(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.nameLabel')}</label>
              <input
                className="input w-full"
                placeholder={t('team.namePlaceholder')}
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.descLabel')}</label>
              <textarea
                className="input w-full h-16 resize-none"
                placeholder={t('team.descPlaceholder')}
                value={teamDesc}
                onChange={e => setTeamDesc(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.selectMembers')}</label>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
                {dept.members.map(member => {
                  const selected = selectedMembers.includes(member.id);
                  return (
                    <label
                      key={member.id}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full cursor-pointer text-xs transition-all border ${
                        selected
                          ? 'bg-purple-900/30 border-purple-500/50 text-purple-300'
                          : 'bg-white/5 border-transparent hover:bg-white/10 text-[var(--foreground)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedMembers(prev => [...prev, member.id]);
                          } else {
                            setSelectedMembers(prev => prev.filter(id => id !== member.id));
                            if (selectedLeader === member.id) setSelectedLeader('');
                          }
                        }}
                        className="hidden"
                      />
                      <CachedAvatar src={member.avatar} alt={member.name} className="w-5 h-5 rounded-full" />
                      <span>{member.name}</span>
                      {selected && <span className="text-purple-400">✓</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            {selectedMembers.length > 0 && (
              <div>
                <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.selectLeader')}</label>
                <select
                  className="input w-full"
                  value={selectedLeader}
                  onChange={e => setSelectedLeader(e.target.value)}
                >
                  <option value="">{t('team.selectLeaderPlaceholder')}</option>
                  {dept.members.filter(m => selectedMembers.includes(m.id)).map(m => (
                    <option key={m.id} value={m.id}>{m.name} - {m.role}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNewTeam(false)}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                disabled={!teamName || selectedMembers.length === 0 || !selectedLeader || loading}
                onClick={handleCreateTeam}
              >
                {loading ? t('common.loading') : t('team.createBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Requirements list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">{t('dept.detail.requirements')}</h2>
            {!showNewReq && (
              <button
                className="text-xs text-[var(--accent)] hover:underline"
                onClick={() => { setShowNewReq(true); setNewReqTitle(''); setNewReqDesc(''); setNewReqWorkspaceDir(''); }}
              >
                + {t('dept.newReq.btn')}
              </button>
            )}
          </div>
          {deptRequirements.length > 0 ? (
            <div className="space-y-2">
              {deptRequirements.map((req) => {
                const statusCfg = {
                  pending: { label: t('requirements.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30', icon: '⏳' },
                  planning: { label: t('requirements.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30', icon: '📝' },
                  in_progress: { label: t('requirements.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30', icon: '⚙️' },
                  pending_approval: { label: t('requirements.status.pending_approval'), color: 'text-orange-400', bg: 'bg-orange-900/30', icon: '🔍' },
                  completed: { label: t('requirements.stats.completed'), color: 'text-green-400', bg: 'bg-green-900/30', icon: '✅' },
                  failed: { label: t('requirements.status.failed'), color: 'text-red-400', bg: 'bg-red-900/30', icon: '❌' },
                };
                const st = statusCfg[req.status] || statusCfg.pending;
                return (
                  <div
                    key={req.id}
                    className="card cursor-pointer hover:border-[var(--accent)]/30 transition-all"
                    onClick={() => navigateToRequirement(req.id)}
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
                        <button
                          onClick={(e) => { e.stopPropagation(); restartRequirement(req.id); }}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 transition-colors"
                          title={t('reqDetail.live.restart')}
                        >🔄</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (confirm(t('reqDetail.live.confirmDelete'))) deleteRequirement(req.id); }}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/15 hover:bg-red-600/25 text-red-400 transition-colors"
                          title={t('reqDetail.live.deleteReq')}
                        >🗑️</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card text-center py-8 text-[var(--muted)]">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">{t('requirements.empty')}</p>
              {!showNewReq && (
                <button
                  className="btn-secondary mt-3 text-sm"
                  onClick={() => { setShowNewReq(true); setNewReqTitle(''); setNewReqDesc(''); setNewReqWorkspaceDir(''); }}
                >
                  {t('dept.newReq.btn')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Teams list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">👥 {t('team.teamsTitle')}</h2>
            {!showNewTeam && (
              <button
                className="text-xs text-purple-400 hover:underline"
                onClick={() => { setShowNewTeam(true); setTeamName(''); setTeamDesc(''); setSelectedMembers([]); setSelectedLeader(''); }}
              >
                + {t('team.newTeamBtn')}
              </button>
            )}
          </div>
          {deptTeams.length > 0 ? (
            <div className="space-y-2">
              {deptTeams.map(team => {
                const teamMembers = (team.memberIds || [])
                  .map(mid => dept.members.find(m => m.id === mid))
                  .filter(Boolean);
                return (
                <div
                  key={team.id}
                  className="card cursor-pointer hover:border-purple-500/30 transition-all"
                  onClick={() => navigateToTeam(team.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">👥</span>
                      <span className="text-sm font-medium">{team.name}</span>
                      {team.leaderName && (
                        <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">👔 {team.leaderName}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center -space-x-1.5">
                        {teamMembers.slice(0, 5).map(m => (
                          <CachedAvatar key={m.id} src={m.avatar} alt={m.name} className="w-5 h-5 rounded-full ring-1 ring-[var(--card)]" />
                        ))}
                        {teamMembers.length > 5 && (
                          <span className="w-5 h-5 rounded-full bg-white/10 ring-1 ring-[var(--card)] flex items-center justify-center text-[8px] text-[var(--muted)]">+{teamMembers.length - 5}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--muted)]">🔄 {team.sprintCount || 0}</span>
                    </div>
                  </div>
                  {team.description && <p className="text-xs text-[var(--muted)] mt-1 truncate">{team.description}</p>}
                </div>
                );
              })}
            </div>
          ) : (
            <div className="card text-center py-6 text-[var(--muted)]">
              <div className="text-2xl mb-2">👥</div>
              <p className="text-sm">{t('team.noTeams')}</p>
              {!showNewTeam && (
                <button
                  className="btn-secondary mt-3 text-sm"
                  onClick={() => { setShowNewTeam(true); setTeamName(''); setTeamDesc(''); setSelectedMembers([]); setSelectedLeader(''); }}
                >
                  {t('team.newTeamBtn')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Member list */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">{t('dept.detail.members')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dept.members.map((member) => (
              <div
                key={member.id}
                className="card hover:border-[var(--accent)]/30 transition-all cursor-pointer group"
                onClick={() => setSelectedAgent(member.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <CachedAvatar src={member.avatar} alt={member.name} className="w-12 h-12 rounded-full bg-[var(--border)]" />
                    {member.avgScore >= 80 && (
                      <span className="absolute -top-1 -right-1 text-xs animate-pulse drop-shadow-lg">🌸</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{member.name}</span>
                      {dept.leader === member.id && (
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
                      setChatAgent({ id: member.id, name: member.name, avatar: member.avatar, role: member.role, signature: member.signature, department: dept.name });
                    }}
                  >
                    💬
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-sm transition-opacity"
                    title={t('dept.dismiss.title')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDismissTarget({ deptId: dept.id, agentId: member.id, name: member.name });
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

        {/* Project reports */}
        {deptReports.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">{t('dept.detail.reports')}</h2>
            <div className="space-y-2">
              {deptReports.map((pr, i) => {
                const r = pr.reports.find(r => r.department === dept.name);
                if (!r) return null;
                return (
                  <div key={i} className="card text-sm flex items-center justify-between">
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
        )}
      </div>

      {/* ========== Sub-modals ========== */}

      {/* Requirement detail modal */}
      {activeReqId && (
        <RequirementDetail
          requirementId={activeReqId}
          onClose={() => setActiveReqId(null)}
        />
      )}

      {/* Agent detail modal */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}

      {/* Agent chat modal */}
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

      {/* Dismiss confirm modal */}
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

      {/* Disband department confirm modal */}
      {showDisband && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowDisband(false)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">{t('dept.detail.disbandBtn')}</h3>
            <p className="text-sm">
              {t('dept.disband.desc', { name: '' })}<strong>{dept.name}</strong>
              <br />{t('dept.disband.descSuffix')}
            </p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('dept.disband.reasonLabel')}</label>
              <input className="input w-full" placeholder={t('dept.disband.reasonPlaceholder')} value={disbandReason} onChange={e => setDisbandReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setShowDisband(false)}>{t('common.cancel')}</button>
              <button className="btn-danger flex-1" onClick={handleDisband} disabled={loading}>
                {loading ? t('dept.disband.disbanding') : t('dept.disband.confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust workforce modal */}
      {showAdjust && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowAdjust(false); setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan || pendingPlan.type !== 'adjustment' ? (
              <>
                <h3 className="text-lg font-semibold">{t('dept.detail.adjustBtn')}</h3>
                <p className="text-sm text-[var(--muted)]">{t('dept.adjust.desc')}</p>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">{t('dept.adjust.currentDept')}</div>
                  <div className="font-medium">{dept.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    {t('dept.adjust.currentMembers', { n: dept.members.length })}
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
                  <button className="btn-secondary flex-1" onClick={() => setShowAdjust(false)}>{t('common.cancel')}</button>
                  <button className="btn-primary flex-1" disabled={!adjustGoal || loading} onClick={handleAdjustPlan}>
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
                {pendingPlan.hires?.length > 0 && (
                  <div className="bg-green-900/10 border border-green-500/20 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-green-400 mb-1">{t('dept.adjust.hiresTitle', { n: pendingPlan.hires.length })}</div>
                    {pendingPlan.hires.map((h, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                        <span>🤖</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{h.name}</div>
                          <div className="text-xs text-[var(--muted)]">{h.templateTitle || h.templateId}</div>
                          {h.providerName && <div className="text-[10px] text-purple-400/80 mt-0.5">⚡ {h.providerName}</div>}
                          {h.reason && <div className="text-[10px] text-blue-400/70 mt-0.5">💡 {h.reason}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {pendingPlan.fires?.length === 0 && pendingPlan.hires?.length === 0 && (
                  <div className="text-center text-[var(--muted)] py-4">{t('dept.adjust.noChanges')}</div>
                )}
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>{t('overview.planReview.rejectBtn')}</button>
                  <button
                    className="btn-primary flex-1"
                    disabled={loading || (pendingPlan.fires?.length === 0 && pendingPlan.hires?.length === 0)}
                    onClick={async () => { await confirmAdjustment(pendingPlan.planId); setShowAdjust(false); }}
                  >
                    {loading ? t('dept.adjust.executing') : t('dept.adjust.approveBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Folder browser modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowFolderBrowser(false)}>
          <div className="card max-w-lg w-full mx-4 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">📁 {t('dept.newReq.browseTitle')}</h3>
              <button onClick={() => setShowFolderBrowser(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
            </div>
            <div className="flex items-center gap-2 py-2 px-1 bg-[var(--background)] rounded-lg mt-3 mb-2">
              <span className="text-xs text-[var(--muted)] shrink-0">📍</span>
              <span className="text-xs font-mono text-[var(--foreground)] truncate">{browseCurrentPath}</span>
            </div>
            <div className="flex-1 overflow-auto space-y-0.5 min-h-[200px]">
              {browseLoading ? (
                <div className="text-center py-8 text-[var(--muted)] text-sm animate-pulse">{t('common.loading')}</div>
              ) : (
                <>
                  {browseParentPath !== null && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors text-sm"
                      onClick={() => fetchDirs(browseParentPath)}
                    >
                      <span>📂</span>
                      <span className="text-[var(--muted)]">..</span>
                    </div>
                  )}
                  {browseDirs.length === 0 && !browseLoading && (
                    <div className="text-center py-6 text-xs text-[var(--muted)]">{t('dept.newReq.emptyDir')}</div>
                  )}
                  {browseDirs.map((dir) => (
                    <div
                      key={dir.path}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors text-sm group"
                      onClick={() => fetchDirs(dir.path)}
                    >
                      <span>📁</span>
                      <span className="flex-1 truncate">{dir.name}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="flex gap-2 pt-3 border-t border-[var(--border)] mt-2">
              <button className="btn-secondary flex-1" onClick={() => setShowFolderBrowser(false)}>{t('common.cancel')}</button>
              <button
                className="btn-primary flex-1"
                onClick={() => { setNewReqWorkspaceDir(browseCurrentPath); setShowFolderBrowser(false); }}
              >
                {t('dept.newReq.selectDir')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
