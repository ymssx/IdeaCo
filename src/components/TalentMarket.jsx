'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

export default function TalentMarket({ asModal = false, onClose = null }) {
  const { t } = useI18n();
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

  const content = (
    <div className={asModal ? 'space-y-4' : 'p-6 space-y-6 animate-fade-in'}>
      {!asModal && (
        <div>
          <h1 className="text-2xl font-bold">{t('talent.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t('talent.subtitle')}
          </p>
        </div>
      )}

      {talents.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">🏪</div>
          <p className="text-lg">{t('talent.empty')}</p>
          <p className="text-sm mt-1">{t('talent.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {talents.map((talent) => (
            <div key={talent.id} className="card relative">
              {/* Top right action buttons */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                <button
                  className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-2.5 py-1 rounded-lg transition-colors"
                  title={t('talent.recallBtn')}
                  onClick={() => setRecallTarget(talent)}
                  disabled={departments.length === 0}
                >{t('talent.recallBtn')}</button>
                <button
                  className="text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-2.5 py-1 rounded-lg transition-colors"
                  title={t('talent.deleteBtn')}
                  onClick={() => setDeleteTarget(talent)}
                >
                  🗑
                </button>
              </div>

              <div className="flex items-center justify-between mb-3 pr-16">
                <div>
                  <h3 className="font-semibold">{talent.name}</h3>
                  <div className="text-xs text-[var(--muted)]">
{talent.gender === 'female' ? '👩' : '👨'}{talent.age ? ` ${t('display.ageYears', { n: talent.age })}` : ''} · {talent.role}
                  </div>
                </div>
                {talent.performanceScore && (
                  <span className={`text-sm font-bold ${
                    talent.performanceScore >= 80 ? 'text-green-400' :
                    talent.performanceScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {t('talent.score', { score: talent.performanceScore })}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {talent.skills.map((s, i) => (
                  <span key={i} className="text-[10px] bg-white/5 text-[var(--muted)] px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>

              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>{t('talent.dismissReason', { reason: talent.dismissalReason })}</div>
                <div>{t('talent.memoryCount', { n: talent.memoryCount })}</div>
                {talent.registeredAt && (
                  <div>{t('talent.registeredAt', { date: new Date(talent.registeredAt).toLocaleDateString() })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recall modal */}
      {recallTarget && (
<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setRecallTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('talent.recall.title', { name: recallTarget.name })}</h3>
            <p className="text-sm text-[var(--muted)]">
              {t('talent.recall.desc', { name: recallTarget.name })}
            </p>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('talent.recall.deptLabel')}</label>
              <select
                className="input w-full"
                value={targetDept}
                onChange={e => setTargetDept(e.target.value)}
              >
                <option value="">{t('talent.recall.deptPlaceholder')}</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setRecallTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-primary flex-1" disabled={!targetDept} onClick={handleRecall}>{t('talent.recall.confirmBtn')}</button>
            </div>
          </div>
        </div>
      )}
      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setDeleteTarget(null)}>
          <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">{t('talent.deleteConfirm.title', { name: deleteTarget.name })}</h3>
            <p className="text-sm text-[var(--muted)]">
              {t('talent.deleteConfirm.desc', { name: deleteTarget.name })}
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
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
                {deleting ? t('talent.deleteConfirm.deleting') : t('talent.deleteConfirm.confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (asModal) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Modal header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <div>
              <h2 className="text-lg font-bold">{t('talent.title')}</h2>
              <p className="text-xs text-[var(--muted)]">{t('talent.subtitle')}</p>
            </div>
            <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl px-2">✕</button>
          </div>
          {/* Modal body */}
          <div className="overflow-auto p-4">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return content;
}
