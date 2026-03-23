'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import ProviderGrid from './ProviderGrid';

/**
 * SystemMonitor - Operational dashboard for enterprise subsystems
 * User-facing: manage cron jobs, toggle plugins, view system health
 */
export default function SystemMonitor({ embedded = false }) {
  const { t } = useI18n();
  const { company, fetchCronJobs, createCronJob, manageCronJob, fetchPlugins, managePlugin, fetchSkills, manageSkill, createCustomSkill, updateCustomSkill, deleteCustomSkill, getCustomSkillRaw, searchMarketplace, installMarketplaceSkill, uninstallMarketplaceSkill, fetchKnowledge, searchKnowledge, manageKnowledge, fetchSystemStatus, factoryReset } = useStore();
  const [activeSection, setActiveSection] = useState('providers');
  const [cronData, setCronData] = useState({ summary: {}, jobs: [] });
  const [plugins, setPlugins] = useState([]);
  const [skills, setSkills] = useState([]);
  const [skillSubTab, setSkillSubTab] = useState('all'); // 'all' | 'custom' | 'marketplace'
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null); // skill id or null
  const [skillMarkdown, setSkillMarkdown] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceResults, setMarketplaceResults] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [knowledge, setKnowledge] = useState({ bases: [], stats: {} });
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Knowledge base state
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [newKB, setNewKB] = useState({ name: '', description: '', type: 'global' });
  const [showAddEntry, setShowAddEntry] = useState(null); // kbId or null
  const [newEntry, setNewEntry] = useState({ title: '', content: '', entryType: 'note', tags: '' });
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState(null);

  // Danger zone state
  const [showFactoryReset, setShowFactoryReset] = useState(false);
  const [factoryResetInput, setFactoryResetInput] = useState('');
  const [factoryResetting, setFactoryResetting] = useState(false);

  // Cron job creation form
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', cronExpression: '', agentId: '', taskPrompt: '', description: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [cron, plug, sk, kb, status] = await Promise.all([
      fetchCronJobs(), fetchPlugins(), fetchSkills(), fetchKnowledge(), fetchSystemStatus(),
    ]);
    setCronData(cron || { summary: {}, jobs: [] });
    setPlugins(plug || []);
    setSkills(sk || []);
    setKnowledge(kb || { bases: [], stats: {} });
    setSystemStatus(status);
    setLoading(false);
  }, [fetchCronJobs, fetchPlugins, fetchSkills, fetchKnowledge, fetchSystemStatus]);

  useEffect(() => { refresh(); }, [refresh]);

  // Get all agents for cron job assignment
  const allAgents = [];
  if (company?.departments) {
    for (const dept of company.departments) {
      for (const m of (dept.members || [])) {
        allAgents.push({ id: m.id, name: m.name, role: m.role, department: dept.name });
      }
    }
  }

  const handleCreateJob = async () => {
    if (!newJob.name || !newJob.cronExpression || !newJob.agentId || !newJob.taskPrompt) return;
    try {
      await createCronJob(newJob);
      setShowCreateJob(false);
      setNewJob({ name: '', cronExpression: '', agentId: '', taskPrompt: '', description: '' });
      await refresh();
    } catch {}
  };

  const handleJobAction = async (action, jobId) => {
    try {
      await manageCronJob(action, jobId);
      await refresh();
    } catch {}
  };

  const handlePluginToggle = async (pluginId, currentState) => {
    const action = currentState === 'enabled' ? 'disable' : 'enable';
    try {
      await managePlugin(action, pluginId);
      await refresh();
    } catch {}
  };



  const handleSkillToggle = async (skillId, currentState) => {
    const action = currentState === 'enabled' ? 'disable' : 'enable';
    try {
      await manageSkill(action, skillId);
      await refresh();
    } catch {}
  };

  const handleCreateCustomSkill = async () => {
    if (!skillMarkdown.trim()) return;
    try {
      await createCustomSkill(skillMarkdown);
      setShowCreateSkill(false);
      setSkillMarkdown('');
      await refresh();
    } catch {}
  };

  const handleUpdateCustomSkill = async () => {
    if (!editingSkill || !skillMarkdown.trim()) return;
    try {
      await updateCustomSkill(editingSkill, skillMarkdown);
      setEditingSkill(null);
      setSkillMarkdown('');
      await refresh();
    } catch {}
  };

  const handleDeleteCustomSkill = async (skillId) => {
    try {
      await deleteCustomSkill(skillId);
      await refresh();
    } catch {}
  };

  const handleEditCustomSkill = async (skillId) => {
    try {
      const data = await getCustomSkillRaw(skillId);
      if (data?.markdown) {
        setSkillMarkdown(data.markdown);
        setEditingSkill(skillId);
        setShowCreateSkill(true);
      }
    } catch {}
  };

  const handleMarketplaceSearch = async () => {
    setMarketplaceLoading(true);
    try {
      const result = await searchMarketplace(marketplaceQuery);
      setMarketplaceResults(result?.skills || result || []);
    } catch {}
    setMarketplaceLoading(false);
  };

  const handleInstallMarketplaceSkill = async (slug) => {
    try {
      await installMarketplaceSkill(slug);
      await refresh();
      if (marketplaceQuery) await handleMarketplaceSearch();
    } catch {}
  };

  const handleUninstallSkill = async (skillId) => {
    try {
      await uninstallMarketplaceSkill(skillId);
      await refresh();
    } catch {}
  };

  const handleCreateKB = async () => {
    if (!newKB.name) return;
    try {
      await manageKnowledge('create', newKB);
      setShowCreateKB(false);
      setNewKB({ name: '', description: '', type: 'global' });
      await refresh();
    } catch {}
  };

  const handleAddEntry = async () => {
    if (!newEntry.title || !newEntry.content) return;
    try {
      await manageKnowledge('addEntry', {
        kbId: showAddEntry,
        ...newEntry,
        tags: newEntry.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setShowAddEntry(null);
      setNewEntry({ title: '', content: '', entryType: 'note', tags: '' });
      await refresh();
    } catch {}
  };

  const handleKBSearch = async () => {
    if (!kbSearchQuery.trim()) return;
    const results = await searchKnowledge(kbSearchQuery);
    setKbSearchResults(results);
  };

  const SKILL_CATEGORY_ICONS = {
    coding: '💻', analysis: '📊', creative: '✨', communication: '💬',
    automation: '🤖', research: '🔍', design: '🎨', devops: '🚀',
  };

  const PLUGIN_CATEGORY_MAP = {
    'builtin-web-search': 'Web & Search',
    'builtin-web-fetch': 'Web & Search',
    'builtin-firecrawl': 'Web & Search',
    'builtin-browser': 'Browser & UI',
    'builtin-canvas': 'Browser & UI',
    'builtin-diffs': 'Browser & UI',
    'builtin-exec': 'Runtime & Execution',
    'builtin-apply-patch': 'Runtime & Execution',
    'builtin-memory': 'Memory & Knowledge',
    'builtin-image': 'Media & Content',
    'builtin-pdf': 'Media & Content',
    'builtin-tts': 'Media & Content',
    'builtin-data-processing': 'Media & Content',
    'builtin-message': 'Communication',
    'builtin-reactions': 'Communication',
    'builtin-bird': 'Communication',
    'builtin-sessions': 'Sessions & Multi-Agent',
    'builtin-subagents': 'Sessions & Multi-Agent',
    'builtin-cron': 'Automation & Infra',
    'builtin-gateway': 'Automation & Infra',
    'builtin-nodes': 'Automation & Infra',
    'builtin-lobster': 'Workflow & AI',
    'builtin-llm-task': 'Workflow & AI',
    'builtin-thinking': 'Workflow & AI',
    'builtin-code-review': 'Code Quality',
    'builtin-notifications': 'Code Quality',
  };

  const PLUGIN_CATEGORY_ICONS = {
    'Web & Search': '🌐',
    'Browser & UI': '🖥️',
    'Runtime & Execution': '⚡',
    'Memory & Knowledge': '🧠',
    'Media & Content': '🎨',
    'Communication': '💬',
    'Sessions & Multi-Agent': '🤖',
    'Automation & Infra': '⚙️',
    'Workflow & AI': '🔗',
    'Code Quality': '✅',
    'Other': '🧩',
  };

  const sections = [
    { id: 'providers', icon: '⚡', label: t('sidebar.nav.providers') },
    { id: 'cron', icon: '⏰', label: t('systemSettings.cards.cron') },
    { id: 'plugins', icon: '🧩', label: t('systemSettings.cards.plugins') },
    { id: 'skills', icon: '📚', label: t('systemSettings.cards.skills') },
    { id: 'knowledge', icon: '🧠', label: t('systemSettings.cards.knowledge') },
    { id: 'health', icon: '💓', label: t('systemSettings.health.title') },
    { id: 'danger', icon: '⚠️', label: t('systemSettings.dangerZone.title') },
  ];

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6 animate-fade-in'}>
      {/* Header - 仅独立模式下显示 */}
      {!embedded && (
      <div className="flex items-center justify-between">
        <div>
        <h1 className="text-2xl font-bold">{t('systemSettings.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t('systemSettings.subtitle')}</p>
        </div>
      </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-2">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all ${
              activeSection === s.id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-white/5 text-[var(--muted)] hover:bg-white/10'
            }`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* === PROVIDERS SECTION === */}
      {activeSection === 'providers' && (
        <div className="space-y-4">
          <ProviderGrid
            showDescription
            showSecretary
          />
        </div>
      )}

      {/* === CRON SECTION === */}
      {activeSection === 'cron' && (
        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label={t('systemSettings.cronStats.running')} value={cronData.summary?.running ? '✅' : '❌'} />
            <StatCard label={t('systemSettings.cronStats.jobs')} value={cronData.jobs?.length || 0} />
            <StatCard label={t('systemSettings.cronDetail.activeJobs')} value={cronData.summary?.activeJobs || 0} color="text-green-400" />
            <StatCard label={t('systemSettings.cronDetail.totalRuns')} value={cronData.summary?.totalRuns || 0} />
          </div>

          {/* Create Job Button */}
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">{t('systemSettings.cronDetail.jobList')}</h3>
            <button onClick={() => setShowCreateJob(!showCreateJob)} className="btn-primary text-xs">
              {showCreateJob ? '✕ ' + t('common.cancel') : '+ ' + t('systemSettings.cronDetail.createJob')}
            </button>
          </div>

          {/* Create Job Form */}
          {showCreateJob && (
            <div className="card space-y-3 animate-fade-in">
              <h4 className="text-sm font-medium">{t('systemSettings.cronDetail.createJob')}</h4>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input text-sm"
                  placeholder={t('systemSettings.cronForm.name')}
                  value={newJob.name}
                  onChange={e => setNewJob({ ...newJob, name: e.target.value })}
                />
                <input
                  className="input text-sm"
                  placeholder={t('systemSettings.cronForm.schedule')}
                  value={newJob.cronExpression}
                  onChange={e => setNewJob({ ...newJob, cronExpression: e.target.value })}
                />
              </div>
              <select
                className="input text-sm w-full"
                value={newJob.agentId}
                onChange={e => setNewJob({ ...newJob, agentId: e.target.value })}
              >
                <option value="">{t('systemSettings.cronForm.selectAgent')}</option>
                {allAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role}) — {a.department}</option>
                ))}
              </select>
              <textarea
                className="input text-sm w-full"
                rows={3}
                  placeholder={t('systemSettings.cronForm.taskPrompt')}
                value={newJob.taskPrompt}
                onChange={e => setNewJob({ ...newJob, taskPrompt: e.target.value })}
              />
              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>{t('systemSettings.cronForm.scheduleHint')}</div>
              </div>
              <button onClick={handleCreateJob} className="btn-primary text-sm max-w-xs">
                {t('systemSettings.cronDetail.createJob')}
              </button>
            </div>
          )}

          {/* Job List */}
          {cronData.jobs?.length > 0 ? (
            <div className="space-y-2">
              {cronData.jobs.map(job => (
                <div key={job.id} className="card flex items-center gap-4">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    job.status === 'active' ? 'bg-green-500' :
                    job.status === 'running' ? 'bg-blue-500 animate-pulse' :
                    job.status === 'paused' ? 'bg-yellow-500' :
                    job.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{job.name}</div>
                    <div className="text-[10px] text-[var(--muted)] flex items-center gap-3 mt-0.5">
                      <span>📅 {job.cronExpression}</span>
                      <span>🔄 {t('systemSettings.cronDetail.runs')}: {job.runCount}</span>
                      {job.nextRun && <span>⏭ {new Date(job.nextRun).toLocaleTimeString()}</span>}
                      {job.lastError && <span className="text-red-400">⚠ {job.lastError.slice(0, 30)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {job.status === 'active' && (
                      <button onClick={() => handleJobAction('pause', job.id)} className="btn-ghost text-[10px]" title={t('systemSettings.cronJobActions.pause')}>⏸</button>
                    )}
                    {job.status === 'paused' && (
                      <button onClick={() => handleJobAction('resume', job.id)} className="btn-ghost text-[10px]" title={t('systemSettings.cronJobActions.resume')}>▶️</button>
                    )}
                    {job.status === 'error' && (
                      <button onClick={() => handleJobAction('resume', job.id)} className="btn-ghost text-[10px]" title={t('systemSettings.cronJobActions.retry')}>🔁</button>
                    )}
                    <button onClick={() => handleJobAction('trigger', job.id)} className="btn-ghost text-[10px]" title={t('systemSettings.cronJobActions.runNow')}>🚀</button>
                    <button onClick={() => handleJobAction('delete', job.id)} className="btn-ghost text-[10px] text-red-400" title={t('systemSettings.cronJobActions.delete')}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-[var(--muted)]">
              <div className="text-4xl mb-3">⏰</div>
              <p className="text-sm">{t('systemSettings.cronDetail.noJobs')}</p>
              <p className="text-xs mt-1">{t('systemSettings.cronDetail.noJobsHint')}</p>
            </div>
          )}
        </div>
      )}

      {/* === PLUGINS SECTION === */}
      {activeSection === 'plugins' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label={t('systemSettings.pluginStats.registered')} value={plugins.length} />
            <StatCard label={t('systemSettings.pluginStats.enabled')} value={plugins.filter(p => p.state === 'enabled').length} color="text-green-400" />
            <StatCard label={t('systemSettings.pluginDetail.totalTools')} value={plugins.reduce((s, p) => s + (p.toolCount || 0), 0)} />
          </div>

          {plugins.length > 0 ? (
            <div className="space-y-4">
              {Object.entries(
                plugins.reduce((acc, p) => {
                  const cat = PLUGIN_CATEGORY_MAP[p.id] || 'Other';
                  (acc[cat] = acc[cat] || []).push(p);
                  return acc;
                }, {})
              ).map(([category, catPlugins]) => (
                <div key={category} className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{PLUGIN_CATEGORY_ICONS[category] || '🧩'}</span>
                    <h3 className="text-sm font-semibold">{category}</h3>
                    <span className="text-[10px] text-[var(--muted)]">{t('providers.pluginsCount', { n: catPlugins.length })}</span>
                  </div>
                  <div className="space-y-2">
                    {catPlugins.map(plugin => (
                      <div key={plugin.id} className="flex items-center gap-4 p-2 rounded-lg hover:bg-white/5 transition-all">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          plugin.state === 'enabled' ? 'bg-green-500' : 'bg-gray-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{plugin.name}</span>
                            <span className="text-[10px] text-[var(--muted)]">v{plugin.version}</span>
                          </div>
                          <div className="text-[10px] text-[var(--muted)] mt-0.5">
                            {plugin.description}
                            {plugin.toolCount > 0 && <span className="ml-2">{t('providers.toolsCount', { n: plugin.toolCount })}</span>}
                            {plugin.hookCount > 0 && <span className="ml-2">{t('providers.hooksCount', { n: plugin.hookCount })}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handlePluginToggle(plugin.id, plugin.state)}
                          className={`text-xs px-3 py-1 rounded-full transition-all ${
                            plugin.state === 'enabled'
                              ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400'
                              : 'bg-white/10 text-[var(--muted)] hover:bg-green-900/30 hover:text-green-400'
                          }`}
                        >
                          {plugin.state === 'enabled' ? t('common.disable') : t('common.enable')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-[var(--muted)]">
              <div className="text-4xl mb-3">🧩</div>
              <p className="text-sm">{t('systemSettings.pluginDetail.noPlugins')}</p>
            </div>
          )}
        </div>
      )}

      {/* === SKILLS SECTION === */}
      {activeSection === 'skills' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label={t('systemSettings.skillStats.total')} value={skills.length} />
            <StatCard label={t('systemSettings.skillStats.enabled')} value={skills.filter(s => s.state === 'enabled').length} color="text-green-400" />
            <StatCard label={t('systemSettings.skillStats.categories')} value={[...new Set(skills.map(s => s.category))].length} />
            <StatCard label={t('systemSettings.skillStats.custom')} value={skills.filter(s => s.source === 'custom').length} color="text-purple-400" />
          </div>

          {/* Sub-tabs: All / Custom / Marketplace */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
            {[{id:'all', label: t('systemSettings.skillTabs.all'), icon: '📚'}, {id:'custom', label: t('systemSettings.skillTabs.custom'), icon: '✨'}, {id:'marketplace', label: t('systemSettings.skillTabs.marketplace'), icon: '🏪'}].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSkillSubTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
                  skillSubTab === tab.id
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-white/5'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
            {skillSubTab === 'custom' && (
              <button
                onClick={() => { setShowCreateSkill(true); setEditingSkill(null); setSkillMarkdown(SKILL_TEMPLATE); }}
                className="ml-auto text-[10px] px-3 py-1 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 transition-all"
              >
                + {t('systemSettings.skillActions.create')}
              </button>
            )}
          </div>

          {/* ALL SKILLS sub-tab */}
          {skillSubTab === 'all' && (
            <>
              {Object.entries(
                skills.reduce((acc, s) => {
                  (acc[s.category] = acc[s.category] || []).push(s);
                  return acc;
                }, {})
              ).map(([category, catSkills]) => (
                <div key={category} className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{SKILL_CATEGORY_ICONS[category] || '⚡'}</span>
                    <h3 className="text-sm font-semibold capitalize">{category}</h3>
                    <span className="text-[10px] text-[var(--muted)]">{t('providers.skillsCount', { n: catSkills.length })}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {catSkills.map(skill => (
                      <SkillCard key={skill.id} skill={skill} t={t} onToggle={handleSkillToggle}
                        onEdit={skill.source === 'custom' ? () => handleEditCustomSkill(skill.id) : null}
                        onDelete={skill.source === 'custom' ? () => handleDeleteCustomSkill(skill.id) : skill.source === 'marketplace' ? () => handleUninstallSkill(skill.id) : null}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {skills.length === 0 && (
                <div className="text-center py-12 text-[var(--muted)]">
                  <div className="text-4xl mb-3">📚</div>
                  <p className="text-sm">{t('systemSettings.skillDetail.noSkills')}</p>
                </div>
              )}
            </>
          )}

          {/* CUSTOM SKILLS sub-tab */}
          {skillSubTab === 'custom' && (
            <>
              {/* Create/Edit modal */}
              {showCreateSkill && (
                <div className="card border-[var(--accent)]/30">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">
                      {editingSkill ? t('systemSettings.skillActions.edit') : t('systemSettings.skillActions.create')}
                    </h3>
                    <button onClick={() => { setShowCreateSkill(false); setEditingSkill(null); setSkillMarkdown(''); }}
                      className="text-[var(--muted)] hover:text-[var(--foreground)] text-xs">✕</button>
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mb-2">{t('systemSettings.skillActions.markdownHint')}</p>
                  <textarea
                    value={skillMarkdown}
                    onChange={e => setSkillMarkdown(e.target.value)}
                    placeholder={SKILL_TEMPLATE}
                    className="w-full h-64 bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono resize-y focus:border-[var(--accent)] focus:outline-none"
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => { setShowCreateSkill(false); setEditingSkill(null); setSkillMarkdown(''); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10">{t('common.cancel')}</button>
                    <button onClick={editingSkill ? handleUpdateCustomSkill : handleCreateCustomSkill}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30">
                      {editingSkill ? t('common.save') : t('systemSettings.skillActions.create')}
                    </button>
                  </div>
                </div>
              )}

              {/* Custom skills list */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {skills.filter(s => s.source === 'custom').map(skill => (
                  <SkillCard key={skill.id} skill={skill} t={t} onToggle={handleSkillToggle}
                    onEdit={() => handleEditCustomSkill(skill.id)}
                    onDelete={() => handleDeleteCustomSkill(skill.id)}
                  />
                ))}
              </div>
              {skills.filter(s => s.source === 'custom').length === 0 && !showCreateSkill && (
                <div className="text-center py-12 text-[var(--muted)]">
                  <div className="text-4xl mb-3">✨</div>
                  <p className="text-sm">{t('systemSettings.skillDetail.noCustom')}</p>
                  <p className="text-[10px] mt-1">{t('systemSettings.skillDetail.noCustomHint')}</p>
                </div>
              )}
            </>
          )}

          {/* MARKETPLACE sub-tab */}
          {skillSubTab === 'marketplace' && (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={marketplaceQuery}
                  onChange={e => setMarketplaceQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleMarketplaceSearch()}
                  placeholder={t('systemSettings.skillMarketplace.searchPlaceholder')}
                  className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs focus:border-[var(--accent)] focus:outline-none"
                />
                <button onClick={handleMarketplaceSearch}
                  className="text-xs px-4 py-1.5 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30">
                  {t('common.search')}
                </button>
              </div>

              {marketplaceLoading && (
                <div className="text-center py-8 text-[var(--muted)]">
                  <div className="animate-spin text-2xl mb-2">⏳</div>
                  <p className="text-xs">{t('common.loading')}</p>
                </div>
              )}

              {!marketplaceLoading && marketplaceResults.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {marketplaceResults.map(skill => (
                    <div key={skill.slug} className={`p-3 rounded-lg border transition-all ${
                      skill.installed ? 'border-green-500/30 bg-green-900/10' : 'border-[var(--border)] bg-[var(--background)]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span>{skill.icon || '📦'}</span>
                          <span className="text-sm font-medium truncate">{skill.name}</span>
                        </div>
                        <button
                          onClick={() => handleInstallMarketplaceSkill(skill.slug)}
                          disabled={skill.installed}
                          className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
                            skill.installed
                              ? 'bg-green-900/30 text-green-400 cursor-default'
                              : 'bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30'
                          }`}
                        >
                          {skill.installed ? t('systemSettings.skillMarketplace.installed') : t('systemSettings.skillMarketplace.install')}
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--muted)] line-clamp-2">{skill.description}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[9px] text-[var(--muted)]">
                        <span>by {skill.author}</span>
                        {skill.downloads > 0 && <span>⬇ {skill.downloads}</span>}
                        {skill.stars > 0 && <span>⭐ {skill.stars}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Installed marketplace skills */}
              {skills.filter(s => s.source === 'marketplace').length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold mb-3">{t('systemSettings.skillMarketplace.installedTitle')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {skills.filter(s => s.source === 'marketplace').map(skill => (
                      <SkillCard key={skill.id} skill={skill} t={t} onToggle={handleSkillToggle}
                        onDelete={() => handleUninstallSkill(skill.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!marketplaceLoading && marketplaceResults.length === 0 && skills.filter(s => s.source === 'marketplace').length === 0 && (
                <div className="text-center py-12 text-[var(--muted)]">
                  <div className="text-4xl mb-3">🏪</div>
                  <p className="text-sm">{t('systemSettings.skillMarketplace.empty')}</p>
                  <p className="text-[10px] mt-1">{t('systemSettings.skillMarketplace.emptyHint')}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* === KNOWLEDGE BASE SECTION === */}
      {activeSection === 'knowledge' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label={t('systemSettings.kbStats.totalBases')} value={knowledge.stats?.totalBases || 0} />
            <StatCard label={t('systemSettings.kbStats.enabled')} value={knowledge.stats?.enabledBases || 0} color="text-green-400" />
            <StatCard label={t('systemSettings.kbStats.totalEntries')} value={knowledge.stats?.totalEntries || 0} />
            <StatCard label={t('systemSettings.kbStats.globalBases')} value={knowledge.stats?.byType?.global || 0} />
          </div>

          {/* Search */}
          <div className="card">
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder={t('systemSettings.kbSearch.placeholder')}
                value={kbSearchQuery}
                onChange={e => setKbSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleKBSearch()}
              />
              <button onClick={handleKBSearch} className="btn-primary text-sm">
                🔍 {t('systemSettings.kbSearch.btn')}
              </button>
            </div>
            {kbSearchResults && (
              <div className="mt-3 space-y-2">
                {kbSearchResults.length > 0 ? kbSearchResults.map((r, i) => (
                  <div key={i} className="p-2 rounded bg-white/5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">{r.type}</span>
                      <span className="font-medium">{r.title}</span>
                      <span className="text-[10px] text-[var(--muted)] ml-auto">{r.knowledgeBaseName}</span>
                    </div>
                    <p className="text-[10px] text-[var(--muted)] mt-1 line-clamp-2">{r.content}</p>
                  </div>
                )) : (
                  <p className="text-xs text-[var(--muted)]">{t('systemSettings.kbSearch.noResults')}</p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">{t('systemSettings.kbDetail.listTitle')}</h3>
            <button onClick={() => setShowCreateKB(!showCreateKB)} className="btn-primary text-xs">
              {showCreateKB ? '✕ ' + t('common.cancel') : '+ ' + t('systemSettings.kbDetail.createKB')}
            </button>
          </div>

          {/* Create KB Form */}
          {showCreateKB && (
            <div className="card space-y-3 animate-fade-in">
              <h4 className="text-sm font-medium">{t('systemSettings.kbDetail.createKB')}</h4>
              <input
                className="input text-sm w-full"
                placeholder={t('systemSettings.kbForm.name')}
                value={newKB.name}
                onChange={e => setNewKB({ ...newKB, name: e.target.value })}
              />
              <input
                className="input text-sm w-full"
                placeholder={t('systemSettings.kbForm.description')}
                value={newKB.description}
                onChange={e => setNewKB({ ...newKB, description: e.target.value })}
              />
              <select
                className="input text-sm w-full"
                value={newKB.type}
                onChange={e => setNewKB({ ...newKB, type: e.target.value })}
              >
                <option value="global">{t('systemSettings.kbForm.typeGlobal')}</option>
                <option value="department">{t('systemSettings.kbForm.typeDept')}</option>
                <option value="agent">{t('systemSettings.kbForm.typeAgent')}</option>
              </select>
              <button onClick={handleCreateKB} className="btn-primary text-sm max-w-xs">
                {t('systemSettings.kbDetail.createKB')}
              </button>
            </div>
          )}

          {/* KB List */}
          {(knowledge.bases || []).length > 0 ? (
            <div className="space-y-2">
              {knowledge.bases.map(kb => (
                <div key={kb.id} className="card">
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${kb.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{kb.name}</span>
                        <span className="text-[10px] bg-blue-900/20 text-blue-400 px-1.5 py-0.5 rounded">{kb.type}</span>
                        <span className="text-[10px] text-[var(--muted)]">{kb.entryCount} {t('systemSettings.kbStats.totalEntries').toLowerCase()}</span>
                      </div>
                      {kb.description && <p className="text-[10px] text-[var(--muted)] mt-0.5">{kb.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setShowAddEntry(showAddEntry === kb.id ? null : kb.id); setNewEntry({ title: '', content: '', entryType: 'note', tags: '' }); }}
                        className="btn-ghost text-[10px]"
                        title={t('systemSettings.kbDetail.addEntry')}
                      >➕</button>
                      <button
                        onClick={async () => { await manageKnowledge('toggle', { kbId: kb.id }); await refresh(); }}
                        className={`text-[10px] px-2 py-0.5 rounded-full ${kb.enabled ? 'bg-green-900/30 text-green-400' : 'bg-white/10 text-[var(--muted)]'}`}
                      >
                        {kb.enabled ? t('common.enable') : t('common.disable')}
                      </button>
                    </div>
                  </div>

                  {/* Add Entry Form */}
                  {showAddEntry === kb.id && (
                    <div className="mt-3 p-3 rounded-lg bg-white/5 space-y-2 animate-fade-in">
                      <input
                        className="input text-sm w-full"
                        placeholder={t('systemSettings.kbForm.entryTitle')}
                        value={newEntry.title}
                        onChange={e => setNewEntry({ ...newEntry, title: e.target.value })}
                      />
                      <textarea
                        className="input text-sm w-full"
                        rows={3}
                        placeholder={t('systemSettings.kbForm.entryContent')}
                        value={newEntry.content}
                        onChange={e => setNewEntry({ ...newEntry, content: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <select
                          className="input text-sm flex-1"
                          value={newEntry.entryType}
                          onChange={e => setNewEntry({ ...newEntry, entryType: e.target.value })}
                        >
                          <option value="note">{t('systemSettings.kbEntryTypes.note')}</option>
                          <option value="fact">{t('systemSettings.kbEntryTypes.fact')}</option>
                          <option value="decision">{t('systemSettings.kbEntryTypes.decision')}</option>
                          <option value="procedure">{t('systemSettings.kbEntryTypes.procedure')}</option>
                          <option value="reference">{t('systemSettings.kbEntryTypes.reference')}</option>
                          <option value="faq">{t('systemSettings.kbEntryTypes.faq')}</option>
                        </select>
                        <input
                          className="input text-sm flex-1"
                          placeholder={t('systemSettings.kbForm.tags')}
                          value={newEntry.tags}
                          onChange={e => setNewEntry({ ...newEntry, tags: e.target.value })}
                        />
                      </div>
                      <button onClick={handleAddEntry} className="btn-primary text-sm max-w-xs">
                        {t('systemSettings.kbDetail.addEntry')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-[var(--muted)]">
              <div className="text-4xl mb-3">🧠</div>
              <p className="text-sm">{t('systemSettings.kbDetail.noKB')}</p>
              <p className="text-xs mt-1">{t('systemSettings.kbDetail.noKBHint')}</p>
            </div>
          )}
        </div>
      )}

      {/* === HEALTH SECTION === */}
      {activeSection === 'health' && systemStatus && (
        <div className="space-y-4">
          {/* Overview Grid */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard icon="🛡️" label={t('systemSettings.cards.audit')} value={systemStatus.audit?.total || 0} sub={`${systemStatus.audit?.blocked || 0} ${t('systemSettings.auditStats.blocked')}`} />
            <StatCard icon="🔀" label={t('systemSettings.cards.routing')} value={systemStatus.routing?.healthDashboard?.length || 0} sub={systemStatus.routing?.strategy || ''} />
            <StatCard icon="🪝" label={t('systemSettings.cards.hooks')} value={systemStatus.hooks?.totalHandlers || 0} sub={`${systemStatus.hooks?.registeredKeys || 0} ${t('systemSettings.hookStats.eventKeys')}`} />
            <StatCard icon="💬" label={t('systemSettings.cards.sessions')} value={systemStatus.sessions?.totalSessions || 0} sub={`${systemStatus.sessions?.totalMessages || 0} ${t('systemSettings.sessionStats.messages')}`} />
          </div>

          {/* Provider Health */}
          {systemStatus.routing?.healthDashboard?.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">{t('systemSettings.health.providerHealth')}</h3>
              <div className="space-y-2">
                {systemStatus.routing.healthDashboard.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                    <span className={`w-2 h-2 rounded-full ${
                      p.health === 'healthy' ? 'bg-green-500' : p.health === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <span className="text-sm flex-1">{p.id}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {p.successRate !== undefined ? `${(p.successRate * 100).toFixed(0)}%` : '-'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      p.health === 'healthy' ? 'bg-green-900/30 text-green-400' :
                      p.health === 'degraded' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-red-900/30 text-red-400'
                    }`}>{p.health}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Audit Events */}
          {systemStatus.recentAuditEvents?.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">{t('systemSettings.health.recentAudit')}</h3>
              <div className="space-y-1 max-h-60 overflow-auto">
                {systemStatus.recentAuditEvents.slice(0, 15).map((evt, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-white/5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      evt.level === 'critical' ? 'bg-red-500' : evt.level === 'warn' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`} />
                    <span className="text-[var(--muted)] w-20 shrink-0">{evt.category}</span>
                    <span className="flex-1 truncate">{evt.action}</span>
                    {evt.blocked && <span className="text-red-400 shrink-0">🚫</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === DANGER ZONE SECTION === */}
      {activeSection === 'danger' && (
        <div className="space-y-4">
          {/* Warning banner */}
          <div className="card bg-gradient-to-r from-red-900/20 to-orange-900/20 border-red-500/30">
            <div className="flex items-start gap-3">
              <span className="text-3xl">☢️</span>
              <div>
                <h3 className="font-semibold text-red-400">{t('systemSettings.dangerZone.title')}</h3>
                <p className="text-sm text-[var(--muted)] mt-1">{t('systemSettings.dangerZone.subtitle')}</p>
              </div>
            </div>
          </div>

          {/* Factory Reset card */}
          <div className="card border-red-500/20">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="font-semibold text-red-400">{t('systemSettings.dangerZone.factoryReset')}</h4>
                <p className="text-sm text-[var(--muted)] mt-1 max-w-xl">
                  {t('systemSettings.dangerZone.factoryResetDesc')}
                </p>
              </div>
              <button
                onClick={() => { setShowFactoryReset(true); setFactoryResetInput(''); }}
                className="shrink-0 ml-4 px-4 py-2.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 hover:border-red-500/50 transition-all text-sm font-medium cursor-pointer"
              >
                {t('systemSettings.dangerZone.factoryResetBtn')}
              </button>
            </div>
          </div>

          {/* Factory Reset confirmation modal */}
          {showFactoryReset && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 !m-0" onClick={() => !factoryResetting && setShowFactoryReset(false)}>
              <div className="card max-w-md w-full mx-4 space-y-4 border-red-500/30" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">💀</span>
                  <h3 className="text-lg font-bold text-red-400">{t('systemSettings.dangerZone.factoryResetConfirm')}</h3>
                </div>

                <p className="text-sm text-[var(--muted)]">
                  {t('systemSettings.dangerZone.factoryResetConfirmDesc')}
                </p>

                <ul className="space-y-1.5">
                  {t('systemSettings.dangerZone.factoryResetItems').map((item, i) => (
                    <li key={i} className="text-sm text-red-300/80 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div>
                  <label className="block text-sm mb-1.5 text-[var(--muted)]">
                    {t('systemSettings.dangerZone.factoryResetInput', { companyName: company?.name || 'Company' })}
                  </label>
                  <input
                    className="input w-full"
                    placeholder={t('systemSettings.dangerZone.factoryResetInputPlaceholder')}
                    value={factoryResetInput}
                    onChange={e => setFactoryResetInput(e.target.value)}
                    disabled={factoryResetting}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    className="btn-secondary flex-1"
                    onClick={() => setShowFactoryReset(false)}
                    disabled={factoryResetting}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    disabled={factoryResetInput !== (company?.name || 'Company') || factoryResetting}
                    onClick={async () => {
                      setFactoryResetting(true);
                      try {
                        await factoryReset();
                        setShowFactoryReset(false);
                        // Reload the page to go back to setup wizard
                        setTimeout(() => window.location.reload(), 800);
                      } catch (e) {
                        setFactoryResetting(false);
                      }
                    }}
                  >
                    {factoryResetting ? t('systemSettings.dangerZone.factoryResetting') : t('systemSettings.dangerZone.factoryResetExecute')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StatCard({ icon, label, value, sub, color = '' }) {
  return (
    <div className="card text-center">
      {icon && <div className="text-xl mb-1">{icon}</div>}
      <div className={`text-xl font-bold ${color || 'text-white'}`}>{value}</div>
      <div className="text-[10px] text-[var(--muted)] mt-1">{label}</div>
      {sub && <div className="text-[10px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

const SOURCE_BADGES = {
  builtin: { label: 'Built-in', color: 'bg-blue-900/30 text-blue-400' },
  custom: { label: 'Custom', color: 'bg-purple-900/30 text-purple-400' },
  marketplace: { label: 'Market', color: 'bg-orange-900/30 text-orange-400' },
};

function SkillCard({ skill, t, onToggle, onEdit, onDelete }) {
  const badge = SOURCE_BADGES[skill.source] || SOURCE_BADGES.builtin;
  return (
    <div className={`p-3 rounded-lg border transition-all ${
      skill.state === 'enabled'
        ? 'border-green-500/30 bg-green-900/10'
        : 'border-[var(--border)] bg-[var(--background)]'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span>{skill.icon}</span>
          <span className="text-sm font-medium truncate">{skill.name}</span>
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {onEdit && (
            <button onClick={onEdit} className="text-[10px] px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10">✏️</button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="text-[10px] px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-red-400 hover:bg-red-900/20">🗑</button>
          )}
          <button
            onClick={() => onToggle(skill.id, skill.state)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
              skill.state === 'enabled'
                ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400'
                : 'bg-white/10 text-[var(--muted)] hover:bg-green-900/30 hover:text-green-400'
            }`}
          >
            {skill.state === 'enabled' ? t('common.disable') : t('common.enable')}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[var(--muted)] line-clamp-2">{skill.description}</p>
      {skill.tags?.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1.5">
          {skill.tags.slice(0, 4).map((tag, i) => (
            <span key={i} className="text-[9px] bg-white/5 text-[var(--muted)] px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const SKILL_TEMPLATE = `---
name: My Custom Skill
description: Short description of what this skill does
category: coding
icon: 🔥
tags: tag1, tag2, tag3
---

# My Custom Skill

## Workflow
1. Step one
2. Step two
3. Step three

## Best Practices
- Best practice one
- Best practice two
`;
