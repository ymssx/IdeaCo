'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import AgentDetailModal from './AgentDetailModal';
import OrgTree from './OrgTree';
import RequirementDetail from './RequirementDetail';

export default function DepartmentView() {
  const {
    company, dismissAgent, planDepartment, confirmPlan, pendingPlan, setPendingPlan,
    planAdjustment, confirmAdjustment, disbandDepartment, loading,
    fetchDepartmentRequirements,
  } = useStore();

  // 弹窗状态
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showOrgTree, setShowOrgTree] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detailDept, setDetailDept] = useState(null); // 部门详情弹窗
  const [showAdjust, setShowAdjust] = useState(null); // 调整弹窗 departmentId
  const [showDisband, setShowDisband] = useState(null); // 解散确认 departmentId
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const [disbandReason, setDisbandReason] = useState('');
  const [adjustGoal, setAdjustGoal] = useState('');
  const [activeReqId, setActiveReqId] = useState(null); // 需求详情
  const [deptRequirements, setDeptRequirements] = useState([]); // 部门需求列表

  // 创建部门
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');

  if (!company) return null;

  const handleDismiss = async () => {
    if (!dismissTarget) return;
    try {
      await dismissAgent(dismissTarget.deptId, dismissTarget.agentId, dismissReason || '老板决定');
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
      await disbandDepartment(showDisband, disbandReason || '组织调整');
      setShowDisband(null);
      setDisbandReason('');
      setDetailDept(null);
    } catch (e) { /* handled */ }
  };

  // 获取当前详情部门的最新数据
  const currentDetailDept = detailDept ? company.departments.find(d => d.id === detailDept) : null;

  // 加载部门需求
  useEffect(() => {
    if (detailDept) {
      fetchDepartmentRequirements(detailDept).then(setDeptRequirements);
    }
  }, [detailDept]);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🏢 公司架构</h1>
          <p className="text-sm text-[var(--muted)] mt-1">管理你的部门帝国——建制、调度、优化一条龙</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowOrgTree(true)}
            className="btn-secondary flex items-center gap-1.5"
          >
            🌳 查看架构树
          </button>
          <button
            onClick={() => { setShowCreate(true); setPendingPlan && setPendingPlan(null); }}
            className="btn-primary"
          >
            ➕ 开设新部门
          </button>
        </div>
      </div>

      {/* 部门列表 */}
      {company.departments.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">🏗️</div>
          <p className="text-lg">还没有部门</p>
          <p className="text-sm mt-1">开设一个吧，秘书会帮你组建一支永不疲倦的AI团队</p>
        </div>
      ) : (
        <div className="space-y-4">
          {company.departments.map((dept) => (
            <div key={dept.id} className="card hover:border-[var(--accent)]/20 transition-all">
              {/* 部门头部 - 点击打开详情 */}
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
                  <span className="text-sm text-[var(--muted)]">{dept.members.length} 人</span>
                  <span className="text-[var(--muted)] text-xs">点击查看详情 →</span>
                </div>
              </div>

              {/* 员工头像预览 */}
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
                {/* 快捷操作按钮 */}
                <button
                  className="text-xs text-[var(--muted)] hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-blue-900/10"
                  onClick={(e) => { e.stopPropagation(); setShowAdjust(dept.id); setAdjustGoal(''); setPendingPlan(null); }}
                >
                  🔧 调整人力
                </button>
                <button
                  className="text-xs text-[var(--muted)] hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-900/10"
                  onClick={(e) => { e.stopPropagation(); setShowDisband(dept.id); setDisbandReason(''); }}
                >
                  💣 解散
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========== 架构树弹窗 ========== */}
      {showOrgTree && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowOrgTree(false)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-5xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">🌳 公司架构树</h2>
              <button onClick={() => setShowOrgTree(false)} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
            </div>
            <div className="p-2">
              <OrgTree embedded />
            </div>
          </div>
        </div>
      )}

      {/* ========== 部门详情弹窗 ========== */}
      {currentDetailDept && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => setDetailDept(null)}>
          <div className="card max-w-3xl w-full mx-4 max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {/* 头部 */}
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
                  <span>👥 {currentDetailDept.members.length} 人</span>
                  <span>💰 ${(currentDetailDept.tokenUsage?.totalCost || 0).toFixed(4)}</span>
                  <span>🔢 {(currentDetailDept.tokenUsage?.totalTokens || 0).toLocaleString()} tokens</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1.5 rounded-lg transition-colors"
                  onClick={() => { setShowAdjust(currentDetailDept.id); setAdjustGoal(''); setPendingPlan(null); }}
                >
                  🔧 调整人力
                </button>
                <button
                  className="text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-3 py-1.5 rounded-lg transition-colors"
                  onClick={() => { setShowDisband(currentDetailDept.id); setDisbandReason(''); }}
                >
                  💣 解散部门
                </button>
                <button onClick={() => setDetailDept(null)} className="text-[var(--muted)] hover:text-white text-xl ml-2">✕</button>
              </div>
            </div>

            {/* 成员列表 */}
            <div className="mt-4">
              <h3 className="text-sm font-medium text-[var(--muted)] mb-3">👥 部门成员</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentDetailDept.members.map((member) => (
                  <div
                    key={member.id}
                    className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 hover:border-[var(--accent)]/30 transition-all cursor-pointer group"
                    onClick={() => setSelectedAgent(member.id)}
                  >
                    <div className="flex items-start gap-3">
                      <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full bg-[var(--border)]" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{member.name}</span>
                          {currentDetailDept.leader === member.id && (
                            <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">👔 负责人</span>
                          )}
                          <span className={`status-dot ${member.status}`} />
                        </div>
                        <div className="text-xs text-[var(--muted)]">{member.role}</div>
                        <div className="text-[10px] text-[var(--muted)] italic mt-1 truncate">"{member.signature}"</div>
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-sm transition-opacity"
                        title="解聘"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDismissTarget({ deptId: currentDetailDept.id, agentId: member.id, name: member.name });
                        }}
                      >
                        🔥
                      </button>
                    </div>

                    {/* 标签 */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">{member.provider.name}</span>
                      {member.avgScore && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          member.avgScore >= 80 ? 'bg-green-900/30 text-green-400' :
                          member.avgScore >= 60 ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-red-900/30 text-red-400'
                        }`}>
                          绩效 {member.avgScore}
                        </span>
                      )}
                      <span className="text-[10px] bg-purple-900/30 text-purple-400 px-1.5 py-0.5 rounded">
                        记忆 {(member.memory?.shortTermCount || 0) + (member.memory?.longTermCount || 0)}
                      </span>
                      {member.taskCount > 0 && (
                        <span className="text-[10px] bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded">
                          任务 {member.taskCount}
                        </span>
                      )}
                      {member.tokenUsage?.totalTokens > 0 && (
                        <span className="text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded">
                          ${(member.tokenUsage.totalCost || 0).toFixed(4)}
                        </span>
                      )}
                    </div>

                    {/* 技能 */}
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

            {/* 需求列表 */}
            {deptRequirements.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <h3 className="text-sm font-medium text-[var(--muted)] mb-3">📋 需求列表</h3>
                <div className="space-y-2">
                  {deptRequirements.map((req) => {
                    const statusCfg = {
                      pending: { label: '待处理', color: 'text-gray-400', bg: 'bg-gray-900/30', icon: '⏳' },
                      planning: { label: '规划中', color: 'text-blue-400', bg: 'bg-blue-900/30', icon: '📝' },
                      in_progress: { label: '执行中', color: 'text-yellow-400', bg: 'bg-yellow-900/30', icon: '⚙️' },
                      completed: { label: '已完成', color: 'text-green-400', bg: 'bg-green-900/30', icon: '✅' },
                      failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-900/30', icon: '❌' },
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

            {/* 项目汇报 */}            {company.progressReports?.length > 0 && (() => {
              const deptReports = company.progressReports
                .slice().reverse()
                .filter(pr => pr.reports.some(r => r.department === currentDetailDept.name))
                .slice(0, 5);
              if (deptReports.length === 0) return null;
              return (
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <h3 className="text-sm font-medium text-[var(--muted)] mb-3">📊 项目汇报</h3>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {deptReports.map((pr, i) => {
                      const r = pr.reports.find(r => r.department === currentDetailDept.name);
                      if (!r) return null;
                      return (
                        <div key={i} className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2.5 text-sm flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--muted)]">{new Date(pr.time).toLocaleString('zh')}</span>
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

      {/* 需求详情弹窗 */}
      {activeReqId && (
        <RequirementDetail
          requirementId={activeReqId}
          onClose={() => setActiveReqId(null)}
        />
      )}

      {/* ========== Agent详情弹窗 ========== */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}

      {/* ========== 解聘确认弹窗 ========== */}
      {dismissTarget && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => setDismissTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">🔥 解聘确认</h3>
            <p className="text-sm">确定要解聘 <strong>{dismissTarget.name}</strong> 吗？解雇后TA将进入人才市场等待重新被分配。</p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">解聘原因</label>
              <input className="input w-full" placeholder="如：岗位调整" value={dismissReason} onChange={e => setDismissReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setDismissTarget(null)}>取消</button>
              <button className="btn-danger flex-1" onClick={handleDismiss}>确认解聘</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 解散部门确认弹窗 ========== */}
      {showDisband && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowDisband(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">💣 解散部门</h3>
            <p className="text-sm">
              确定要解散 <strong>{company.departments.find(d => d.id === showDisband)?.name}</strong> 吗？
              <br />所有成员将被解聘并进入人才市场。
            </p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">解散原因</label>
              <input className="input w-full" placeholder="如：业务方向调整" value={disbandReason} onChange={e => setDisbandReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setShowDisband(null)}>取消</button>
              <button className="btn-danger flex-1" onClick={handleDisband} disabled={loading}>
                {loading ? '💥 解散中...' : '确认解散'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 调整人力弹窗（两步流程） ========== */}
      {showAdjust && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowAdjust(null); setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan || pendingPlan.type !== 'adjustment' ? (
              <>
                <h3 className="text-lg font-semibold">🔧 调整人力</h3>
                <p className="text-sm text-[var(--muted)]">
                  告诉秘书你的调整目标，TA会分析当前人员配置，决定是扩招还是裁员（或两者结合）。
                </p>
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)] mb-1">当前部门</div>
                  <div className="font-medium">{company.departments.find(d => d.id === showAdjust)?.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    成员: {company.departments.find(d => d.id === showAdjust)?.members.length} 人
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">调整目标</label>
                  <textarea
                    className="input w-full h-20 resize-none"
                    placeholder="如：'增加一个前端工程师' / '砍掉绩效低的' / '团队太大了精简到3人' / '增加数据分析能力'"
                    value={adjustGoal}
                    onChange={e => setAdjustGoal(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowAdjust(null)}>取消</button>
                  <button className="btn-primary flex-1" disabled={!adjustGoal || loading} onClick={() => handleAdjustPlan(showAdjust)}>
                    {loading ? '🧠 秘书在分析...' : '📋 生成调整方案'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">📋 调整方案审批</h3>
                <p className="text-sm text-[var(--muted)]">
                  秘书为「{pendingPlan.departmentName}」制定的调整方案：
                </p>

                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">🧠 秘书分析</div>
                    <div className="text-sm text-[var(--muted)]">{pendingPlan.reasoning}</div>
                  </div>
                )}

                {/* 裁员列表 */}
                {pendingPlan.fires?.length > 0 && (
                  <div className="bg-red-900/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-red-400 mb-1">🔥 裁员 ({pendingPlan.fires.length}人)</div>
                    {pendingPlan.fires.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-red-400">✕</span>
                        <span className="font-medium">{f.name}</span>
                        <span className="text-xs text-[var(--muted)]">- {f.reason}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 扩招列表 */}
                {pendingPlan.hires?.length > 0 && (
                  <div className="bg-green-900/10 border border-green-500/20 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-green-400 mb-1">➕ 扩招 ({pendingPlan.hires.length}人)</div>
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
                    秘书认为当前人员配置已经合理，无需调整 🤷
                  </div>
                )}

                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>打回重做</button>
                  <button
                    className="btn-primary flex-1"
                    disabled={loading || (pendingPlan.fires?.length === 0 && pendingPlan.hires?.length === 0)}
                    onClick={handleConfirm}
                  >
                    {loading ? '🔨 执行中...' : '✅ 批准执行'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========== 创建部门弹窗（两步流程） ========== */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowCreate(false); setPendingPlan && setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan || pendingPlan.type === 'adjustment' ? (
              <>
                <h3 className="text-lg font-semibold">🏢 开设新部门</h3>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">部门名称</label>
                  <input className="input w-full" placeholder="如：永动机编程部" value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">部门使命</label>
                  <textarea className="input w-full h-24 resize-none" placeholder="详细描述这个部门要做什么——秘书会根据你的需求来规划人力" value={deptMission} onChange={e => setDeptMission(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowCreate(false)}>算了</button>
                  <button className="btn-primary flex-1" disabled={!deptName || !deptMission || loading} onClick={handlePlan}>
                    {loading ? '🧠 秘书在规划...' : '📋 生成方案'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">📋 招聘方案审批</h3>
                <p className="text-sm text-[var(--muted)]">秘书为「{pendingPlan.departmentName}」规划的团队：</p>

                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">🧠 秘书分析</div>
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
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>打回重做</button>
                  <button className="btn-primary flex-1" disabled={loading} onClick={handleConfirm}>
                    {loading ? '🔨 招聘中...' : '✅ 批准招人'}
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
