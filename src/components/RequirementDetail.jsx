'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import GroupChatView from './GroupChatView';
import AgentDetailModal from './AgentDetailModal';
import CachedAvatar from './CachedAvatar';
import FilesView from './FilesView';
import PixelOffice from './PixelOffice';

import { useRouter } from 'next/navigation';



/**
 * Requirement detail page
 * Displays: requirement info, workflow DAG, group chat messages, output results
 */
export default function RequirementDetail({ requirementId, onClose }) {
  const { t } = useI18n();
const { fetchRequirementDetail, requirementDetail, clearRequirementDetail, fetchWorkspaceFile, navigateBack, activeRequirementId, deleteRequirement, restartRequirement, sendGroupChatMessage, company } = useStore();
  const reqId = requirementId || activeRequirementId;
  const isPage = !onClose; // If no onClose is passed, it is standalone page mode
  const [activeTab, setActiveTab] = useState('workflow'); // workflow | files
  const chatEndRef = useRef(null);
  const pollRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null); // { path, content, loading }

  // 群员交互：查看卡片信息 + 偷看心流
  const [selectedMemberAgentId, setSelectedMemberAgentId] = useState(null);
  const [peekFlowAgentId, setPeekFlowAgentId] = useState(null);
  const [peekFlowData, setPeekFlowData] = useState(null);
  const [peekFlowMsgs, setPeekFlowMsgs] = useState([]);
  const [peekFlowThoughtMsgs, setPeekFlowThoughtMsgs] = useState([]); // 内心独白消息（monologue 类型）
  const [peekFlowHistory, setPeekFlowHistory] = useState([]);
  const [peekFlowLoading, setPeekFlowLoading] = useState(false);
  const [peekFlowTab, setPeekFlowTab] = useState('thoughts');

  // Save reqId to ref to avoid reading stale value in closure
  const reqIdRef = useRef(reqId);
  reqIdRef.current = reqId;

  useEffect(() => {
    if (!reqId) return;
    fetchRequirementDetail(reqId);
    // Speed up polling for executing requirements (2s)
    pollRef.current = setInterval(() => {
      fetchRequirementDetail(reqIdRef.current);
    }, 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId]);

  // Clear all states on component unmount
  useEffect(() => {
    return () => {
      clearRequirementDetail();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Stop polling completed requirements or reduce polling frequency
  useEffect(() => {
    if (requirementDetail && (requirementDetail.status === 'completed' || requirementDetail.status === 'failed')) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        // Reduce to 10s polling after completion (keep updated without too many resources)
        pollRef.current = setInterval(() => {
          fetchRequirementDetail(reqId);
        }, 10000);
      }
    }
  }, [requirementDetail?.status]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTab, requirementDetail?.groupChat?.length]);

  // File preview loading
  const loadFilePreview = useCallback(async (filePath) => {
    if (!requirementDetail?.departmentId) return;
    setPreviewFile({ path: filePath, content: null, loading: true });
    try {
      const content = await fetchWorkspaceFile(requirementDetail.departmentId, filePath);
      setPreviewFile({ path: filePath, content: content?.content || content || t('reqDetail.files.noContent'), loading: false });
    } catch {
      setPreviewFile({ path: filePath, content: t('reqDetail.files.readFailed'), loading: false });
    }
  }, [requirementDetail?.departmentId]);

  // 偷看员工心流
  const peekMemberFlow = useCallback(async (agentId) => {
    setPeekFlowAgentId(agentId);
    setPeekFlowLoading(true);
    setPeekFlowTab('thoughts');
    try {
      const [currentRes, historyRes, flowRes, thoughtRes] = await Promise.all([
        fetch(`/api/group-chat-loop?agentId=${agentId}&groupId=${reqId}`),
        fetch(`/api/group-chat-loop?agentId=${agentId}&groupId=${reqId}&history=1`),
        fetch(`/api/group-chat-loop?agentId=${agentId}&groupId=${reqId}&flowMessages=1`),
        fetch(`/api/group-chat-loop?agentId=${agentId}&groupId=${reqId}&monologueMessages=1`),
      ]);
      const currentData = await currentRes.json();
      const historyData = await historyRes.json();
      const flowData = await flowRes.json();
      const thoughtData = await thoughtRes.json();
      setPeekFlowData(currentData.data);
      setPeekFlowHistory(historyData.data || []);
      setPeekFlowMsgs(flowData.data || []);
      setPeekFlowThoughtMsgs(thoughtData.data || []);
    } catch (err) {
      console.error('Failed to peek flow:', err);
    } finally {
      setPeekFlowLoading(false);
    }
  }, [reqId]);

  // 自动刷新心流
  useEffect(() => {
    if (!peekFlowAgentId || !reqId) return;
    const timer = setInterval(async () => {
      try {
        const [res, flowRes, thoughtRes] = await Promise.all([
          fetch(`/api/group-chat-loop?agentId=${peekFlowAgentId}&groupId=${reqId}`),
          fetch(`/api/group-chat-loop?agentId=${peekFlowAgentId}&groupId=${reqId}&flowMessages=1`),
          fetch(`/api/group-chat-loop?agentId=${peekFlowAgentId}&groupId=${reqId}&monologueMessages=1`),
        ]);
        const data = await res.json();
        const flowData = await flowRes.json();
        const thoughtData = await thoughtRes.json();
        if (data.data) setPeekFlowData(data.data);
        if (flowData.data) setPeekFlowMsgs(flowData.data);
        if (thoughtData.data) setPeekFlowThoughtMsgs(thoughtData.data);
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [peekFlowAgentId, reqId]);

  const handleClose = onClose || navigateBack;

  if (!requirementDetail) {
    return isPage ? (
      <div className="flex items-center justify-center h-full">
        <div className="card p-8">
          <span className="animate-pulse text-[var(--muted)]">{t('common.loading')}</span>
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0">
        <div className="card p-8">
          <span className="animate-pulse text-[var(--muted)]">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  const req = requirementDetail;
  const statusConfig = {
    pending: { label: t('reqDetail.status.pending'), color: 'text-gray-400', bg: 'bg-gray-900/30' },
    planning: { label: t('reqDetail.status.planning'), color: 'text-blue-400', bg: 'bg-blue-900/30' },
    in_progress: { label: t('reqDetail.status.in_progress'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
    completed: { label: t('reqDetail.status.completed'), color: 'text-green-400', bg: 'bg-green-900/30' },
    failed: { label: t('reqDetail.status.failed'), color: 'text-red-400', bg: 'bg-red-900/30' },
  };
  const st = statusConfig[req.status] || statusConfig.pending;

  // Page mode: full-screen standalone page
  if (isPage) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {/* Header navigation bar */}
        <div className="px-6 py-4 border-b border-white/[0.06] bg-[var(--card)] flex items-start justify-between shrink-0">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button
              onClick={handleClose}
              className="text-[var(--muted)] hover:text-white text-sm flex items-center gap-1 shrink-0 transition-colors hover:bg-white/5 px-2 py-1 rounded-lg"
            >
              ← {t('reqDetail.backShort')}
            </button>
            <div className="w-px h-8 bg-white/[0.08]" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold truncate">{req.title}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                  {st.label}
                </span>
                {req.status === 'in_progress' && (
                  <span className="animate-pulse text-yellow-400 text-xs">{t('reqDetail.executingShort')}</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-[var(--muted)]">
                <span>🏢 {req.departmentName}</span>
                <span>📅 {new Date(req.createdAt).toLocaleString()}</span>
                <span className="truncate max-w-md">{req.description}</span>
                {req.summary && (
                  <>
                    <span>{t('reqDetail.summary.tasks', { n: req.summary.successTasks, total: req.summary.totalTasks })}</span>
                    <span>{t('reqDetail.summary.duration', { n: Math.round((req.summary.totalDuration || 0) / 1000) })}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={() => restartRequirement(req.id)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/20 transition-colors flex items-center gap-1"
            >
              {t('reqDetail.live.restart')}
            </button>
            <button
              onClick={() => { if (confirm(t('reqDetail.live.confirmDelete'))) deleteRequirement(req.id); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600/25 text-red-400 border border-red-500/20 transition-colors flex items-center gap-1"
            >
              {t('reqDetail.live.deleteReq')}
            </button>
          </div>
        </div>

        {/* 左右布局主体 */}
        <div className="flex-1 min-h-0 flex">
          {/* 左侧：群聊面板 */}
          <div className="w-[380px] shrink-0 border-r border-white/[0.06] flex flex-col bg-[var(--background)]">
            <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[var(--card)] flex items-center justify-between">
              <span className="text-sm font-medium">{t('reqDetail.tabs.chat')}</span>
              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full text-[var(--muted)]">{(req.groupChat || []).length}</span>
            </div>
            {(() => {
              const chatAgentMap = {};
              if (company?.departments) {
                for (const dept of company.departments) {
                  for (const agent of (dept.members || dept.agents || [])) {
                    chatAgentMap[agent.id] = agent.name;
                  }
                }
              }
              const leaderMsg = (req.groupChat || []).find(m => m.from?.id !== 'boss' && m.from?.role !== 'system' && m.type !== 'system');
              const chatLeaderInfo = leaderMsg ? { name: leaderMsg.from?.name, avatar: leaderMsg.from?.avatar } : null;
              return (
                <GroupChatView
                  groupChat={req.groupChat || []}
                  agentMap={chatAgentMap}
                  bossAvatar={company?.bossAvatar}
                  bossName={company?.boss || 'Boss'}
                  requirementId={req.id}
                  onSendMessage={sendGroupChatMessage}
                  fetchDetail={fetchRequirementDetail}
                  leaderInfo={chatLeaderInfo}
                  chatEndRef={chatEndRef}
                  embedded
                />
              );
            })()}
          </div>

          {/* 右侧：群员列表 + Tab bar + Content */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 群员列表 + 流程卡点 */}
            <MembersAndBlockingPanel members={req.members} blockingInfo={req.blockingInfo} workflow={req.workflow} status={req.status} onPeekFlow={peekMemberFlow} onViewAgent={setSelectedMemberAgentId} />

            {/* Tab bar (不含 chat，因为群聊已在左侧) */}
            <div className="flex border-b border-white/[0.06] shrink-0 px-6 bg-[var(--card)]">
              {[
                { id: 'workflow', label: t('reqDetail.tabs.workflow'), badge: req.workflow?.nodes?.length },
                { id: 'files', label: t('reqDetail.tabs.files'), badge: new Set((req.liveStatus?.recentFileChanges || []).filter(f => f.filePath).map(f => f.filePath.replace(/^\.[\/\\]/, ''))).size },
                { id: 'office', label: t('reqDetail.tabs.office') },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3 text-sm font-medium transition-all border-b-2 ${
                    activeTab === tab.id
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--muted)] hover:text-white'
                  }`}
                >
                  {tab.label}
                  {tab.badge > 0 && (
                    <span className="ml-1.5 text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{tab.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Content area */}
            <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' || activeTab === 'office' ? 'overflow-hidden' : 'overflow-auto'}`}>
              {activeTab === 'workflow' && (
                <>
                  {(req.status === 'in_progress' || req.status === 'planning' || req.status === 'failed') && req.liveStatus && (
                    <LiveStatusPanel
                      liveStatus={req.liveStatus}
                      requirementId={req.id}
                      requirementStatus={req.status}
                      onRestart={() => restartRequirement(req.id)}
                      onDelete={() => deleteRequirement(req.id)}
                    />
                  )}
                  <WorkflowView workflow={req.workflow} liveStatus={req.liveStatus} members={req.members} />
                </>
              )}
              {activeTab === 'files' && (
                <div className="flex-1 min-h-0">
                  <FilesView
                    fileChanges={req.liveStatus?.recentFileChanges || []}
                    departmentId={req.departmentId}
                    previewFile={previewFile}
                    onPreview={loadFilePreview}
                    onClosePreview={() => setPreviewFile(null)}
                  />
                </div>
              )}
              {activeTab === 'office' && (
                <div className="flex-1 min-h-0">
                  <PixelOffice embedded groupChat={req.groupChat} members={req.members} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Agent 卡片弹窗 */}
        {selectedMemberAgentId && (
          <AgentDetailModal agentId={selectedMemberAgentId} onClose={() => setSelectedMemberAgentId(null)} />
        )}

        {/* 心流偷看弹窗 */}
        {peekFlowAgentId && (
          <FlowPeekModal
            agentId={peekFlowAgentId}
            agentName={req.members?.find(m => m.id === peekFlowAgentId)?.name || peekFlowAgentId}
            loading={peekFlowLoading}
            tab={peekFlowTab}
            onTabChange={setPeekFlowTab}
            flowMsgs={peekFlowMsgs}
            monologueData={peekFlowData}
            monologueThoughtMsgs={peekFlowThoughtMsgs}
            history={peekFlowHistory}
            onClose={() => setPeekFlowAgentId(null)}
          />
        )}
      </div>
    );
  }

  // Modal mode (backward compatible, but no longer used)
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={handleClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-5xl w-full mx-4 max-h-[90vh] min-h-[60vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-start justify-between shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold truncate">{req.title}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                {st.label}
              </span>
              {req.status === 'in_progress' && (
                  <span className="animate-pulse text-yellow-400 text-xs">{t('reqDetail.executingShort')}</span>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{req.description}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
              <span>🏢 {req.departmentName}</span>
              <span>📅 {new Date(req.createdAt).toLocaleString()}</span>
              {req.summary && (
                <>
                  <span>✅ {req.summary.successTasks}/{req.summary.totalTasks} {t('reqDetail.summary.tasks', { n: req.summary.successTasks, total: req.summary.totalTasks }).replace(/✅ \d+\/\d+ /, '')}</span>
                  <span>⏱️ {Math.round((req.summary.totalDuration || 0) / 1000)}s</span>
                </>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="text-[var(--muted)] hover:text-white text-xl ml-4 shrink-0">✕</button>
        </div>

        {/* 群员列表 + 流程卡点 */}
        <MembersAndBlockingPanel members={req.members} blockingInfo={req.blockingInfo} workflow={req.workflow} status={req.status} onPeekFlow={peekMemberFlow} onViewAgent={setSelectedMemberAgentId} />

        {/* Tab bar */}
        <div className="flex border-b border-white/[0.06] shrink-0 px-6">
          {[
            { id: 'workflow', label: t('reqDetail.tabs.workflow'), badge: req.workflow?.nodes?.length },
            { id: 'chat', label: t('reqDetail.tabs.chat'), badge: req.groupChat?.length },
            { id: 'files', label: t('reqDetail.tabs.files'), badge: new Set((req.liveStatus?.recentFileChanges || []).filter(f => f.filePath).map(f => f.filePath.replace(/^\.[\/\\]/, ''))).size },
            { id: 'office', label: t('reqDetail.tabs.office') },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--muted)] hover:text-white'
              }`}
            >
              {tab.label}
              {tab.badge > 0 && (
                <span className="ml-1.5 text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' || activeTab === 'office' ? 'overflow-hidden' : 'overflow-auto'}`} style={{ minHeight: activeTab === 'files' || activeTab === 'office' ? '400px' : undefined }}>
          {activeTab === 'workflow' && (
            <>
              {/* Live progress panel (only shown under workflow tab) */}
              {(req.status === 'in_progress' || req.status === 'planning' || req.status === 'failed') && req.liveStatus && (
                <LiveStatusPanel
                  liveStatus={req.liveStatus}
                  requirementId={req.id}
                  requirementStatus={req.status}
                  onRestart={() => restartRequirement(req.id)}
                  onDelete={() => deleteRequirement(req.id)}
                />
              )}
              <WorkflowView workflow={req.workflow} liveStatus={req.liveStatus} members={req.members} />
            </>
          )}
          {activeTab === 'chat' && (() => {
            const chatAgentMap = {};
            if (company?.departments) {
              for (const dept of company.departments) {
                for (const agent of (dept.members || dept.agents || [])) {
                  chatAgentMap[agent.id] = agent.name;
                }
              }
            }
            const leaderMsg = (req.groupChat || []).find(m => m.from?.id !== 'boss' && m.from?.role !== 'system' && m.type !== 'system');
            const chatLeaderInfo = leaderMsg ? { name: leaderMsg.from?.name, avatar: leaderMsg.from?.avatar } : null;
            return (
              <GroupChatView
                groupChat={req.groupChat || []}
                agentMap={chatAgentMap}
                bossAvatar={company?.bossAvatar}
                bossName={company?.boss || 'Boss'}
                requirementId={req.id}
                onSendMessage={sendGroupChatMessage}
                fetchDetail={fetchRequirementDetail}
                leaderInfo={chatLeaderInfo}
                chatEndRef={chatEndRef}
                embedded
              />
            );
          })()}
          {activeTab === 'files' && (
            <div className="flex-1 min-h-0">
              <FilesView
                fileChanges={req.liveStatus?.recentFileChanges || []}
                departmentId={req.departmentId}
                previewFile={previewFile}
                onPreview={loadFilePreview}
                onClosePreview={() => setPreviewFile(null)}
              />
            </div>
          )}
          {activeTab === 'office' && (
            <div className="flex-1 min-h-0">
              <PixelOffice embedded groupChat={req.groupChat} members={req.members} />
            </div>
          )}
        </div>

        {/* Agent 卡片弹窗 */}
        {selectedMemberAgentId && (
          <AgentDetailModal agentId={selectedMemberAgentId} onClose={() => setSelectedMemberAgentId(null)} />
        )}

        {/* 心流偷看弹窗 */}
        {peekFlowAgentId && (
          <FlowPeekModal
            agentId={peekFlowAgentId}
            agentName={req.members?.find(m => m.id === peekFlowAgentId)?.name || peekFlowAgentId}
            loading={peekFlowLoading}
            tab={peekFlowTab}
            onTabChange={setPeekFlowTab}
            flowMsgs={peekFlowMsgs}
            monologueData={peekFlowData}
            monologueThoughtMsgs={peekFlowThoughtMsgs}
            history={peekFlowHistory}
            onClose={() => setPeekFlowAgentId(null)}
          />
        )}
      </div>
    </div>
  );
}


/**
 * Workflow visualization - SVG flowchart + div cards (foreignObject)
 * Multi-arrow merging: multiple incoming edges merge into one vertical line then connect to target
 */
function WorkflowView({ workflow, liveStatus, members }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const measureRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredNode, setHoveredNode] = useState(null); // { node, rect }
  const [measuredHeights, setMeasuredHeights] = useState({}); // nodeId -> height
  const [measureTick, setMeasureTick] = useState(0); // Used to trigger re-measurement

  // Watch container width
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setContainerWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // MutationObserver: watch measurement container DOM changes, auto re-measure with debounce
  useEffect(() => {
    if (!measureRef.current) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setMeasureTick(t => t + 1), 100);
    });
    obs.observe(measureRef.current, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => { obs.disconnect(); clearTimeout(timer); };
  }, [workflow]);

  // Measure actual heights of all cards
  useEffect(() => {
    if (!measureRef.current) return;
    const cards = measureRef.current.querySelectorAll('[data-node-id]');
    const heights = {};
    cards.forEach(card => {
      const id = card.getAttribute('data-node-id');
      if (id) {
        // scrollHeight gets actual content height
        heights[id] = Math.max(card.scrollHeight, 60); // minimum 60px
      }
    });
    setMeasuredHeights(prev => {
      // Only update when actually changed to avoid infinite loop
      const changed = Object.keys(heights).some(k => prev[k] !== heights[k]) ||
                      Object.keys(heights).length !== Object.keys(prev).length;
      return changed ? heights : prev;
    });
  }, [workflow, liveStatus, containerWidth, measureTick]);

  // Topological layering + layout calculation (based on measured heights)
  const layout = useMemo(() => {
    if (!workflow?.nodes?.length) return null;
    const nodes = workflow.nodes;

    // Topological layering
    const levels = [];
    const placed = new Set();
    let remaining = [...nodes];
    while (remaining.length > 0) {
      const level = remaining.filter(n => n.dependencies.every(d => placed.has(d)));
      if (level.length === 0) { levels.push(remaining); break; }
      levels.push(level);
      level.forEach(n => placed.add(n.id));
      remaining = remaining.filter(n => !placed.has(n.id));
    }

    // Layout parameters
    const nodeW = 280;
    const defaultH = 90; // Default height (initial value before measurement)
    const padding = 8; // Extra padding
    const gapX = 32, gapY = 80;
    const padX = 40, padY = 40;

    // Effective width
    const effectiveW = Math.max(containerWidth - padX * 2, 600);

    // Calculate node positions per layer (centered, height from measurement)
    const nodePositions = {};
    let cumulativeY = padY;
    levels.forEach((level, li) => {
      // Max height of this layer = tallest measured card height in this layer
      const layerH = Math.max(...level.map(n => (measuredHeights[n.id] || defaultH) + padding));
      const totalW = level.length * nodeW + (level.length - 1) * gapX;
      const startX = padX + (effectiveW - totalW) / 2;
      level.forEach((node, ni) => {
        const h = (measuredHeights[node.id] || defaultH) + padding;
        nodePositions[node.id] = {
          x: Math.max(padX, startX + ni * (nodeW + gapX)),
          y: cumulativeY,
          w: nodeW,
          h,
          node,
          level: li,
        };
      });
      cumulativeY += layerH + gapY;
    });

    const totalHeight = cumulativeY - gapY + padY;
    const totalWidth = Math.max(effectiveW + padX * 2, containerWidth);

    // Build edge merge info
    const edgeGroups = {}; // targetId -> [fromId, ...]
    nodes.forEach(node => {
      if (node.dependencies.length > 0) {
        edgeGroups[node.id] = node.dependencies.filter(d => nodePositions[d]);
      }
    });

    return { levels, nodePositions, edgeGroups, totalWidth, totalHeight, nodeW, nodes };
  }, [workflow, containerWidth, measuredHeights]);

  // Build member avatar map { id -> avatar } (must be before conditional returns to satisfy hooks rules)
  const memberAvatarMap = useMemo(() => {
    const map = {};
    if (members?.length) {
      members.forEach(m => { if (m.avatar) map[m.id] = m.avatar; });
    }
    return map;
  }, [members]);

  if (!workflow?.nodes?.length) {
    // planning 阶段：展示负责人头像 + 气泡（表示正在拆解任务）
    if (liveStatus?.currentAgentAvatar || liveStatus?.currentAgent) {
      return (
        <div className="flex items-start gap-3 px-6 py-8">
          <div className="relative shrink-0">
            {liveStatus.currentAgentAvatar ? (
              <CachedAvatar src={liveStatus.currentAgentAvatar} alt="" className="w-10 h-10 rounded-full bg-[var(--border)]" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm">🤖</div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[var(--card)]" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-[var(--muted)] mb-1 font-medium">{liveStatus.currentAgent || t('reqDetail.workflow.leader')}</div>
            <div className="inline-block bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="animate-pulse">🧠</span>
                <span className="text-[var(--muted)]">{liveStatus.currentAction || t('reqDetail.workflow.planning')}</span>
              </div>
              <div className="flex items-center gap-1 mt-2">
                <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📋</div>
          <p>{t('reqDetail.workflow.notParsed')}</p>
        </div>
      </div>
    );
  }

  if (!layout) return null;

  const { nodePositions, edgeGroups, totalWidth, totalHeight, nodes } = layout;

  const statusIcon = {
    waiting: '⏳', ready: '🔵', running: '🔄', reviewing: '🔍', revision: '🔄', completed: '✅', failed: '❌',
  };
  const statusBorderColor = {
    waiting: '#4b5563', ready: '#3b82f6', running: '#eab308', reviewing: '#8b5cf6', revision: '#f59e0b', completed: '#22c55e', failed: '#ef4444',
  };
  const statusColor = {
    waiting: 'border-gray-600',
    ready: 'border-blue-500',
    running: 'border-yellow-500 animate-pulse',
    reviewing: 'border-purple-500 animate-pulse',
    revision: 'border-orange-500 animate-pulse',
    completed: 'border-green-500',
    failed: 'border-red-500',
  };

  // Card content render function (shared by measurement container and actual render)
  const renderCardContent = (node) => {
    const assigneeAvatar = memberAvatarMap[node.assigneeId];
    const reviewerAvatar = memberAvatarMap[node.reviewerId];
    return (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{statusIcon[node.status]}</span>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{node.title}</div>
            <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
              {assigneeAvatar ? (
                <CachedAvatar src={assigneeAvatar} alt="" className="w-4 h-4 rounded-full inline-block" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-[8px] shrink-0">
                  {node.assigneeName?.charAt(0) || '?'}
                </span>
              )}
              <span>{node.assigneeName}</span>
              {node.reviewerName && (
                <>
                  <span className="text-[var(--muted)]">·</span>
                  <span>🔍</span>
                  {reviewerAvatar ? (
                    <CachedAvatar src={reviewerAvatar} alt="" className="w-4 h-4 rounded-full inline-block" />
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-600 to-pink-700 flex items-center justify-center text-[8px] shrink-0">
                      {node.reviewerName?.charAt(0) || '?'}
                    </span>
                  )}
                  <span>{node.reviewerName}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {node.reviewRounds > 0 && (
          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded shrink-0 ml-1">
            R{node.reviewRounds}
          </span>
        )}
        {node.completedAt && node.startedAt && (
          <span className="text-[10px] text-[var(--muted)] shrink-0 ml-1">
            {Math.round((new Date(node.completedAt) - new Date(node.startedAt)) / 1000)}s
          </span>
        )}
      </div>
      {node.description && (
        <p className="text-xs text-[var(--muted)] mt-1.5 line-clamp-2">{node.description}</p>
      )}
      {/* Live action hint */}
      {(node.status === 'running' || node.status === 'reviewing' || node.status === 'revision') && liveStatus?.currentNodeId === node.id && liveStatus.currentAction && (
        <div className={`mt-1.5 rounded-lg px-2 py-1 text-[10px] flex items-center gap-1 overflow-hidden ${
          node.status === 'reviewing' ? 'bg-purple-900/10 border border-purple-500/20 text-purple-300' :
          node.status === 'revision' ? 'bg-orange-900/10 border border-orange-500/20 text-orange-300' :
          'bg-yellow-900/10 border border-yellow-500/20 text-yellow-300'
        }`}>
          <span className="animate-spin text-xs shrink-0">{node.status === 'reviewing' ? '🔍' : node.status === 'revision' ? '✏️' : '⚙️'}</span>
          <span className="truncate">{liveStatus.currentAction}</span>
        </div>
      )}
      {/* Tool call progress */}
      {node.status === 'running' && liveStatus?.currentNodeId === node.id && liveStatus.toolCallsInProgress?.length > 0 && (
        <div className="mt-1 flex gap-1 flex-wrap">
          {liveStatus.toolCallsInProgress.slice(0, 3).map((tool, ti) => (
            <span key={ti} className="text-[10px] bg-purple-900/30 text-purple-400 px-1.5 py-0.5 rounded animate-pulse">
              🔧 {tool}
            </span>
          ))}
        </div>
      )}
    </>
    );
  };

  // Generate connection paths: multiple incoming edges merge into one vertical line
  const renderEdges = () => {
    const paths = [];
    const mergeGap = 25; // Distance from merge point to target node top

    Object.entries(edgeGroups).forEach(([targetId, fromIds]) => {
      const to = nodePositions[targetId];
      if (!to) return;

      const toCenterX = to.x + to.w / 2;
      const toTopY = to.y;
      const mergeY = toTopY - mergeGap; // Merge point Y coordinate

      // Determine edge status color
      const getEdgeStyle = (fromId) => {
        const fromNode = nodePositions[fromId]?.node;
        const toNode = to.node;
        const bothDone = fromNode?.status === 'completed' && toNode?.status === 'completed';
        const isActive = fromNode?.status === 'completed' && toNode?.status === 'running';
        return {
          color: bothDone ? '#22c55e' : isActive ? '#eab308' : '#4b5563',
          width: 1,
          isActive,
        };
      };

      if (fromIds.length === 1) {
        // Single incoming edge: direct Bezier curve connection
        const fromId = fromIds[0];
        const from = nodePositions[fromId];
        if (!from) return;
        const style = getEdgeStyle(fromId);
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h;
        const x2 = toCenterX;
        const y2 = toTopY;
        const cy = (y1 + y2) / 2;
        paths.push(
          <path
            key={`edge-${fromId}-${targetId}`}
            d={`M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`}
            fill="none"
            stroke={style.color}
            strokeWidth={style.width}
            strokeLinecap="round"
            markerEnd={`url(#arrow-${style.color.replace('#', '')})`}
            className={style.isActive ? 'edge-running' : ''}
          />
        );
      } else {
        // Multi-edge merge: all edges merge above target, then connect with one vertical line + arrow
        // Use unified color to avoid inconsistency when edges overlap
        const allStyles = fromIds.map(fid => getEdgeStyle(fid));
        const bestStyle = allStyles.find(s => s.isActive) || allStyles.find(s => s.color === '#22c55e') || allStyles[0];

        // 1. Merge vertical line: from mergeY to toTopY (unified color)
        paths.push(
          <path
            key={`merge-vert-${targetId}`}
            d={`M${toCenterX},${mergeY} L${toCenterX},${toTopY}`}
            fill="none"
            stroke={bestStyle.color}
            strokeWidth={bestStyle.width}
            strokeLinecap="round"
            markerEnd={`url(#arrow-${bestStyle.color.replace('#', '')})`}
            className={bestStyle.isActive ? 'edge-running' : ''}
          />
        );

        // 2. Each incoming edge uses same color to avoid inconsistency when overlapping
        // Sort incoming edges by X coordinate for clearer paths
        const sortedFromIds = [...fromIds].sort((a, b) => {
          const ax = nodePositions[a]?.x || 0;
          const bx = nodePositions[b]?.x || 0;
          return ax - bx;
        });

        sortedFromIds.forEach((fromId) => {
          const from = nodePositions[fromId];
          if (!from) return;
          const x1 = from.x + from.w / 2;
          const y1 = from.y + from.h;

          if (Math.abs(x1 - toCenterX) < 2) {
            // Nearly vertically aligned, direct vertical line to merge point
            paths.push(
              <path
                key={`edge-${fromId}-${targetId}`}
                d={`M${x1},${y1} L${x1},${mergeY}`}
                fill="none"
                stroke={bestStyle.color}
                strokeWidth={bestStyle.width}
                strokeLinecap="round"
                className={bestStyle.isActive ? 'edge-running' : ''}
              />
            );
          } else {
            // From source bottom, first go down vertically, then smooth turn horizontally to merge point
            const turnRadius = Math.min(15, Math.abs(x1 - toCenterX) / 2, (mergeY - y1) / 2);
            const dir = toCenterX > x1 ? 1 : -1;

            paths.push(
              <path
                key={`edge-${fromId}-${targetId}`}
                d={`M${x1},${y1} L${x1},${mergeY - turnRadius} Q${x1},${mergeY} ${x1 + dir * turnRadius},${mergeY} L${toCenterX},${mergeY}`}
                fill="none"
                stroke={bestStyle.color}
                strokeWidth={bestStyle.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={bestStyle.isActive ? 'edge-running' : ''}
              />
            );
          }
        });
      }
    });

    return paths;
  };

  return (
    <div className="p-6 space-y-4">
      {workflow.summary && (
        <div className="text-sm text-[var(--muted)] bg-white/5 rounded-lg p-3">
          💡 {workflow.summary}
        </div>
      )}

      <div ref={containerRef} className="w-full overflow-x-auto">
        <svg
          ref={svgRef}
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          className="select-none"
        >
          <defs>
            {/* Arrow markers (by color) */}
            {['4b5563', '22c55e', 'eab308', '3b82f6', 'ef4444'].map(hex => (
              <marker key={hex} id={`arrow-${hex}`} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M1,1 L9,5 L1,9" fill="none" stroke={`#${hex}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            ))}
            {/* Flow animation */}
            <style>{`
              @keyframes dash-flow { to { stroke-dashoffset: -20; } }
              .edge-running { stroke-dasharray: 8 4; animation: dash-flow 0.8s linear infinite; }
            `}</style>
          </defs>

          {/* Connections */}
          {renderEdges()}

          {/* Node cards (foreignObject embedded div) */}
          {Object.values(nodePositions).map(({ x, y, w, h, node }) => (
            <foreignObject key={node.id} x={x} y={y} width={w} height={h}>
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                className={`bg-[var(--background)] border ${statusColor[node.status]} rounded-xl p-3 h-full overflow-hidden transition-all cursor-default`}
                style={{ fontSize: '12px' }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredNode({ node, rect });
                }}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {renderCardContent(node)}
              </div>
            </foreignObject>
          ))}
        </svg>
      </div>

      {/* Hidden measurement container: render all cards to get actual heights */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          width: layout.nodeW,
          left: -9999,
          top: 0,
        }}
      >
        {nodes.map(node => (
          <div
            key={node.id}
            data-node-id={node.id}
            className={`bg-[var(--background)] border rounded-xl p-3`}
            style={{ fontSize: '12px', width: layout.nodeW }}
          >
            {renderCardContent(node)}
          </div>
        ))}
      </div>

      {/* Hover Tooltip - floating layer showing full task content */}
      {hoveredNode && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: hoveredNode.rect.left + hoveredNode.rect.width / 2,
            top: hoveredNode.rect.top - 8,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-3 shadow-xl text-xs max-w-xs">
            <div className="font-medium text-sm text-white mb-1">{hoveredNode.node.title}</div>
            <div className="text-[var(--muted)] mb-1">👤 {hoveredNode.node.assigneeName}</div>
            {hoveredNode.node.description && (
              <p className="text-[var(--muted)] whitespace-pre-wrap break-words">{hoveredNode.node.description}</p>
            )}
            {hoveredNode.node.completedAt && hoveredNode.node.startedAt && (
              <div className="mt-1 text-[var(--muted)]">{t('reqDetail.timeDuration', { n: Math.round((new Date(hoveredNode.node.completedAt) - new Date(hoveredNode.node.startedAt)) / 1000) })}</div>
            )}
            {(hoveredNode.node.status === 'running' || hoveredNode.node.status === 'reviewing' || hoveredNode.node.status === 'revision') && liveStatus?.currentNodeId === hoveredNode.node.id && liveStatus.currentAction && (
              <div className={`mt-1 ${hoveredNode.node.status === 'reviewing' ? 'text-purple-300' : hoveredNode.node.status === 'revision' ? 'text-orange-300' : 'text-yellow-300'}`}>{hoveredNode.node.status === 'reviewing' ? '🔍' : hoveredNode.node.status === 'revision' ? '✏️' : '⚙️'} {liveStatus.currentAction}</div>
            )}
            {/* Arrow triangle */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white/10" />
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * 心流偷看弹窗 — 从需求详情群员列表点🧠触发
 * 三个 Tab：工作日志（flow）、内心独白（thoughts）、历史心流（history）
 */
function FlowPeekModal({ agentId, agentName, loading, tab, onTabChange, flowMsgs, monologueData, monologueThoughtMsgs, history, onClose }) {
  const { t } = useI18n();
  const cleanContent = (content) => {
    if (!content) return '';
    return content.replace(/^```[\s\S]*?```$/gm, t('reqDetail.flowPeek.codeBlock')).slice(0, 500);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg mx-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-purple-900/20">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <span className="font-medium text-sm">{t('reqDetail.flowPeek.title', { name: agentName })}</span>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white transition-colors text-lg">✕</button>
        </div>

        <div className="flex border-b border-[var(--border)] px-4 bg-[var(--card)]">
          {[
            { id: 'thoughts', label: t('reqDetail.flowPeek.tabThoughts'), badge: monologueThoughtMsgs?.length || 0 },
            { id: 'flow', label: t('reqDetail.flowPeek.tabFlow'), badge: flowMsgs?.length || 0 },
            { id: 'history', label: t('reqDetail.flowPeek.tabHistory'), badge: history?.length || 0 },
          ].map(tb => (
            <button
              key={tb.id}
              onClick={() => onTabChange(tb.id)}
              className={`px-3 py-2 text-xs font-medium transition-all border-b-2 ${
                tab === tb.id
                  ? 'border-purple-500 text-purple-300'
                  : 'border-transparent text-[var(--muted)] hover:text-white'
              }`}
            >
              {tb.label}
              {tb.badge > 0 && (
                <span className="ml-1 text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{tb.badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin text-2xl">🧠</span>
              <span className="ml-2 text-sm text-[var(--muted)]">{t('reqDetail.flowPeek.loading')}</span>
            </div>
          ) : tab === 'flow' ? (
            !flowMsgs?.length ? (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                <div className="text-3xl mb-2">📋</div>
                <p>{t('reqDetail.flowPeek.noFlowLogs')}</p>
                <p className="text-xs mt-1">{t('reqDetail.flowPeek.noFlowLogsHint')}</p>
              </div>
            ) : (
              flowMsgs.map((msg, i) => (
                <div key={msg.id || i} className={`rounded-xl p-3 text-sm ${
                  msg.type === 'tool_call'
                    ? 'bg-purple-900/20 border border-purple-500/10'
                    : msg.type === 'output'
                    ? 'bg-green-900/20 border border-green-500/10'
                    : 'bg-white/5 border border-white/10'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[var(--muted)]">
                      {msg.type === 'tool_call' ? '🔧' : msg.type === 'output' ? '📄' : '💬'}{' '}
                      {msg.time ? new Date(msg.time).toLocaleTimeString() : ''}
                    </span>
                  </div>
                  <div className="text-sm break-words">{cleanContent(msg.content)}</div>
                </div>
              ))
            )
          ) : tab === 'thoughts' ? (
            monologueThoughtMsgs?.length > 0 ? (
              <div className="space-y-3">
                {/* 如果当前正在思考，显示状态提示 */}
                {monologueData?.status === 'thinking' && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 animate-pulse">
                      {t('reqDetail.flowPeek.thinking')}
                    </span>
                  </div>
                )}
                {monologueThoughtMsgs.slice().reverse().map((msg, i) => (
                  <div key={msg.id || i} className="bg-purple-900/20 border border-purple-500/10 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-purple-400">{t('systemSettings.monologue')}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {msg.time ? new Date(msg.time).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <div className="text-sm italic text-purple-200 whitespace-pre-wrap">
                      {cleanContent(msg.content)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">😴</div>
                <p className="text-sm text-[var(--muted)]">{t('reqDetail.flowPeek.noMonologue')}</p>
                <p className="text-xs text-[var(--muted)] mt-1">{t('systemSettings.noMonologueYet')}</p>
              </div>
            )
          ) : (
            !history?.length ? (
              <div className="text-center py-8 text-[var(--muted)] text-sm">{t('reqDetail.flowPeek.noHistory')}</div>
            ) : (
              history.slice().reverse().map((m, i) => (
                <div key={m.id || i} className="bg-white/5 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--muted)]">
                      {m.startedAt ? new Date(m.startedAt).toLocaleString() : ''}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.decision === 'spoke' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {m.decision === 'spoke' ? t('reqDetail.flowPeek.spoke') : t('reqDetail.flowPeek.keptSilent')}
                    </span>
                  </div>
                  {m.thoughts?.map((thought, ti) => (
                    <div key={thought.id || ti} className="text-sm text-[var(--muted)] bg-black/20 rounded-lg p-2">
                      {thought.content?.startsWith('[')
                        ? <span className="text-green-400">{thought.content}</span>
                        : <span className="italic">{thought.content}</span>
                      }
                    </div>
                  ))}
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * 群员列表 + 流程卡点面板
 * 展示参与此需求的所有 agent，以及当前流程卡在谁身上
 */
function MembersAndBlockingPanel({ members, blockingInfo, workflow, status, onPeekFlow, onViewAgent }) {
  const { t } = useI18n();
  if (!members?.length && !blockingInfo?.length) return null;

  const nodeStatusConfig = {
    running: { label: t('reqDetail.members.running'), color: 'text-yellow-400', bg: 'bg-yellow-900/20', icon: '⚡' },
    reviewing: { label: t('reqDetail.members.reviewing'), color: 'text-blue-400', bg: 'bg-blue-900/20', icon: '🔍' },
    revision: { label: t('reqDetail.members.revision'), color: 'text-orange-400', bg: 'bg-orange-900/20', icon: '🔄' },
    waiting: { label: t('reqDetail.members.waiting'), color: 'text-gray-400', bg: 'bg-gray-900/20', icon: '⏳' },
    ready: { label: t('reqDetail.members.ready'), color: 'text-cyan-400', bg: 'bg-cyan-900/20', icon: '🟢' },
    completed: { label: t('reqDetail.members.completed'), color: 'text-green-400', bg: 'bg-green-900/20', icon: '✅' },
    failed: { label: t('reqDetail.members.failed'), color: 'text-red-400', bg: 'bg-red-900/20', icon: '❌' },
  };

  // 统计每个 agent 在此需求中的任务状态
  const agentTaskMap = {};
  if (workflow?.nodes) {
    for (const node of workflow.nodes) {
      if (node.assigneeId) {
        if (!agentTaskMap[node.assigneeId]) agentTaskMap[node.assigneeId] = [];
        agentTaskMap[node.assigneeId].push({ title: node.title, status: node.status });
      }
    }
  }

  return (
    <div className="px-6 py-3 border-b border-white/[0.06] bg-[var(--card)]">
      {/* 流程卡点 */}
      {blockingInfo?.length > 0 && status === 'in_progress' && (
        <div className="mb-3">
          <div className="text-xs text-[var(--muted)] mb-1.5 font-medium">{t('reqDetail.members.blockingTitle')}</div>
          <div className="flex flex-wrap gap-2">
            {blockingInfo.map((b, i) => {
              const st = nodeStatusConfig[b.status] || nodeStatusConfig.running;
              return (
                <div key={b.nodeId || i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${st.bg} border-white/10`}>
                  <span className="text-sm">{st.icon}</span>
                  <div>
                    <div className="text-xs font-medium">{b.nodeTitle}</div>
                    <div className="text-[10px] text-[var(--muted)]">
                      👤 {b.assigneeName}
                      {b.status === 'reviewing' && b.reviewerName && (
                        <span className="ml-1">→ 🔍 {b.reviewerName}</span>
                      )}
                      <span className={`ml-1 ${st.color}`}>{st.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 群员列表 */}
      {members?.length > 0 && (
        <div>
          <div className="text-xs text-[var(--muted)] mb-1.5 font-medium">{t('reqDetail.members.title')} {t('reqDetail.members.count', { n: members.length })}</div>
          <div className="flex flex-wrap gap-2">
            {members.map(m => {
              const tasks = agentTaskMap[m.id] || [];
              const activeTasks = tasks.filter(t => ['running', 'reviewing', 'revision'].includes(t.status));
              const isActive = activeTasks.length > 0;
              const completedCount = tasks.filter(t => t.status === 'completed').length;
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                    isActive
                      ? 'bg-yellow-900/10 border-yellow-500/20'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                  }`}
                  title={tasks.length > 0 ? t('reqDetail.members.taskTooltip', { tasks: tasks.map(task => `${task.title}(${task.status})`).join(', ') }) : t('reqDetail.members.noTask')}
                >
                  {/* 头像区域：上方🧠偷看心流，点击头像看卡片 */}
                  <div className="relative group/avatar flex flex-col items-center">
                    {/* 🧠 偷看心流按钮 — 悬浮头像时显示在上方 */}
                    {onPeekFlow && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onPeekFlow(m.id); }}
                        className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-hover/avatar:opacity-100 transition-all duration-200 text-[11px] hover:scale-125 z-10"
                        title={t('reqDetail.members.peekFlow')}
                      >
                        🧠
                      </button>
                    )}
                    {/* 头像 — 点击看卡片 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewAgent?.(m.id); }}
                      className="focus:outline-none hover:ring-2 hover:ring-purple-500/50 rounded-full transition-all"
                      title={t('reqDetail.members.viewProfile')}
                    >
                      {m.avatar ? (
                        <CachedAvatar src={m.avatar} alt="" className="w-7 h-7 rounded-full cursor-pointer" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-[10px] cursor-pointer">
                          {m.name?.charAt(0) || '?'}
                        </div>
                      )}
                    </button>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{m.name}</div>
                    <div className="text-[10px] text-[var(--muted)] truncate">
                      {m.role}
                      {isActive && (
                        <span className="ml-1 text-yellow-400 animate-pulse">{t('reqDetail.members.working')}</span>
                      )}
                      {!isActive && completedCount > 0 && (
                        <span className="ml-1 text-green-400">✅{completedCount}</span>
                      )}
                      {tasks.length === 0 && (
                        <span className="ml-1 text-gray-500">{t('reqDetail.members.noTask')}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Live progress panel - shows current execution status, heartbeat, stuck detection
 */
function LiveStatusPanel({ liveStatus, requirementId, requirementStatus, onRestart, onDelete }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [operating, setOperating] = useState(false);

  // Update every second, calculate heartbeat interval
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const heartbeatAge = liveStatus.heartbeat
    ? Math.round((now - new Date(liveStatus.heartbeat).getTime()) / 1000)
    : null;

  const lastActiveAge = liveStatus.lastActiveAt
    ? Math.round((now - new Date(liveStatus.lastActiveAt).getTime()) / 1000)
    : null;

  // Check if possibly stuck: no heartbeat for >60s
  const maybeStuck = heartbeatAge !== null && heartbeatAge > 60;
  // Long inactivity: >120s
  const definitelyStuck = heartbeatAge !== null && heartbeatAge > 120;

  return (
    <div className={`mx-6 mt-4 rounded-xl border p-3 text-sm ${
      definitelyStuck
        ? 'bg-red-900/10 border-red-500/30'
        : maybeStuck
        ? 'bg-orange-900/10 border-orange-500/30'
        : 'bg-[var(--accent)]/5 border-[var(--accent)]/20'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {definitelyStuck ? (
            <span className="text-red-400 text-lg">⚠️</span>
          ) : maybeStuck ? (
            <span className="text-orange-400 text-lg animate-pulse">⏳</span>
          ) : (
            <span className="text-green-400 text-lg animate-pulse">⚡</span>
          )}
          <div>
            <div className="font-medium text-xs">
              {definitelyStuck
                ? t('reqDetail.live.stuck')
                : maybeStuck
                ? t('reqDetail.live.waiting')
                : t('reqDetail.live.running')}
            </div>
            {liveStatus.currentAction && (
              <div className="text-xs text-[var(--muted)] mt-0.5 truncate max-w-md">
                {liveStatus.currentAction}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-[10px] text-[var(--muted)] shrink-0">
          {liveStatus.currentAgent && (
            <span>👤 {liveStatus.currentAgent}</span>
          )}
          {liveStatus.currentNodeTitle && (
            <span>📋 {liveStatus.currentNodeTitle}</span>
          )}
          {heartbeatAge !== null && (
            <span className={`${
              definitelyStuck ? 'text-red-400' : maybeStuck ? 'text-orange-400' : 'text-green-400'
            }`}>
              💓 {heartbeatAge < 60 ? t('reqDetail.live.secondsAgo', { n: heartbeatAge }) : t('reqDetail.live.minutesAgo', { n: Math.round(heartbeatAge / 60) })}
            </span>
          )}
          {/* Tool calling in progress */}
          {liveStatus.toolCallsInProgress?.length > 0 && (
            <span className="text-purple-400 animate-pulse">
              🔧 {liveStatus.toolCallsInProgress.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons — always available */}
      {onRestart && onDelete && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2">
          <button
            onClick={async () => {
              setOperating(true);
              try { await onRestart(); } finally { setOperating(false); }
            }}
            disabled={operating}
            className="text-[11px] px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {operating ? t('reqDetail.live.restarting') :  t('reqDetail.live.restart')}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={operating}
              className="text-[11px] px-3 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {t('reqDetail.live.deleteReq')}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red-400">{t('reqDetail.live.confirmDelete')}</span>
              <button
                onClick={async () => {
                  setOperating(true);
                  try { await onDelete(); } finally { setOperating(false); setConfirmDelete(false); }
                }}
                disabled={operating}
                className="text-[10px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[var(--muted)] transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Recent file changes quick preview */}
      {liveStatus.recentFileChanges?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] text-[var(--muted)] shrink-0">{t('reqDetail.live.recentFiles')}</span>
          {liveStatus.recentFileChanges.slice(-5).map((fc, i) => (
            <span key={i} className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-blue-300 shrink-0">
              📝 {fc.filePath?.split('/').pop() || fc.filePath}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

