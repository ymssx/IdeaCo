'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';

export default function TalentMarket() {
  const { company, recallAgent, deleteTalent } = useStore();
  const [recallTarget, setRecallTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [targetDept, setTargetDept] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!company) return null;

  const talents = company.talentMarket || [];
  const departments = company.departments || [];

  const handleRecall = async () => {
    if (!recallTarget || !targetDept) return;
    try {
      await recallAgent(recallTarget.id, targetDept);
      setRecallTarget(null);
      setTargetDept('');
    } catch (e) { /* handled */ }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">🏪 人才市场</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          被解聘的员工在此等待新机会，可被召回至任意部门
        </p>
      </div>

      {talents.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">🏪</div>
          <p className="text-lg">人才市场暂时没有人</p>
          <p className="text-sm mt-1">解聘的员工会自动进入人才市场</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {talents.map((talent) => (
            <div key={talent.id} className="card relative">
              {/* 右上角操作按钮 */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                <button
                  className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-2.5 py-1 rounded-lg transition-colors"
                  title="召回至部门"
                  onClick={() => setRecallTarget(talent)}
                  disabled={departments.length === 0}
                >
                  📞 召回
                </button>
                <button
                  className="text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-2.5 py-1 rounded-lg transition-colors"
                  title="彻底删除"
                  onClick={() => setDeleteTarget(talent)}
                >
                  🗑
                </button>
              </div>

              <div className="flex items-center justify-between mb-3 pr-16">
                <div>
                  <h3 className="font-semibold">{talent.name}</h3>
                  <div className="text-xs text-[var(--muted)]">{talent.role}</div>
                </div>
                {talent.performanceScore && (
                  <span className={`text-sm font-bold ${
                    talent.performanceScore >= 80 ? 'text-green-400' :
                    talent.performanceScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {talent.performanceScore}分
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {talent.skills.map((s, i) => (
                  <span key={i} className="text-[10px] bg-white/5 text-[var(--muted)] px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>

              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>📤 解聘原因: {talent.dismissalReason}</div>
                <div>🧠 携带记忆: {talent.memoryCount} 条</div>
                {talent.registeredAt && (
                  <div>📅 进入市场: {new Date(talent.registeredAt).toLocaleDateString('zh')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 召回弹窗 */}
      {recallTarget && (
<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setRecallTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">📞 召回 {recallTarget.name}</h3>
            <p className="text-sm text-[var(--muted)]">
              选择目标部门，TA将携带原有记忆和技能重新入职
            </p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">目标部门</label>
              <select
                className="input w-full"
                value={targetDept}
                onChange={e => setTargetDept(e.target.value)}
              >
                <option value="">请选择部门</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setRecallTarget(null)}>取消</button>
              <button className="btn-primary flex-1" disabled={!targetDept} onClick={handleRecall}>确认召回</button>
            </div>
          </div>
        </div>
      )}
      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setDeleteTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">🗑 删除 {deleteTarget.name}</h3>
            <p className="text-sm text-[var(--muted)]">
              确定要彻底删除该人才吗？删除后将无法恢复，同时会清除此人在邮箱中的所有消息。
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>取消</button>
              <button
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteTalent(deleteTarget.id);
                    setDeleteTarget(null);
                  } catch (e) { /* handled */ }
                  setDeleting(false);
                }}
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
