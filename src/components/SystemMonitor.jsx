'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import TalentMarket from './TalentMarket';

const CATEGORY_ICONS = { general: '💬', drawing: '🎨', music: '🎵', video: '🎬', cli: '🖥️' };
const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];
const PRICE_DOTS = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];
const RATING_COLORS = { high: 'text-green-400', mid: 'text-yellow-400', low: 'text-orange-400' };

function RatingBadge({ rating }) {
  const color = rating >= 90 ? RATING_COLORS.high : rating >= 80 ? RATING_COLORS.mid : RATING_COLORS.low;
  return <span className={`text-xs font-bold ${color}`}>⭐ {rating}</span>;
}

/**
 * SystemMonitor - Operational dashboard for enterprise subsystems
 * User-facing: manage cron jobs, toggle plugins, view system health
 */
export default function SystemMonitor({ embedded = false }) {
  const { t } = useI18n();
  const { company, fetchCronJobs, createCronJob, manageCronJob, fetchPlugins, managePlugin, fetchSkills, manageSkill, fetchKnowledge, searchKnowledge, manageKnowledge, fetchSystemStatus, configureProvider, fetchCLIBackends, detectCLIBackends, manageCLIBackend } = useStore();
  const [activeSection, setActiveSection] = useState('providers');
  const [cronData, setCronData] = useState({ summary: {}, jobs: [] });
  const [plugins, setPlugins] = useState([]);
  const [skills, setSkills] = useState([]);
  const [knowledge, setKnowledge] = useState({ bases: [], stats: {} });
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // CLI Backends state
  const [cliBackends, setCLIBackends] = useState([]);
  const [cliDetecting, setCLIDetecting] = useState(false);
  const [showRegisterCLI, setShowRegisterCLI] = useState(false);
  const [newCLI, setNewCLI] = useState({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });

  // Knowledge base state
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [newKB, setNewKB] = useState({ name: '', description: '', type: 'global' });
  const [showAddEntry, setShowAddEntry] = useState(null); // kbId or null
  const [newEntry, setNewEntry] = useState({ title: '', content: '', entryType: 'note', tags: '' });
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState(null);

  // Cron job creation form
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', cronExpression: '', agentId: '', taskPrompt: '', description: '' });

  // Providers
  const [configTarget, setConfigTarget] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showTalentMarket, setShowTalentMarket] = useState(false);

  const categoryLabels = {
    general: t('providers.categories.general'),
    drawing: t('providers.categories.drawing'),
    music: t('providers.categories.music'),
    video: t('providers.categories.video'),
    cli: t('providers.categories.cli'),
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    const [cron, plug, sk, kb, status, cli] = await Promise.all([
      fetchCronJobs(), fetchPlugins(), fetchSkills(), fetchKnowledge(), fetchSystemStatus(), fetchCLIBackends(),
    ]);
    setCronData(cron || { summary: {}, jobs: [] });
    setPlugins(plug || []);
    setSkills(sk || []);
    setKnowledge(kb || { bases: [], stats: {} });
    setSystemStatus(status);
    if (cli) setCLIBackends(cli);
    setLoading(false);
  }, [fetchCronJobs, fetchPlugins, fetchSkills, fetchKnowledge, fetchSystemStatus, fetchCLIBackends]);

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

  const handleConfigure = async () => {
    if (!configTarget || !apiKey) return;
    try {
      await configureProvider(configTarget.id, apiKey);
      setConfigTarget(null);
      setApiKey('');
    } catch {}
  };

  const handleSkillToggle = async (skillId, currentState) => {
    const action = currentState === 'enabled' ? 'disable' : 'enable';
    try {
      await manageSkill(action, skillId);
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
          {/* Description card */}
          <div className="card bg-gradient-to-r from-blue-900/10 to-purple-900/10 border-blue-500/20">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div className="text-sm text-[var(--muted)] flex-1">
                <p className="font-medium text-[var(--foreground)] mb-1">{t('providers.hint.title')}</p>
                <p dangerouslySetInnerHTML={{ __html: t('providers.hint.desc') }} />
              </div>
              {/* Talent Market entrance */}
              <button
                onClick={() => setShowTalentMarket(true)}
                className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-900/20 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-900/30 transition-all text-sm"
              >
                <span>🏪</span>
                <span>{t('providers.talentMarket.btn')}</span>
                {(company?.talentMarket?.length || 0) > 0 && (
                  <span className="text-xs bg-yellow-500/20 px-1.5 py-0.5 rounded-full">{company.talentMarket.length}</span>
                )}
              </button>
            </div>
          </div>

          {Object.entries(company?.providerDashboard || {}).map(([category, info]) => (
            <div key={category} className="card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{CATEGORY_ICONS[category]}</span>
                  <div>
                    <h3 className="font-semibold">{categoryLabels[category] || category}</h3>
                    <div className="text-xs text-[var(--muted)]">
                      {t('providers.enabled', { n: info.enabled, total: info.total })}
                    </div>
                  </div>
                </div>
                {/* CLI category: detect & register buttons */}
                {category === 'cli' && (
                  <div className="flex gap-2 ml-auto mr-3">
                    <button
                      onClick={async () => {
                        setCLIDetecting(true);
                        await detectCLIBackends();
                        const updated = await fetchCLIBackends();
                        if (updated) setCLIBackends(updated);
                        setCLIDetecting(false);
                      }}
                      disabled={cliDetecting}
                      className="px-2.5 py-1 rounded text-[10px] bg-[var(--accent)] text-white hover:opacity-90 transition-all disabled:opacity-50"
                    >
                      {cliDetecting ? t('systemSettings.cliBackends.detecting') : `🔍 ${t('systemSettings.cliBackends.detectAll')}`}
                    </button>
                    <button
                      onClick={() => setShowRegisterCLI(!showRegisterCLI)}
                      className="px-2.5 py-1 rounded text-[10px] bg-white/10 text-[var(--muted)] hover:bg-white/20 transition-all"
                    >
                      + {t('systemSettings.cliBackends.registerCustom')}
                    </button>
                  </div>
                )}
              </div>

              {/* CLI category: register custom CLI form */}
              {category === 'cli' && showRegisterCLI && (
                <div className="p-4 rounded-lg bg-white/5 border border-[var(--border)] mb-4 space-y-3 animate-fade-in">
                  <h4 className="text-xs font-semibold">{t('systemSettings.cliBackends.registerCustom')}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.id')} value={newCLI.id} onChange={e => setNewCLI({...newCLI, id: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.name')} value={newCLI.name} onChange={e => setNewCLI({...newCLI, name: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.execCommand')} value={newCLI.execCommand} onChange={e => setNewCLI({...newCLI, execCommand: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.execArgs')} value={newCLI.execArgs} onChange={e => setNewCLI({...newCLI, execArgs: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.detectCommand')} value={newCLI.detectCommand} onChange={e => setNewCLI({...newCLI, detectCommand: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.memoryDir')} value={newCLI.memoryDir} onChange={e => setNewCLI({...newCLI, memoryDir: e.target.value})} />
                    <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.memoryFile')} value={newCLI.memoryFile} onChange={e => setNewCLI({...newCLI, memoryFile: e.target.value})} />
                    <div>
                      <input className="input text-xs" placeholder={t('systemSettings.cliBackends.form.nvmNode')} value={newCLI.nvmNode} onChange={e => setNewCLI({...newCLI, nvmNode: e.target.value})} />
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">{t('systemSettings.cliBackends.form.nvmNodeHint')}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowRegisterCLI(false)} className="px-3 py-1 text-xs text-[var(--muted)] hover:text-white transition-all">
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={async () => {
                        if (!newCLI.id || !newCLI.execCommand) return;
                        const config = {
                          ...newCLI,
                          execArgs: newCLI.execArgs.split(',').map(s => s.trim()),
                          detectCommand: newCLI.detectCommand || `${newCLI.execCommand} --version`,
                          memoryDir: newCLI.memoryDir || `.${newCLI.id}`,
                          nvmNode: newCLI.nvmNode || null,
                        };
                        const updated = await manageCLIBackend('register', { config });
                        if (updated) setCLIBackends(updated);
                        setShowRegisterCLI(false);
                        setNewCLI({ id: '', name: '', execCommand: '', execArgs: '-p,{prompt},-y', detectCommand: '', memoryDir: '', memoryFile: 'MEMORY.md', nvmNode: '' });
                      }}
                      disabled={!newCLI.id || !newCLI.execCommand}
                      className="px-3 py-1 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {t('systemSettings.cliBackends.registerCustom')}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {info.providers.map((p) => (
                  <div
                    key={p.id}
                    className={`p-3 rounded-lg border transition-all ${
                      p.enabled
                        ? 'border-green-500/30 bg-green-900/10'
                        : 'border-[var(--border)] bg-[var(--background)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.cliIcon && <span className="text-sm">{p.cliIcon}</span>}
                    <span className={`status-dot ${p.enabled ? 'active' : 'idle'}`} />
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  </div>
                  {/* CLI providers use a toggle switch instead of configure button */}
                  {p.isCLI ? (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-green-900/30 hover:text-green-400'
                      }`}
                      onClick={async () => {
                        await configureProvider(p.id, p.enabled ? '' : 'cli-local');
                      }}
                    >
                      {p.enabled ? t('common.disable') : t('common.enable')}
                    </button>
                  ) : (
                    <button
                      className={`text-xs px-2.5 py-1 rounded transition-all shrink-0 ${
                        p.enabled
                          ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                      }`}
                      onClick={() => { setConfigTarget(p); setApiKey(''); }}
                    >
                      {p.enabled ? t('common.manage') : t('common.configure')}
                    </button>
                  )}
                    </div>
                <div className="text-xs text-[var(--muted)] mb-2">
                  {p.provider}
                  {p.cliVersion && <span className="ml-2 text-[10px] opacity-60">v{p.cliVersion}</span>}
                  {p.cliState && p.cliState !== 'detected' && (
                    <span className="ml-2 text-[10px] text-yellow-400">({t(`systemSettings.cliBackends.status.${p.cliState}`)})</span>
                  )}
                </div>
                    <div className="flex items-center gap-3 mb-2">
                      <RatingBadge rating={p.rating} />
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${PRICE_DOTS[(p.priceLevel || 1) - 1]}`} />
                        <span className={`text-xs ${PRICE_COLORS[(p.priceLevel || 1) - 1]}`}>
                          {p.priceLabel || t('providers.unknown')}
                        </span>
                      </div>
                    </div>
                    {p.capabilities && (
                      <div className="flex gap-1 flex-wrap">
                        {p.capabilities.slice(0, 4).map((c, i) => (
                          <span key={i} className="text-[9px] bg-white/5 text-[var(--muted)] px-1.5 py-0.5 rounded">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Config modal */}
          {configTarget && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={() => setConfigTarget(null)}>
              <div className="card max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold">{t('providers.configure.title', { name: configTarget.name })}</h3>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t('providers.configure.provider', { name: configTarget.provider })}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400">⭐ {configTarget.rating}</span>
                    <span className={`${PRICE_COLORS[(configTarget.priceLevel || 1) - 1]}`}>
                      {configTarget.priceLabel}
                    </span>
                  </div>
                </div>
                {configTarget.description && (
                  <p className="text-xs text-[var(--muted)]">{configTarget.description}</p>
                )}
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">{t('providers.apiKeyLabel')}</label>
                  <input
                    type="password"
                    className="input w-full"
                    placeholder={t('providers.configure.apiKeyPlaceholder')}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setConfigTarget(null)}>{t('common.cancel')}</button>
                  {configTarget.enabled && (
                    <button
                      className="btn-danger flex-1"
                      onClick={async () => { await configureProvider(configTarget.id, ''); setConfigTarget(null); }}
                    >
                      {t('common.disable')}
                    </button>
                  )}
                  <button className="btn-primary flex-1" disabled={!apiKey} onClick={handleConfigure}>
                    {configTarget.enabled ? t('common.update') : t('common.enable')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Talent Market modal */}
          {showTalentMarket && (
            <TalentMarket asModal onClose={() => setShowTalentMarket(false)} />
          )}
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
          <div className="grid grid-cols-4 gap-4">
            <StatCard label={t('systemSettings.skillStats.total')} value={skills.length} />
            <StatCard label={t('systemSettings.skillStats.enabled')} value={skills.filter(s => s.state === 'enabled').length} color="text-green-400" />
            <StatCard label={t('systemSettings.skillStats.categories')} value={[...new Set(skills.map(s => s.category))].length} />
            <StatCard label={t('systemSettings.skillStats.installed')} value={skills.filter(s => s.state !== 'available').length} />
          </div>

          {/* Skills grouped by category */}
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
                  <div key={skill.id} className={`p-3 rounded-lg border transition-all ${
                    skill.state === 'enabled'
                      ? 'border-green-500/30 bg-green-900/10'
                      : 'border-[var(--border)] bg-[var(--background)]'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{skill.icon}</span>
                        <span className="text-sm font-medium truncate">{skill.name}</span>
                      </div>
                      <button
                        onClick={() => handleSkillToggle(skill.id, skill.state)}
                        className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
                          skill.state === 'enabled'
                            ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400'
                            : 'bg-white/10 text-[var(--muted)] hover:bg-green-900/30 hover:text-green-400'
                        }`}
                      >
                        {skill.state === 'enabled' ? t('common.disable') : t('common.enable')}
                      </button>
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
