'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import AgentDetailModal from './AgentDetailModal';
import AgentChatModal from './AgentChatModal';
import { useI18n } from '@/lib/i18n';
import CachedAvatar from './CachedAvatar';
import FilesView from './FilesView';

export default function TeamDetail() {
  const { t } = useI18n();
  const {
    company, loading, activeTeamId, activeSprintId, setActiveSprintId,
    navigateBackFromTeam, fetchTeamDetail, updateTeam, deleteTeam,
    createSprint, discussSprint, approveSprint, fetchSprintDetail,
    sendSprintMessage, deleteSprint,
    fetchWorkspaceFile,
  } = useStore();

  const [team, setTeam] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // overview | sprints | files
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [chatAgent, setChatAgent] = useState(null);

  // Sprint form
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [sprintTitle, setSprintTitle] = useState('');
  const [sprintGoal, setSprintGoal] = useState('');

  // Sprint detail
  const [sprintDetail, setSprintDetail] = useState(null);
  const [sprintTab, setSprintTab] = useState('chat'); // chat | workflow | outputs | files
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  // Skills editing
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillsInput, setSkillsInput] = useState('');

  // Workspace
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [browseDirs, setBrowseDirs] = useState([]);
  const [browseCurrentPath, setBrowseCurrentPath] = useState('');
  const [browseParentPath, setBrowseParentPath] = useState(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Files
  const [previewFile, setPreviewFile] = useState(null); // { path, content, loading }

  const fetchDirs = async (dirPath) => {
    setBrowseLoading(true);
    try {
      const url = dirPath ? `/api/browse-dir?path=${encodeURIComponent(dirPath)}` : '/api/browse-dir';
      const res = await fetch(url);
      const data = await res.json();
      if (!data.error) {
        setBrowseDirs(data.dirs || []);
        setBrowseCurrentPath(data.current || '');
        setBrowseParentPath(data.parent || null);
      }
    } catch (e) { /* handled */ }
    setBrowseLoading(false);
  };

  // Fetch team detail
  const loadTeam = async () => {
    if (!activeTeamId) return;
    const data = await fetchTeamDetail(activeTeamId);
    if (data) setTeam(data);
  };

  useEffect(() => {
    loadTeam();
  }, [activeTeamId]);

  // Auto-refresh sprint detail
  useEffect(() => {
    if (!activeSprintId || !activeTeamId) { setSprintDetail(null); return; }
    let running = true;
    const load = async () => {
      const data = await fetchSprintDetail(activeTeamId, activeSprintId);
      if (data && running) setSprintDetail(data);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { running = false; clearInterval(interval); };
  }, [activeSprintId, activeTeamId]);

  // Scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sprintDetail?.groupChat?.length]);

  // File preview
  const loadFilePreview = useCallback(async (filePath) => {
    if (!team?.departmentId) return;
    setPreviewFile({ path: filePath, content: null, loading: true });
    try {
      const content = await fetchWorkspaceFile(team.departmentId, filePath);
      setPreviewFile({ path: filePath, content: content?.content || content || '', loading: false });
    } catch {
      setPreviewFile({ path: filePath, content: 'Failed to read file', loading: false });
    }
  }, [team?.departmentId, fetchWorkspaceFile]);

  if (!team) {
    return (
      <div className="p-6 text-center text-[var(--muted)]">
        <div className="animate-pulse text-4xl mb-4">👥</div>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  const handleCreateSprint = async () => {
    if (!sprintTitle || !sprintGoal) return;
    const result = await createSprint(activeTeamId, sprintTitle, sprintGoal);
    if (result?.id) {
      setShowNewSprint(false);
      setSprintTitle('');
      setSprintGoal('');
      loadTeam();
      setActiveSprintId(result.id);
    }
  };

  const handleDiscuss = async (sprintId) => {
    await discussSprint(activeTeamId, sprintId);
    loadTeam();
    const data = await fetchSprintDetail(activeTeamId, sprintId);
    if (data) setSprintDetail(data);
  };

  const handleApprove = async (sprintId) => {
    await approveSprint(activeTeamId, sprintId);
    loadTeam();
    const data = await fetchSprintDetail(activeTeamId, sprintId);
    if (data) setSprintDetail(data);
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !activeSprintId) return;
    const msg = chatInput;
    setChatInput('');
    await sendSprintMessage(activeTeamId, activeSprintId, msg);
    const data = await fetchSprintDetail(activeTeamId, activeSprintId);
    if (data) setSprintDetail(data);
  };

  const handleSaveSkills = async () => {
    const skills = skillsInput.split(',').map(s => s.trim()).filter(Boolean);
    await updateTeam(activeTeamId, { skills });
    setEditingSkills(false);
    loadTeam();
  };

  const handleSetWorkspace = async (path) => {
    await updateTeam(activeTeamId, { workspacePath: path });
    setShowWorkspaceSelector(false);
    loadTeam();
  };

  const statusCfg = {
    draft: { label: t('team.sprint.draft'), color: 'text-gray-400', bg: 'bg-gray-900/30', icon: '📝' },
    discussing: { label: t('team.sprint.discussing'), color: 'text-blue-400', bg: 'bg-blue-900/30', icon: '💬' },
    pending_approval: { label: t('team.sprint.pendingApproval'), color: 'text-yellow-400', bg: 'bg-yellow-900/30', icon: '⏳' },
    in_progress: { label: t('team.sprint.inProgress'), color: 'text-green-400', bg: 'bg-green-900/30', icon: '⚙️' },
    completed: { label: t('team.sprint.completed'), color: 'text-emerald-400', bg: 'bg-emerald-900/30', icon: '✅' },
    failed: { label: t('team.sprint.failed'), color: 'text-red-400', bg: 'bg-red-900/30', icon: '❌' },
  };

  // Sprint detail view (inline)
  const renderSprintDetail = () => {
    if (!sprintDetail) return null;
    const st = statusCfg[sprintDetail.status] || statusCfg.draft;
    const groupChat = (sprintDetail.groupChat || []).filter(m => m.visibility !== 'flow');

    return (
      <div className="space-y-4">
        {/* Sprint header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setActiveSprintId(null); setSprintDetail(null); }}
              className="text-[var(--muted)] hover:text-[var(--foreground)] text-sm"
            >
              ← {t('team.sprint.backToList')}
            </button>
            <div className="w-px h-5 bg-[var(--border)]" />
            <span className="text-lg font-bold">{sprintDetail.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.icon} {st.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {sprintDetail.status === 'draft' && (
              <button
                className="btn-primary text-xs"
                disabled={loading}
                onClick={() => handleDiscuss(sprintDetail.id)}
              >
                {loading ? t('team.sprint.discussing') : t('team.sprint.startDiscussion')}
              </button>
            )}
            {sprintDetail.status === 'pending_approval' && (
              <button
                className="btn-primary text-xs"
                disabled={loading}
                onClick={() => handleApprove(sprintDetail.id)}
              >
                {loading ? '...' : t('team.sprint.approve')}
              </button>
            )}
            <button
              className="text-xs px-2 py-1 rounded bg-red-600/15 text-red-400 hover:bg-red-600/25"
              onClick={async () => {
                if (confirm(t('team.sprint.confirmDelete'))) {
                  await deleteSprint(activeTeamId, sprintDetail.id);
                  setActiveSprintId(null);
                  setSprintDetail(null);
                  loadTeam();
                }
              }}
            >
              🗑️
            </button>
          </div>
        </div>

        {/* Goal */}
        <div className="card bg-blue-900/10 border-blue-500/20">
          <div className="text-xs font-medium text-blue-400 mb-1">🎯 {t('team.sprint.goal')}</div>
          <p className="text-sm">{sprintDetail.goal}</p>
        </div>

        {/* Plan (if discussed) */}
        {sprintDetail.plan && (
          <div className="card bg-purple-900/10 border-purple-500/20">
            <div className="text-xs font-medium text-purple-400 mb-1">📋 {t('team.sprint.plan')}</div>
            <pre className="text-sm whitespace-pre-wrap text-[var(--foreground)]/80">{sprintDetail.plan}</pre>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border)] pb-1">
          {[
            { key: 'chat', label: `💬 ${t('team.sprint.chat')}` },
            { key: 'workflow', label: `📊 ${t('team.sprint.workflow')}` },
            { key: 'outputs', label: `📦 ${t('team.sprint.outputs')}` },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setSprintTab(tab.key)}
              className={`text-xs px-3 py-1.5 rounded-t transition-colors ${
                sprintTab === tab.key
                  ? 'bg-[var(--card)] text-[var(--foreground)] border border-b-0 border-[var(--border)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {sprintTab === 'chat' && (
          <div className="card max-h-[50vh] flex flex-col">
            <div className="flex-1 overflow-auto space-y-2 mb-3 min-h-[200px]">
              {groupChat.length === 0 ? (
                <div className="text-center py-8 text-[var(--muted)] text-sm">{t('team.sprint.noMessages')}</div>
              ) : (
                groupChat.map(msg => (
                  <div key={msg.id} className={`flex gap-2 ${msg.type === 'system' ? 'justify-center' : ''}`}>
                    {msg.type === 'system' ? (
                      <div className="text-[10px] text-[var(--muted)] bg-white/5 px-3 py-1 rounded-full">{msg.content}</div>
                    ) : (
                      <>
                        <div className="shrink-0 w-7 h-7">
                          {msg.from.avatar ? (
                            <CachedAvatar src={msg.from.avatar} alt={msg.from.name} className="w-7 h-7 rounded-full" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-[var(--border)] flex items-center justify-center text-xs">
                              {msg.from.name?.[0] || '?'}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{msg.from.name}</span>
                            <span className="text-[10px] text-[var(--muted)]">
                              {new Date(msg.time).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-sm mt-0.5 whitespace-pre-wrap break-words">{msg.content}</div>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            {/* Chat input */}
            <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
              <input
                className="input flex-1 text-sm"
                placeholder={t('team.sprint.chatPlaceholder')}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
              />
              <button
                className="btn-primary text-sm px-4"
                disabled={!chatInput.trim()}
                onClick={handleSendChat}
              >
                {t('common.send')}
              </button>
            </div>
          </div>
        )}

        {sprintTab === 'workflow' && (
          <div className="card">
            {sprintDetail.workflow?.nodes?.length > 0 ? (
              <div className="space-y-2">
                {/* Progress bar */}
                {(() => {
                  const nodes = sprintDetail.workflow.nodes;
                  const completed = nodes.filter(n => n.status === 'completed').length;
                  const total = nodes.length;
                  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                  return (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                        <span>{t('reqDetail.workflow.progress')}</span>
                        <span>{completed}/{total} ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 bg-[var(--border)] rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}
                {sprintDetail.workflow.nodes.map((node, i) => {
                  const nodeSt = {
                    waiting: { color: 'border-gray-600', text: 'text-gray-400', icon: '⏳' },
                    ready: { color: 'border-blue-600', text: 'text-blue-400', icon: '🟢' },
                    running: { color: 'border-yellow-600', text: 'text-yellow-400', icon: '⚙️' },
                    reviewing: { color: 'border-purple-600', text: 'text-purple-400', icon: '🔍' },
                    revision: { color: 'border-orange-600', text: 'text-orange-400', icon: '🔄' },
                    completed: { color: 'border-green-600', text: 'text-green-400', icon: '✅' },
                    failed: { color: 'border-red-600', text: 'text-red-400', icon: '❌' },
                  }[node.status] || { color: 'border-gray-600', text: 'text-gray-400', icon: '❓' };
                  return (
                    <div key={node.id} className={`border-l-2 ${nodeSt.color} pl-3 py-2`}>
                      <div className="flex items-center gap-2">
                        <span>{nodeSt.icon}</span>
                        <span className="text-sm font-medium">{node.title}</span>
                        <span className={`text-[10px] ${nodeSt.text}`}>{node.status}</span>
                      </div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">
                        → {node.assigneeName || 'TBD'}
                        {node.reviewerName && <span className="ml-2">🔍 {node.reviewerName}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                {t('reqDetail.workflow.notParsed')}
              </div>
            )}
          </div>
        )}

        {sprintTab === 'outputs' && (
          <div className="card">
            {sprintDetail.outputs?.length > 0 ? (
              <div className="space-y-3">
                {sprintDetail.outputs.map(out => (
                  <div key={out.id} className="border border-[var(--border)] rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{out.agentName}</span>
                      <span className="text-[10px] text-[var(--muted)]">{out.role}</span>
                      <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">{out.outputType}</span>
                    </div>
                    <pre className="text-xs whitespace-pre-wrap max-h-40 overflow-auto text-[var(--foreground)]/80 bg-black/20 p-2 rounded">
                      {out.content?.length > 500 ? out.content.slice(0, 500) + '...' : out.content}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                {t('reqDetail.outputs.noOutputs')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Top bar */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--card)]/50 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={navigateBackFromTeam}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm flex items-center gap-1 shrink-0"
            >
              ← {t('team.back')}
            </button>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-purple-700 rounded-lg flex items-center justify-center text-lg shrink-0">
                👥
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold flex items-center gap-2 truncate">
                  {team.name}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">
                    {team.departmentName}
                  </span>
                </h1>
                <p className="text-xs text-[var(--muted)] truncate">{team.description || t('team.noDescription')}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary flex items-center gap-1.5 text-sm"
              onClick={() => { setShowNewSprint(true); setSprintTitle(''); setSprintGoal(''); }}
            >
              🚀 {t('team.newSprint')}
            </button>
          </div>
        </div>
        {/* Stats */}
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
          <span>👥 {team.memberIds?.length || 0} {t('team.members')}</span>
          <span>👔 {team.leaderName}</span>
          <span>🔄 {team.sprints?.length || 0} {t('team.sprints')}</span>
          {team.workspacePath && <span>📁 {team.workspacePath}</span>}
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {[
            { key: 'overview', label: t('team.tab.overview') },
            { key: 'sprints', label: t('team.tab.sprints') },
            { key: 'files', label: t('team.tab.files') },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setActiveSprintId(null); setSprintDetail(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--muted)] hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className={`flex-1 min-h-0 p-6 space-y-6 flex flex-col ${activeTab === 'files' ? 'overflow-hidden' : 'overflow-auto'}`}>

        {/* New Sprint Form */}
        {showNewSprint && (
          <div className="card border-[var(--accent)]/30 animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">🚀 {t('team.newSprint')}</h3>
              <button onClick={() => setShowNewSprint(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.sprint.titleLabel')}</label>
              <input
                className="input w-full"
                placeholder={t('team.sprint.titlePlaceholder')}
                value={sprintTitle}
                onChange={e => setSprintTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">{t('team.sprint.goalLabel')}</label>
              <textarea
                className="input w-full h-24 resize-none"
                placeholder={t('team.sprint.goalPlaceholder')}
                value={sprintGoal}
                onChange={e => setSprintGoal(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNewSprint(false)}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                disabled={!sprintTitle || !sprintGoal || loading}
                onClick={handleCreateSprint}
              >
                {loading ? t('common.loading') : t('team.sprint.createBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Overview tab */}
        {activeTab === 'overview' && !activeSprintId && (
          <>
            {/* Members */}
            <div>
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">{t('team.membersTitle')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(team.membersDetail || []).map(member => (
                  <div
                    key={member.id}
                    className="card hover:border-[var(--accent)]/30 transition-all cursor-pointer group"
                    onClick={() => setSelectedAgent(member.id)}
                  >
                    <div className="flex items-start gap-3">
                      <CachedAvatar src={member.avatar} alt={member.name} className="w-12 h-12 rounded-full bg-[var(--border)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{member.name}</span>
                          {team.leaderId === member.id && (
                            <span className="text-[10px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">{t('team.leader')}</span>
                          )}
                          <span className={`status-dot ${member.status}`} />
                        </div>
                        <div className="text-xs text-[var(--muted)]">{member.role}</div>
                        {member.signature && <div className="text-[10px] text-[var(--muted)] italic mt-1 truncate">"{member.signature}"</div>}
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 text-sm transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatAgent({ id: member.id, name: member.name, avatar: member.avatar, role: member.role, signature: member.signature, department: team.departmentName });
                        }}
                      >
                        💬
                      </button>
                    </div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {member.skills?.slice(0, 4).map((s, i) => (
                        <span key={i} className="text-[10px] text-[var(--muted)] bg-white/5 px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skills */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">{t('team.skillsTitle')}</h2>
                <button
                  className="text-xs text-[var(--accent)] hover:underline"
                  onClick={() => { setEditingSkills(true); setSkillsInput((team.skills || []).join(', ')); }}
                >
                  ✏️ {t('team.editSkills')}
                </button>
              </div>
              {editingSkills ? (
                <div className="card space-y-3">
                  <textarea
                    className="input w-full h-16 resize-none text-sm"
                    placeholder={t('team.skillsPlaceholder')}
                    value={skillsInput}
                    onChange={e => setSkillsInput(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary text-xs" onClick={() => setEditingSkills(false)}>{t('common.cancel')}</button>
                    <button className="btn-primary text-xs" onClick={handleSaveSkills}>{t('common.save')}</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {(team.skills || []).length > 0 ? (
                    team.skills.map((s, i) => (
                      <span key={i} className="text-xs bg-purple-900/30 text-purple-400 px-2 py-1 rounded">{s}</span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--muted)]">{t('team.noSkills')}</span>
                  )}
                </div>
              )}
            </div>

            {/* Workspace */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">{t('team.workspaceTitle')}</h2>
                <button
                  className="text-xs text-[var(--accent)] hover:underline"
                  onClick={() => { setShowWorkspaceSelector(true); setWorkspaceInput(team.workspacePath || ''); fetchDirs(team.workspacePath || ''); }}
                >
                  📁 {t('team.selectWorkspace')}
                </button>
              </div>
              {team.workspacePath ? (
                <div className="card text-sm font-mono">{team.workspacePath}</div>
              ) : (
                <div className="card text-sm text-[var(--muted)]">{t('team.noWorkspace')}</div>
              )}
            </div>

            {/* Recent sprints */}
            <div>
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">{t('team.recentSprints')}</h2>
              {(team.sprints || []).length > 0 ? (
                <div className="space-y-2">
                  {team.sprints.slice(0, 5).map(sprint => {
                    const st = statusCfg[sprint.status] || statusCfg.draft;
                    return (
                      <div
                        key={sprint.id}
                        className="card cursor-pointer hover:border-[var(--accent)]/30 transition-all"
                        onClick={() => { setActiveTab('sprints'); setActiveSprintId(sprint.id); }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{st.icon}</span>
                            <span className="text-sm font-medium">{sprint.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                            {sprint.workflow && <span className="text-[10px] text-[var(--muted)]">📊 {sprint.workflow.completedCount || 0}/{sprint.workflow.nodeCount || 0}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="card text-center py-6 text-[var(--muted)]">
                  <div className="text-2xl mb-2">🚀</div>
                  <p className="text-sm">{t('team.noSprints')}</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Sprints tab / Sprint detail */}
        {activeTab === 'sprints' && (
          activeSprintId ? renderSprintDetail() : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">{t('team.tab.sprints')}</h2>
                <button
                  className="text-xs text-[var(--accent)] hover:underline"
                  onClick={() => { setShowNewSprint(true); setSprintTitle(''); setSprintGoal(''); }}
                >
                  + {t('team.newSprint')}
                </button>
              </div>
              {(team.sprints || []).length > 0 ? (
                <div className="space-y-2">
                  {team.sprints.map(sprint => {
                    const st = statusCfg[sprint.status] || statusCfg.draft;
                    return (
                      <div
                        key={sprint.id}
                        className="card cursor-pointer hover:border-[var(--accent)]/30 transition-all"
                        onClick={() => setActiveSprintId(sprint.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{st.icon}</span>
                            <span className="text-sm font-medium">{sprint.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                            {sprint.chatCount > 0 && <span className="text-[10px] text-[var(--muted)]">💬 {sprint.chatCount}</span>}
                            {sprint.workflow && <span className="text-[10px] text-[var(--muted)]">📊 {sprint.workflow.completedCount || 0}/{sprint.workflow.nodeCount || 0}</span>}
                          </div>
                        </div>
                        <p className="text-xs text-[var(--muted)] mt-1 truncate">🎯 {sprint.goal}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="card text-center py-8 text-[var(--muted)]">
                  <div className="text-3xl mb-2">🚀</div>
                  <p className="text-sm">{t('team.noSprints')}</p>
                </div>
              )}
            </div>
          )
        )}

        {/* Overview + active sprint */}
        {activeTab === 'overview' && activeSprintId && renderSprintDetail()}

        {/* Files tab */}
        {activeTab === 'files' && (
          <div className="flex-1 min-h-0">
            {team.workspacePath ? (
              <div className="h-full">
                <FilesView
                  departmentId={team.departmentId}
                  previewFile={previewFile}
                  onPreview={loadFilePreview}
                  onClosePreview={() => setPreviewFile(null)}
                />
              </div>
            ) : (
              <div className="card text-center py-8 text-[var(--muted)]">
                <div className="text-3xl mb-2">📁</div>
                <p className="text-sm">{t('team.noWorkspace')}</p>
                <button
                  className="btn-secondary mt-3 text-sm"
                  onClick={() => { setShowWorkspaceSelector(true); fetchDirs(''); }}
                >
                  {t('team.selectWorkspace')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedAgent && <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />}
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

      {/* Workspace selector modal */}
      {showWorkspaceSelector && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center !m-0" onClick={() => setShowWorkspaceSelector(false)}>
          <div className="card max-w-lg w-full mx-4 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">📁 {t('team.selectWorkspace')}</h3>
              <button onClick={() => setShowWorkspaceSelector(false)} className="text-[var(--muted)] hover:text-white text-lg">✕</button>
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
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer text-sm" onClick={() => fetchDirs(browseParentPath)}>
                      <span>📂</span><span className="text-[var(--muted)]">..</span>
                    </div>
                  )}
                  {browseDirs.map(dir => (
                    <div key={dir.path} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer text-sm" onClick={() => fetchDirs(dir.path)}>
                      <span>📁</span><span className="truncate">{dir.name}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="flex gap-2 pt-3 border-t border-[var(--border)] mt-2">
              <button className="btn-secondary flex-1" onClick={() => setShowWorkspaceSelector(false)}>{t('common.cancel')}</button>
              <button className="btn-primary flex-1" onClick={() => handleSetWorkspace(browseCurrentPath)}>
                {t('dept.newReq.selectDir')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
