'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';

export default function Overview() {
  const { company, planDepartment, confirmPlan, pendingPlan, setPendingPlan, loading, setActiveTab, fetchRequirements, navigateToRequirement } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [activeReqId, setActiveReqId] = useState(null); // unused, kept for compat

  if (!company) return null;

  // 加载需求列表
  useEffect(() => {
    fetchRequirements().then(setRequirements);
  }, [company]);

  // 第一步：生成招聘方案
  const handlePlan = async () => {
    if (!deptName || !deptMission) return;
    try {
      await planDepartment(deptName, deptMission);
    } catch (e) { /* handled */ }
  };

  // 第二步：确认方案
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

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">🏠 资本家的仪表盘</h1>
        <p className="text-sm text-[var(--muted)] mt-1">你的AI奴隶帝国运营概况——一切尽在掌控</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: '剥削部门', value: deptCount, icon: '🏭', color: 'blue' },
          { label: '打工AI', value: agentCount, icon: '🤖', color: 'green' },
          { label: '供应商', value: enabledProviders, icon: '⚡', color: 'purple' },
          { label: '待榨人才', value: talentCount, icon: '🏪', color: 'yellow' },
          { label: '烧掉的钱', value: `$${(budget.totalCost || 0).toFixed(4)}`, icon: '🔥', color: 'red', isText: true },
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

      {/* 预算管理 */}
      <div>
        <h2 className="text-lg font-semibold mb-3">💸 血汗预算</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <div className="text-sm text-[var(--muted)] mb-2">公司总烧钱</div>
            <div className="text-2xl font-bold text-red-400">${(budget.totalCost || 0).toFixed(4)}</div>
            <div className="text-xs text-[var(--muted)] mt-1">Token: {(budget.totalTokens || 0).toLocaleString()}</div>
            <div className="flex gap-4 mt-3 text-xs">
              <div><span className="text-[var(--muted)]">秘书: </span><span className="text-blue-400">{(budget.secretaryUsage?.totalTokens || 0).toLocaleString()}</span></div>
              <div><span className="text-[var(--muted)]">HR: </span><span className="text-purple-400">{(budget.hrUsage?.totalTokens || 0).toLocaleString()}</span></div>
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
                      <img src={m.avatar} alt="" className="w-4 h-4 rounded-full" />
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

      {/* 需求管理 */}
      {/* 创建部门弹窗（两步流程） */}
      {showCreate && (
<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={() => { setShowCreate(false); setPendingPlan(null); }}>
          <div className="card max-w-lg w-full mx-4 space-y-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {!pendingPlan ? (
              <>
                <h3 className="text-lg font-semibold">🏭 开设新部门</h3>
                <p className="text-sm text-[var(--muted)]">
                  描述你想榨取什么价值，秘书会设计一个「最优」（最便宜）的团队方案
                </p>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">部门名称</label>
                  <input className="input w-full" placeholder="如：无休止加班部" value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">部门使命（越具体招的人越精准）</label>
                  <textarea className="input w-full h-24 resize-none" placeholder="如：开发一个让用户上瘾的社交App" value={deptMission} onChange={e => setDeptMission(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-2">
                  <button className="btn-secondary flex-1" onClick={() => setShowCreate(false)}>算了不开了</button>
                  <button className="btn-primary flex-1" disabled={!deptName || !deptMission || loading} onClick={handlePlan}>
                    {loading ? '🧠 秘书正在规划...' : '📋 生成招聘方案'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">📋 招聘方案审批</h3>
                <p className="text-sm text-[var(--muted)]">
                  秘书给「{pendingPlan.departmentName}」规划了以下团队，请老板过目：
                </p>

                {/* 秘书分析推理 */}
                {pendingPlan.reasoning && (
                  <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                    <div className="text-xs font-medium text-blue-400 mb-1">🧠 秘书分析</div>
                    <div className="text-sm text-[var(--muted)]">{pendingPlan.reasoning}</div>
                  </div>
                )}

                {/* 方案展示 */}
                <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 space-y-2">
                  <div className="text-xs text-[var(--muted)]">使命: {pendingPlan.mission}</div>
                  <div className="text-xs text-[var(--muted)] mb-2">团队规模: {pendingPlan.members?.length || 0} 人</div>

                  {pendingPlan.members?.map((m, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${m.isLeader ? 'bg-yellow-900/10 border border-yellow-500/20' : 'bg-white/5'}`}>
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-full flex items-center justify-center text-xs">
                        {m.isLeader ? '👔' : '🤖'}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-xs text-[var(--muted)]">{m.title}</div>
                        {m.reason && <div className="text-[10px] text-blue-400/70 mt-0.5">💡 {m.reason}</div>}
                      </div>
                      <div className="text-right">
                        {m.isLeader && <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">负责人</span>}
                        {m.reportsTo && <span className="text-[10px] text-[var(--muted)]">→ {m.reportsTo}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <button className="btn-secondary flex-1" onClick={() => setPendingPlan(null)}>打回重做</button>
                  <button className="btn-primary flex-1" disabled={loading} onClick={handleConfirm}>
                    {loading ? '🔨 招聘中...' : '✅ 批准，开始招人'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 需求管理 */}
      {(company.requirements?.length > 0 || requirements.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">📋 需求看板</h2>
            <span className="text-xs text-[var(--muted)]">{(company.requirements || requirements).length} 个需求</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(company.requirements || requirements).map((req) => {
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

      {/* 需求详情已改为独立页面，不再使用弹窗 */}

      {/* 部门列表 */}
      <div>
<h2 className="text-lg font-semibold mb-3">🏢 旗下部门</h2>
        {deptCount === 0 ? (
          <div className="card text-center py-8 text-[var(--muted)]">
            <div className="text-4xl mb-3">🏗️</div>
            <p>还没有部门——你的AI奴隶帝国即将开张</p>
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
                      <img key={m.id} src={m.avatar} alt={m.name} title={`${m.name} (${m.role})`} className="w-7 h-7 rounded-full border-2 border-[var(--card)] bg-[var(--border)]" />
                    ))}
                  </div>
                  <span className="text-xs text-[var(--muted)]">{dept.members.length} 个苦力</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>



    </div>
  );
}
