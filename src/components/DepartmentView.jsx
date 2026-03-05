'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import OrgTree from './OrgTree';
import { useI18n } from '@/lib/i18n';

export default function DepartmentView() {
  const { t } = useI18n();
  const {
    company, planDepartment, confirmPlan, pendingPlan, setPendingPlan,
    planAdjustment, confirmAdjustment, disbandDepartment, loading,
    navigateToDepartment,
  } = useStore();

  // Modal states
  const [showOrgTree, setShowOrgTree] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdjust, setShowAdjust] = useState(null); // Adjust modal departmentId
  const [showDisband, setShowDisband] = useState(null); // Disband confirm departmentId
  const [disbandReason, setDisbandReason] = useState('');
  const [adjustGoal, setAdjustGoal] = useState('');

  // Create department
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');

  if (!company) return null;

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
    } catch (e) { /* handled */ }
  };

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
                onClick={() => navigateToDepartment(dept.id)}
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
                          {h.providerName && <div className="text-[10px] text-purple-400/80 mt-0.5">⚡ {h.providerName}</div>}
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
                        {m.providerName && <div className="text-[10px] text-purple-400/80 mt-0.5">⚡ {m.providerName}</div>}
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
