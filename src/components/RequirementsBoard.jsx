'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

/**
 * Requirements board page
 * Manage all requirements, displayed by status category
 */
export default function RequirementsBoard() {
  const { t } = useI18n();
  const { company, fetchRequirements, navigateToRequirement } = useStore();
  const [requirements, setRequirements] = useState([]);
  const [filter, setFilter] = useState('all'); // all | in_progress | completed | failed

  useEffect(() => {
    fetchRequirements().then(setRequirements);
  }, [company]);

  // Auto refresh executing requirements
  useEffect(() => {
    const hasRunning = requirements.some(r => r.status === 'in_progress' || r.status === 'planning');
    if (!hasRunning) return;
    const timer = setInterval(() => {
      fetchRequirements().then(setRequirements);
    }, 5000);
    return () => clearInterval(timer);
  }, [requirements]);

  const filtered = filter === 'all' ? requirements : requirements.filter(r => r.status === filter);

  const statusCounts = {
    all: requirements.length,
    in_progress: requirements.filter(r => r.status === 'in_progress' || r.status === 'planning').length,
    completed: requirements.filter(r => r.status === 'completed').length,
    failed: requirements.filter(r => r.status === 'failed').length,
  };

  const statusConfig = {
    pending: { label: t('requirements.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30', icon: '⏳' },
    planning: { label: t('requirements.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30', icon: '📝' },
    in_progress: { label: t('requirements.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30', icon: '⚙️' },
    completed: { label: t('requirements.stats.completed'), color: 'text-green-400', bg: 'bg-green-900/30', icon: '✅' },
    failed: { label: t('requirements.status.failed'), color: 'text-red-400', bg: 'bg-red-900/30', icon: '❌' },
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">{t('requirements.title')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t('requirements.subtitle')}</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { key: 'all', label: t('requirements.stats.all'), icon: '📋', color: 'blue' },
          { key: 'in_progress', label: t('requirements.stats.inProgress'), icon: '⚙️', color: 'yellow' },
          { key: 'completed', label: t('requirements.stats.completed'), icon: '✅', color: 'green' },
          { key: 'failed', label: t('requirements.stats.failed'), icon: '❌', color: 'red' },
        ].map(stat => (
          <div
            key={stat.key}
            onClick={() => setFilter(stat.key)}
            className={`card cursor-pointer transition-all ${
              filter === stat.key ? 'ring-1 ring-[var(--accent)]' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{stat.icon}</span>
              <span className={`text-3xl font-bold text-${stat.color}-400`}>{statusCounts[stat.key]}</span>
            </div>
            <div className="text-sm text-[var(--muted)] mt-2">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Requirements list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)] col-span-3">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg">{t('requirements.empty')}</p>
          <p className="text-sm mt-1">{t('requirements.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(req => {
            const st = statusConfig[req.status] || statusConfig.pending;
            const progress = req.workflow && req.workflow.nodeCount > 0
              ? Math.round((req.workflow.completedCount / req.workflow.nodeCount) * 100)
              : (req.status === 'completed' ? 100 : 0);
            // SVG ring progress parameters
            const radius = 18;
            const stroke = 3;
            const circumference = 2 * Math.PI * radius;
            const dashOffset = circumference - (progress / 100) * circumference;
            const progressColor =
              req.status === 'completed' ? '#22c55e' :
              req.status === 'failed' ? '#ef4444' :
              'var(--accent)';

            return (
              <div
                key={req.id}
                className="card cursor-pointer hover:border-[var(--accent)]/30 transition-all flex flex-col"
                onClick={() => navigateToRequirement(req.id)}
              >
                {/* Top: progress ring + title + status */}
                <div className="flex items-center gap-3">
                  <div className="shrink-0 relative flex items-center justify-center" style={{ width: 40, height: 40 }}>
                    {progress === 100 ? (
                      <span className="text-xl">🎉</span>
                    ) : (
                      <>
                        <svg width="40" height="40" className="transform -rotate-90">
                          <circle
                            cx="20" cy="20" r={radius}
                            fill="none"
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth={stroke}
                          />
                          <circle
                            cx="20" cy="20" r={radius}
                            fill="none"
                            stroke={progressColor}
                            strokeWidth={stroke}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            className="transition-all duration-500"
                          />
                        </svg>
                        <span className="absolute text-[10px] font-bold" style={{ color: progressColor }}>
                          {`${progress}%`}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{req.title}</span>
                      {req.status === 'in_progress' && (
                        <span className="animate-pulse text-yellow-400 text-[10px]">⚙️</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color} inline-block mt-0.5`}>{st.label}</span>
                  </div>
                </div>

                {/* Description (multi-line support) */}
                <p className="text-xs text-[var(--muted)] line-clamp-3 mt-2 leading-relaxed">{req.description}</p>

                {/* Completion summary */}
                {req.summary && (
                  <div className="flex items-center gap-3 text-[10px] text-[var(--muted)] mt-2">
                    <span>{t('requirements.summary.success', { n: req.summary.successTasks, total: req.summary.totalTasks })}</span>
                    <span>{t('requirements.summary.duration', { n: Math.round((req.summary.totalDuration || 0) / 1000) })}</span>
                  </div>
                )}

                {/* Bottom info */}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <span>🏢 {req.departmentName}</span>
                    {req.workflow && (
                      <span>📊 {req.workflow.completedCount || 0}/{req.workflow.nodeCount || 0}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {req.chatCount > 0 && <span>💬 {req.chatCount}</span>}
                    {req.outputCount > 0 && <span>📦 {req.outputCount}</span>}
                    <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Requirement detail is now a standalone page */}
    </div>
  );
}
