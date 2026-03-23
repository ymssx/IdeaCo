'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

/**
 * Requirements Board — primary page for managing all requirements.
 * Includes: hero header, create requirement modal, search/filter,
 * stats overview, requirement cards grid, and onboarding guide.
 */
export default function RequirementsBoard() {
  const { t } = useI18n();
  const {
    company,
    fetchRequirements,
    navigateToRequirement,
    createRequirement,
    loading,
  } = useStore();

  const [requirements, setRequirements] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Create requirement form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDeptId, setNewDeptId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newWorkspaceDir, setNewWorkspaceDir] = useState('');
  const [creating, setCreating] = useState(false);

  // Folder browser state
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browseDirs, setBrowseDirs] = useState([]);
  const [browseCurrentPath, setBrowseCurrentPath] = useState('');
  const [browseParentPath, setBrowseParentPath] = useState(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  useEffect(() => {
    fetchRequirements().then(setRequirements);
  }, [company]);

  // Auto refresh running requirements
  useEffect(() => {
    const hasRunning = requirements.some(
      (r) => r.status === 'in_progress' || r.status === 'planning'
    );
    if (!hasRunning) return;
    const timer = setInterval(() => {
      fetchRequirements().then(setRequirements);
    }, 5000);
    return () => clearInterval(timer);
  }, [requirements]);

  // Auto-select first department when opening create modal
  useEffect(() => {
    if (showCreateModal && !newDeptId && departments.length > 0) {
      setNewDeptId(departments[0].id);
    }
  }, [showCreateModal]);

  const departments = company?.departments || [];

  const fetchDirs = async (dirPath) => {
    setBrowseLoading(true);
    try {
      const url = dirPath
        ? `/api/browse-dir?path=${encodeURIComponent(dirPath)}`
        : '/api/browse-dir';
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) return;
      setBrowseDirs(data.dirs || []);
      setBrowseCurrentPath(data.current || '');
      setBrowseParentPath(data.parent || null);
    } catch (e) {
      /* handled */
    }
    setBrowseLoading(false);
  };

  const handleCreate = async () => {
    if (!newTitle || !newDeptId) return;
    setCreating(true);
    try {
      const result = await createRequirement(
        newDeptId,
        newTitle,
        newDesc,
        newWorkspaceDir || undefined
      );
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      setNewWorkspaceDir('');
      setNewDeptId('');
      if (result?.id) {
        navigateToRequirement(result.id);
      }
      fetchRequirements().then(setRequirements);
    } catch (e) {
      /* handled by store */
    }
    setCreating(false);
  };

  // Filtering + search
  const filteredByStatus =
    filter === 'all'
      ? requirements
      : requirements.filter((r) => r.status === filter);
  const filtered = searchQuery
    ? filteredByStatus.filter(
        (r) =>
          r.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.departmentName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filteredByStatus;

  const statusCounts = {
    all: requirements.length,
    in_progress: requirements.filter(
      (r) =>
        r.status === 'in_progress' ||
        r.status === 'planning' ||
        r.status === 'pending_approval'
    ).length,
    completed: requirements.filter((r) => r.status === 'completed').length,
    failed: requirements.filter((r) => r.status === 'failed').length,
  };

  const statusConfig = {
    pending: {
      label: t('requirements.status.pending'),
      color: 'text-gray-400',
      bg: 'bg-gray-900/30',
      icon: '⏳',
    },
    planning: {
      label: t('requirements.status.planning'),
      color: 'text-blue-400',
      bg: 'bg-blue-900/30',
      icon: '📝',
    },
    in_progress: {
      label: t('requirements.status.in_progress'),
      color: 'text-yellow-400',
      bg: 'bg-yellow-900/30',
      icon: '⚙️',
    },
    pending_approval: {
      label: t('requirements.status.pending_approval'),
      color: 'text-orange-400',
      bg: 'bg-orange-900/30',
      icon: '🔍',
    },
    completed: {
      label: t('requirements.stats.completed'),
      color: 'text-green-400',
      bg: 'bg-green-900/30',
      icon: '✅',
    },
    failed: {
      label: t('requirements.status.failed'),
      color: 'text-red-400',
      bg: 'bg-red-900/30',
      icon: '❌',
    },
  };

  const hasDepartments = departments.length > 0;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* ===== Hero Header ===== */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('requirements.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t('requirements.subtitle')}
          </p>
        </div>
        <button
          className="btn-primary shrink-0 flex items-center gap-2 text-sm px-5 py-2.5"
          onClick={() => setShowCreateModal(true)}
          disabled={!hasDepartments}
          title={
            hasDepartments ? t('requirements.createBtn') : t('requirements.noDeptHint')
          }
        >
          <span className="text-lg leading-none">+</span>
          {t('requirements.createBtn')}
        </button>
      </div>

      {/* ===== Quick Guide (when no requirements) ===== */}
      {requirements.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: '🏢',
              title: t('requirements.guide.step1Title'),
              desc: t('requirements.guide.step1Desc'),
              done: hasDepartments,
            },
            {
              icon: '📝',
              title: t('requirements.guide.step2Title'),
              desc: t('requirements.guide.step2Desc'),
              done: false,
            },
            {
              icon: '🚀',
              title: t('requirements.guide.step3Title'),
              desc: t('requirements.guide.step3Desc'),
              done: false,
            },
          ].map((step, i) => (
            <div
              key={i}
              className={`card border transition-all ${
                step.done
                  ? 'border-green-500/30 bg-green-900/5'
                  : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    step.done
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-[var(--accent)]/20 text-[var(--accent)]'
                  }`}
                >
                  {step.done ? '✓' : i + 1}
                </div>
                <span className="text-lg">{step.icon}</span>
                <span className="font-semibold text-sm">{step.title}</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ===== Stats Cards ===== */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            key: 'all',
            label: t('requirements.stats.all'),
            icon: '📋',
            color: 'blue',
          },
          {
            key: 'in_progress',
            label: t('requirements.stats.inProgress'),
            icon: '⚙️',
            color: 'yellow',
          },
          {
            key: 'completed',
            label: t('requirements.stats.completed'),
            icon: '✅',
            color: 'green',
          },
          {
            key: 'failed',
            label: t('requirements.stats.failed'),
            icon: '❌',
            color: 'red',
          },
        ].map((stat) => (
          <div
            key={stat.key}
            onClick={() => setFilter(stat.key)}
            className={`card cursor-pointer transition-all ${
              filter === stat.key ? 'ring-1 ring-[var(--accent)]' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{stat.icon}</span>
              <span
                className={`text-3xl font-bold text-${stat.color}-400`}
              >
                {statusCounts[stat.key]}
              </span>
            </div>
            <div className="text-sm text-[var(--muted)] mt-2">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* ===== Search Bar (when there are requirements) ===== */}
      {requirements.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <input
              className="input w-full pl-3 pr-3 py-2 text-sm"
              placeholder={t('requirements.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] text-xs"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>
          <span className="text-xs text-[var(--muted)]">
            {t('requirements.showingCount', { n: filtered.length, total: requirements.length })}
          </span>
        </div>
      )}

      {/* ===== Requirements List ===== */}
      {filtered.length === 0 ? (
        <div className="card text-center py-16 text-[var(--muted)]">
          <div className="text-6xl mb-4">
            {requirements.length === 0 ? '📋' : '�'}
          </div>
          <p className="text-lg font-medium">
            {requirements.length === 0
              ? t('requirements.empty')
              : t('requirements.noMatchTitle')}
          </p>
          <p className="text-sm mt-2 max-w-md mx-auto">
            {requirements.length === 0
              ? t('requirements.emptyHint')
              : t('requirements.noMatchHint')}
          </p>
          {requirements.length === 0 && hasDepartments && (
            <button
              className="btn-primary mt-6 px-6"
              onClick={() => setShowCreateModal(true)}
            >
              {t('requirements.createFirstBtn')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((req) => {
            const st = statusConfig[req.status] || statusConfig.pending;
            const progress =
              req.workflow && req.workflow.nodeCount > 0
                ? Math.round(
                    (req.workflow.completedCount / req.workflow.nodeCount) *
                      100
                  )
                : req.status === 'completed' ||
                  req.status === 'pending_approval'
                ? 100
                : 0;
            const radius = 18;
            const stroke = 3;
            const circumference = 2 * Math.PI * radius;
            const dashOffset =
              circumference - (progress / 100) * circumference;
            const progressColor =
              req.status === 'completed'
                ? '#22c55e'
                : req.status === 'pending_approval'
                ? '#f97316'
                : req.status === 'failed'
                ? '#ef4444'
                : 'var(--accent)';

            return (
              <div
                key={req.id}
                className="card cursor-pointer hover:border-[var(--accent)]/30 transition-all flex flex-col"
                onClick={() => navigateToRequirement(req.id)}
              >
                {/* Top: progress ring + title + status */}
                <div className="flex items-center gap-3">
                  <div
                    className="shrink-0 relative flex items-center justify-center"
                    style={{ width: 40, height: 40 }}
                  >
                    {progress === 100 ? (
                      <span className="text-xl">🎉</span>
                    ) : (
                      <>
                        <svg
                          width="40"
                          height="40"
                          className="transform -rotate-90"
                        >
                          <circle
                            cx="20"
                            cy="20"
                            r={radius}
                            fill="none"
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth={stroke}
                          />
                          <circle
                            cx="20"
                            cy="20"
                            r={radius}
                            fill="none"
                            stroke={progressColor}
                            strokeWidth={stroke}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            className="transition-all duration-500"
                          />
                        </svg>
                        <span
                          className="absolute text-[10px] font-bold"
                          style={{ color: progressColor }}
                        >
                          {`${progress}%`}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">
                        {req.title}
                      </span>
                      {req.status === 'in_progress' && (
                        <span className="animate-pulse text-yellow-400 text-[10px]">
                          ⚙️
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color} inline-block mt-0.5`}
                    >
                      {st.label}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-[var(--muted)] line-clamp-3 mt-2 leading-relaxed">
                  {req.description}
                </p>

                {/* Completion summary */}
                {req.summary && (
                  <div className="flex items-center gap-3 text-[10px] text-[var(--muted)] mt-2">
                    <span>
                      {t('requirements.summary.success', {
                        n: req.summary.successTasks,
                        total: req.summary.totalTasks,
                      })}
                    </span>
                    <span>
                      {t('requirements.summary.duration', {
                        n: Math.round(
                          (req.summary.totalDuration || 0) / 1000
                        ),
                      })}
                    </span>
                  </div>
                )}

                {/* Bottom info */}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <span>🏢 {req.departmentName}</span>
                    {req.workflow && (
                      <span>
                        📊 {req.workflow.completedCount || 0}/
                        {req.workflow.nodeCount || 0}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {req.chatCount > 0 && (
                      <span>💬 {req.chatCount}</span>
                    )}
                    {req.outputCount > 0 && (
                      <span>📦 {req.outputCount}</span>
                    )}
                    <span>
                      {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== Create Requirement Modal ===== */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center !m-0"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="card max-w-lg w-full mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {t('requirements.createTitle')}
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--muted)] hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            {/* Department selector */}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">
                {t('requirements.deptLabel')}
              </label>
              <select
                className="input w-full"
                value={newDeptId}
                onChange={(e) => setNewDeptId(e.target.value)}
              >
                <option value="" disabled>
                  {t('requirements.deptPlaceholder')}
                </option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name} ({dept.members?.length || 0}{' '}
                    {t('requirements.membersUnit')})
                  </option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">
                {t('requirements.titleLabel')}
              </label>
              <input
                className="input w-full"
                placeholder={t('requirements.titlePlaceholder')}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">
                {t('requirements.descLabel')}
              </label>
              <textarea
                className="input w-full h-24 resize-none"
                placeholder={t('requirements.descPlaceholder')}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>

            {/* Workspace directory */}
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">
                {t('requirements.workspaceDirLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  className="input w-full font-mono text-xs min-h-[36px]"
                  value={newWorkspaceDir}
                  onChange={(e) => setNewWorkspaceDir(e.target.value)}
                  placeholder={t('requirements.workspaceDirPlaceholder')}
                />
                <button
                  className="btn-secondary shrink-0 text-sm px-3"
                  onClick={() => {
                    setShowFolderBrowser(true);
                    fetchDirs(newWorkspaceDir || '');
                  }}
                  title={t('requirements.browseTitle')}
                >
                  📁
                </button>
                {newWorkspaceDir && (
                  <button
                    className="text-[var(--muted)] hover:text-red-400 text-sm px-1 shrink-0"
                    onClick={() => setNewWorkspaceDir('')}
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1">
                {t('requirements.workspaceDirHint')}
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!newTitle || !newDeptId || creating || loading}
                onClick={handleCreate}
              >
                {creating ? t('requirements.creating') : t('requirements.submitBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Folder Browser Modal ===== */}
      {showFolderBrowser && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center !m-0"
          onClick={() => setShowFolderBrowser(false)}
        >
          <div
            className="card max-w-lg w-full mx-4 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">
                📁 {t('requirements.browseTitle')}
              </h3>
              <button
                onClick={() => setShowFolderBrowser(false)}
                className="text-[var(--muted)] hover:text-white text-lg"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2 py-2 px-1 bg-[var(--background)] rounded-lg mt-3 mb-2">
              <span className="text-xs text-[var(--muted)] shrink-0">
                📍
              </span>
              <span className="text-xs font-mono text-[var(--foreground)] truncate">
                {browseCurrentPath}
              </span>
            </div>
            <div className="flex-1 overflow-auto space-y-0.5 min-h-[200px]">
              {browseLoading ? (
                <div className="text-center py-8 text-[var(--muted)] text-sm animate-pulse">
                  {t('common.loading')}
                </div>
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
                    <div className="text-center py-6 text-xs text-[var(--muted)]">
                      {t('requirements.emptyDir')}
                    </div>
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
              <button
                className="btn-secondary flex-1"
                onClick={() => setShowFolderBrowser(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  setNewWorkspaceDir(browseCurrentPath);
                  setShowFolderBrowser(false);
                }}
              >
                {t('requirements.selectDir')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
