'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

/**
 * Clean message content: filter out leaked LLM internal tags (e.g. DeepSeek DSML tool call format)
 */
function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content;
}import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamic import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// Custom Monaco theme - consistent with page color scheme
// VSCode Dark+ theme colors
const CUSTOM_THEME_NAME = 'vscode-dark-plus';
const defineCustomTheme = (monaco) => {
  monaco.editor.defineTheme(CUSTOM_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd4d4d4', background: '1e1e1e' },
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'keyword.control', foreground: 'c586c0' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'string.escape', foreground: 'd7ba7d' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'variable.predefined', foreground: '4fc1ff' },
      { token: 'constant', foreground: '4fc1ff' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'delimiter.bracket', foreground: 'ffd700' },
      { token: 'tag', foreground: '569cd6' },
      { token: 'tag.id.pug', foreground: '4ec9b0' },
      { token: 'attribute.name', foreground: '9cdcfe' },
      { token: 'attribute.value', foreground: 'ce9178' },
      { token: 'string.key.json', foreground: '9cdcfe' },
      { token: 'string.value.json', foreground: 'ce9178' },
      { token: 'metatag', foreground: 'ce9178' },
      { token: 'metatag.content.html', foreground: 'ce9178' },
      { token: 'regexp', foreground: 'd16969' },
      { token: 'annotation', foreground: 'dcdcaa' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'function.declaration', foreground: 'dcdcaa' },
      { token: 'operator', foreground: 'd4d4d4' },
      { token: 'namespace', foreground: '4ec9b0' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
      'editorCursor.foreground': '#aeafad',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorIndentGuide.background': '#404040',
      'editorIndentGuide.activeBackground': '#707070',
      'editor.selectionHighlightBackground': '#add6ff26',
      'editorBracketMatch.background': '#0064001a',
      'editorBracketMatch.border': '#888888',
      'editorGutter.background': '#1e1e1e',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#454545',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#454545',
      'editorSuggestWidget.selectedBackground': '#04395e',
      'input.background': '#3c3c3c',
      'input.border': '#3c3c3c',
      'scrollbar.shadow': '#000000',
      'scrollbarSlider.background': '#79797966',
      'scrollbarSlider.hoverBackground': '#646464b3',
      'scrollbarSlider.activeBackground': '#bfbfbf66',
      'minimap.background': '#1e1e1e',
      'minimapSlider.background': '#79797933',
      'minimapSlider.hoverBackground': '#64646459',
    }
  });
};

/**
 * Requirement detail page
 * Displays: requirement info, workflow DAG, group chat messages, output results
 */
export default function RequirementDetail({ requirementId, onClose }) {
  const { t } = useI18n();
  const { fetchRequirementDetail, requirementDetail, clearRequirementDetail, fetchWorkspaceFile, navigateBack, activeRequirementId, deleteRequirement, restartRequirement } = useStore();
  const reqId = requirementId || activeRequirementId;
  const isPage = !onClose; // If no onClose is passed, it is standalone page mode
  const [activeTab, setActiveTab] = useState('workflow'); // workflow | chat | outputs | files
  const chatEndRef = useRef(null);
  const pollRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null); // { path, content, loading }

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
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/[0.06] shrink-0 px-6 bg-[var(--card)]">
          {[
            { id: 'workflow', label: t('reqDetail.tabs.workflow'), badge: req.workflow?.nodes?.length },
            { id: 'chat', label: t('reqDetail.tabs.chat'), badge: req.groupChat?.length },
            { id: 'outputs', label: t('reqDetail.tabs.outputs'), badge: req.outputs?.length },
            { id: 'files', label: t('reqDetail.tabs.files'), badge: req.liveStatus?.recentFileChanges?.length || 0 },
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

        {/* Content area - full screen */}
        <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' ? 'overflow-hidden' : 'overflow-auto'}`}>
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
              <WorkflowView workflow={req.workflow} liveStatus={req.liveStatus} />
            </>
          )}
          {activeTab === 'chat' && <ChatView groupChat={req.groupChat || []} chatEndRef={chatEndRef} />}
          {activeTab === 'outputs' && <OutputsView outputs={req.outputs || []} />}
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
        </div>
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

        {/* Tab bar */}
        <div className="flex border-b border-white/[0.06] shrink-0 px-6">
          {[
            { id: 'workflow', label: t('reqDetail.tabs.workflow'), badge: req.workflow?.nodes?.length },
            { id: 'chat', label: t('reqDetail.tabs.chat'), badge: req.groupChat?.length },
            { id: 'outputs', label: t('reqDetail.tabs.outputs'), badge: req.outputs?.length },
            { id: 'files', label: t('reqDetail.tabs.files'), badge: req.liveStatus?.recentFileChanges?.length || 0 },
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
        <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' ? 'overflow-hidden' : 'overflow-auto'}`} style={{ minHeight: activeTab === 'files' ? '400px' : undefined }}>
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
              <WorkflowView workflow={req.workflow} liveStatus={req.liveStatus} />
            </>
          )}
          {activeTab === 'chat' && <ChatView groupChat={req.groupChat || []} chatEndRef={chatEndRef} />}
          {activeTab === 'outputs' && <OutputsView outputs={req.outputs || []} />}
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
        </div>
      </div>
    </div>
  );
}


/**
 * Workflow visualization - SVG flowchart + div cards (foreignObject)
 * Multi-arrow merging: multiple incoming edges merge into one vertical line then connect to target
 */
function WorkflowView({ workflow, liveStatus }) {
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

  if (!workflow?.nodes?.length) {
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
    waiting: '⏳', ready: '🔵', running: '🔄', completed: '✅', failed: '❌',
  };
  const statusBorderColor = {
    waiting: '#4b5563', ready: '#3b82f6', running: '#eab308', completed: '#22c55e', failed: '#ef4444',
  };
  const statusColor = {
    waiting: 'border-gray-600',
    ready: 'border-blue-500',
    running: 'border-yellow-500 animate-pulse',
    completed: 'border-green-500',
    failed: 'border-red-500',
  };

  // Card content render function (shared by measurement container and actual render)
  const renderCardContent = (node) => (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{statusIcon[node.status]}</span>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{node.title}</div>
            <div className="text-xs text-[var(--muted)]">👤 {node.assigneeName}</div>
          </div>
        </div>
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
      {node.status === 'running' && liveStatus?.currentNodeId === node.id && liveStatus.currentAction && (
        <div className="mt-1.5 bg-yellow-900/10 border border-yellow-500/20 rounded-lg px-2 py-1 text-[10px] text-yellow-300 flex items-center gap-1 overflow-hidden">
          <span className="animate-spin text-xs shrink-0">⚙️</span>
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
          width: 2,
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
                <path d="M1,1 L9,5 L1,9" fill="none" stroke={`#${hex}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                className={`bg-[var(--background)] border-2 ${statusColor[node.status]} rounded-xl p-3 h-full overflow-hidden transition-all cursor-default`}
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
            className={`bg-[var(--background)] border-2 rounded-xl p-3`}
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
            {hoveredNode.node.status === 'running' && liveStatus?.currentNodeId === hoveredNode.node.id && liveStatus.currentAction && (
              <div className="mt-1 text-yellow-300">⚙️ {liveStatus.currentAction}</div>
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
 * Group chat view
 */
function ChatView({ groupChat, chatEndRef }) {
  const { t } = useI18n();
  if (groupChat.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">💬</div>
          <p>{t('reqDetail.chat.noMessages')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {groupChat.map((msg) => {
        const isSystem = msg.type === 'system';

        if (isSystem) {
          return (
            <div key={msg.id} className="text-center">
              <span className="text-[10px] text-[var(--muted)] bg-white/5 px-3 py-1 rounded-full">
                {msg.content}
              </span>
            </div>
          );
        }

        return (
          <div key={msg.id} className="flex gap-2">
            {msg.from.avatar ? (
              <img src={msg.from.avatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 mt-0.5" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-xs shrink-0 mt-0.5">
                🤖
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium">{msg.from.name}</span>
                {msg.from.role && (
                  <span className="text-[10px] text-[var(--muted)] bg-white/5 px-1 py-0.5 rounded">{msg.from.role}</span>
                )}
                <span className="text-[10px] text-[var(--muted)]">
                  {new Date(msg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <div className={`rounded-2xl rounded-tl-sm px-3 py-2 text-sm inline-block max-w-[85%] ${
                msg.type === 'output'
                  ? 'bg-green-900/20 border border-green-500/20'
                  : msg.type === 'tool_call'
                  ? 'bg-purple-900/20 border border-purple-500/20'
                  : 'bg-[var(--background)] border border-[var(--border)]'
              }`}>
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{cleanMessageContent(msg.content)}</div>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={chatEndRef} />
    </div>
  );
}


/**
 * Outputs view
 */
function OutputsView({ outputs }) {
  const { t } = useI18n();
  const [expandedId, setExpandedId] = useState(null);

  if (outputs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📦</div>
          <p>{t('reqDetail.outputs.noOutputsShort')}</p>
        </div>
      </div>
    );
  }

  const typeIcon = {
    text: '📝',
    code: '💻',
    image: '🖼️',
    file: '📁',
  };

  return (
    <div className="p-4 space-y-3">
      {outputs.map((output) => {
        const isExpanded = expandedId === output.id;

        return (
          <div
            key={output.id}
            className="bg-[var(--background)] border border-[var(--border)] rounded-xl overflow-hidden"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : output.id)}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{typeIcon[output.outputType] || '📄'}</span>
                <div>
                  <div className="text-sm font-medium">{output.agentName}</div>
                  <div className="text-xs text-[var(--muted)]">{output.role}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  output.outputType === 'code' ? 'bg-purple-900/30 text-purple-400' :
                  output.outputType === 'image' ? 'bg-pink-900/30 text-pink-400' :
                  'bg-blue-900/30 text-blue-400'
                }`}>
                  {output.outputType}
                </span>
                <span className="text-[var(--muted)] text-xs">{isExpanded ? t('reqDetail.outputs.collapse') : t('reqDetail.outputs.expand')}</span>
              </div>
            </div>

            {/* Content */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-white/[0.06]">
                {output.outputType === 'code' ? (
                  <pre className="mt-3 bg-black/30 rounded-lg p-4 overflow-auto text-xs font-mono text-green-300 max-h-96 leading-relaxed">
                    {output.content}
                  </pre>
                ) : output.outputType === 'image' && output.content?.startsWith('http') ? (
                  <div className="mt-3">
                    <img src={output.content} alt="output image" className="max-w-full rounded-lg" />
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">
                    {output.content}
                  </div>
                )}
                {output.metadata?.toolResults?.length > 0 && (
                  <div className="mt-3 flex gap-1 flex-wrap">
                    {output.metadata.toolResults.map((t, i) => (
                      <span key={i} className="text-[10px] bg-purple-900/20 text-purple-400 px-1.5 py-0.5 rounded">
                        🔧 {t.tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
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

      {/* Show action buttons when stuck */}
      {(maybeStuck || definitelyStuck || requirementStatus === 'failed') && onRestart && onDelete && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2">
          <button
            onClick={async () => {
              setOperating(true);
              try { await onRestart(); } finally { setOperating(false); }
            }}
            disabled={operating}
            className="text-[11px] px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {operating ? t('reqDetail.live.restarting') : t('reqDetail.live.restart')}
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


/**
 * File changes view - VSCode style left-right layout
 * Left: file explorer (tree structure)
 * Right: Monaco Editor code preview
 */
function FilesView({ fileChanges, departmentId, previewFile, onPreview, onClosePreview }) {
  const { t } = useI18n();
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const [openTabs, setOpenTabs] = useState([]); // Open tabs [{path, name}]
  const [collapsedDirs, setCollapsedDirs] = useState(new Set());
  const resizeRef = useRef(null);

  // Deduplicate by file path, keep latest only
  const uniqueFiles = useMemo(() => {
    const files = [];
    const seen = new Set();
    for (let i = fileChanges.length - 1; i >= 0; i--) {
      const fc = fileChanges[i];
      if (!seen.has(fc.filePath)) {
        seen.add(fc.filePath);
        files.unshift(fc);
      }
    }
    return files;
  }, [fileChanges]);

  // Build file tree structure
  const fileTree = useMemo(() => {
    const tree = {};
    uniqueFiles.forEach(fc => {
      const parts = fc.filePath?.split('/').filter(Boolean) || [];
      let node = tree;
      parts.forEach((part, idx) => {
        if (idx === parts.length - 1) {
          // File node
          node[part] = { __isFile: true, __data: fc, __path: fc.filePath };
        } else {
          // Directory node
          if (!node[part] || node[part].__isFile) {
            node[part] = {};
          }
          node = node[part];
        }
      });
    });
    return tree;
  }, [uniqueFiles]);

  // Drag to resize sidebar width
  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e) => {
      const container = resizeRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(180, Math.min(500, e.clientX - rect.left));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Click file: open tab + preview
  const handleFileClick = (filePath) => {
    const name = filePath?.split('/').pop() || filePath;
    if (!openTabs.find(t => t.path === filePath)) {
      setOpenTabs(prev => [...prev, { path: filePath, name }]);
    }
    onPreview(filePath);
  };

  // Close tab
  const handleCloseTab = (e, tabPath) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t.path !== tabPath));
    if (previewFile?.path === tabPath) {
      // If closing the current preview, switch to nearest tab or close preview
      const remaining = openTabs.filter(t => t.path !== tabPath);
      if (remaining.length > 0) {
        onPreview(remaining[remaining.length - 1].path);
      } else {
        onClosePreview();
      }
    }
  };

  // Toggle directory collapse
  const toggleDir = (dirPath) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  // Get language by file extension
  const getLanguage = (path) => {
    const ext = path?.split('.').pop()?.toLowerCase();
    const langMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', json: 'json', md: 'markdown', css: 'css', scss: 'scss',
      html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml', sh: 'shell',
      sql: 'sql', java: 'java', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
      txt: 'plaintext',
    };
    return langMap[ext] || 'plaintext';
  };

  // Get file icon by extension
  const getFileIcon = (name) => {
    const ext = name?.split('.').pop()?.toLowerCase();
    const iconMap = {
      js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️', py: '🐍', json: '📋',
      md: '📝', css: '🎨', html: '🌐', yaml: '⚙️', yml: '⚙️', txt: '📄',
      sh: '🖥️', sql: '🗃️',
    };
    return iconMap[ext] || '📄';
  };

  // Empty state
  if (fileChanges.length === 0 && !previewFile) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📁</div>
          <p>{t('reqDetail.files.noChanges')}</p>
          <p className="text-xs mt-1">{t('reqDetail.files.noChangesHint')}</p>
        </div>
      </div>
    );
  }

  // Render file tree node
  const renderTreeNode = (node, name, path, depth = 0) => {
    if (node.__isFile) {
      const isActive = previewFile?.path === node.__path;
      return (
        <div
          key={path}
          className={`flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-xs transition-colors group ${
            isActive
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'text-[var(--foreground)]/80 hover:bg-white/[0.06]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => handleFileClick(node.__path)}
          title={node.__path}
        >
          <span className="text-[11px] shrink-0">{getFileIcon(name)}</span>
          <span className="truncate">{name}</span>
          {node.__data?.agentName && (
            <span className="ml-auto text-[10px] text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {node.__data.agentName}
            </span>
          )}
        </div>
      );
    }

    // Directory node
    const dirPath = path;
    const isCollapsed = collapsedDirs.has(dirPath);
    const entries = Object.entries(node).filter(([k]) => !k.startsWith('__'));
    // Directories first
    const dirs = entries.filter(([, v]) => !v.__isFile).sort(([a], [b]) => a.localeCompare(b));
    const files = entries.filter(([, v]) => v.__isFile).sort(([a], [b]) => a.localeCompare(b));
    const sorted = [...dirs, ...files];

    return (
      <div key={path}>
        <div
          className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-xs text-[var(--foreground)]/80 hover:bg-white/[0.06] transition-colors"
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => toggleDir(dirPath)}
        >
          <span className="text-[10px] text-[var(--muted)] w-3 text-center shrink-0">
            {isCollapsed ? '▶' : '▼'}
          </span>
          <span className="text-[11px] shrink-0">📁</span>
          <span className="truncate font-medium">{name}</span>
          <span className="ml-auto text-[10px] text-[var(--muted)]">{entries.length}</span>
        </div>
        {!isCollapsed && sorted.map(([childName, childNode]) =>
          renderTreeNode(childNode, childName, `${path}/${childName}`, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-[400px] overflow-hidden">
      {/* Left: file explorer */}
      <div
        className="shrink-0 border-r border-[var(--border)] bg-[var(--card)] flex flex-col"
        style={{ width: sidebarWidth }}
      >
        {/* Sidebar title */}
        <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase border-b border-[var(--border)] flex items-center justify-between">
          <span>{t('reqDetail.files.explorer')}</span>
          <span className="text-[10px] normal-case font-normal bg-white/10 px-1.5 py-0.5 rounded">
            {t('reqDetail.files.fileCount', { n: uniqueFiles.length })}
          </span>
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-auto py-1 select-none">
          {Object.entries(fileTree).sort(([a, av], [b, bv]) => {
            // Directories first
            const aDir = !av.__isFile;
            const bDir = !bv.__isFile;
            if (aDir && !bDir) return -1;
            if (!aDir && bDir) return 1;
            return a.localeCompare(b);
          }).map(([name, node]) =>
            renderTreeNode(node, name, name, 0)
          )}
        </div>

        {/* Sidebar bottom status */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--muted)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>{t('reqDetail.files.syncing')}</span>
        </div>
      </div>

      {/* Drag resize handle */}
      <div
        ref={resizeRef}
        className={`w-[3px] cursor-col-resize hover:bg-[var(--accent)]/40 transition-colors shrink-0 ${
          isResizing ? 'bg-[var(--accent)]/50' : 'bg-transparent'
        }`}
        onMouseDown={() => setIsResizing(true)}
      />

      {/* Right: editor area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--background)]">
        {/* Open tabs */}
        {openTabs.length > 0 && (
          <div className="flex border-b border-[var(--border)] bg-[var(--card)] overflow-x-auto shrink-0">
            {openTabs.map(tab => {
              const isActive = previewFile?.path === tab.path;
              return (
                <div
                  key={tab.path}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--border)] min-w-0 group transition-colors ${
                    isActive
                      ? 'bg-[var(--background)] text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'
                  }`}
                  onClick={() => onPreview(tab.path)}
                >
                  <span className="text-[11px] shrink-0">{getFileIcon(tab.name)}</span>
                  <span className="truncate max-w-[120px]">{tab.name}</span>
                  {previewFile?.loading && isActive && (
                    <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
                  )}
                  <button
                    onClick={(e) => handleCloseTab(e, tab.path)}
                    className="ml-1 text-[var(--muted)] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[10px] w-4 h-4 flex items-center justify-center rounded hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Editor body */}
        {previewFile ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Breadcrumb path bar */}
            <div className="flex items-center justify-between px-3 py-1 bg-[var(--card)] border-b border-[var(--border)] text-[10px] text-[var(--muted)]">
              <div className="flex items-center gap-1 truncate">
                {previewFile.path?.split('/').filter(Boolean).map((seg, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[var(--muted)]/50">›</span>}
                    <span className={i === arr.length - 1 ? 'text-[var(--foreground)]' : ''}>{seg}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewFile.loading && (
                  <span className="text-yellow-400 animate-pulse">{t('reqDetail.files.syncingShort')}</span>
                )}
                <button
                  onClick={() => onPreview(previewFile.path)}
                  className="text-[var(--muted)] hover:text-white transition-colors px-1"
                  title={t('common.refresh')}
                >
                  ↻
                </button>
              </div>
            </div>

            {/* Monaco editor */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {previewFile.loading ? (
                <div className="flex items-center justify-center h-full text-[var(--muted)] animate-pulse">
                  <div className="text-center">
                    <div className="text-2xl mb-2">⏳</div>
                    <p className="text-sm">{t('common.loading')}</p>
                  </div>
                </div>
              ) : (
                <MonacoEditor
                  height="100%"
                  language={getLanguage(previewFile.path)}
                  value={previewFile.content || t('reqDetail.files.emptyFile')}
                  theme={CUSTOM_THEME_NAME}
                  beforeMount={defineCustomTheme}
                  options={{
                    readOnly: true,
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    renderWhitespace: 'selection',
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    padding: { top: 8 },
                    scrollbar: {
                      verticalScrollbarSize: 8,
                      horizontalScrollbarSize: 8,
                    },
                  }}
                />
              )}
            </div>

            {/* Bottom status bar */}
            <div className="flex items-center justify-between px-3 py-1 bg-[var(--card)] border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
              <div className="flex items-center gap-3">
                <span>{getLanguage(previewFile.path).toUpperCase()}</span>
                <span>UTF-8</span>
                {previewFile.content && (
                  <span>{previewFile.content.split('\n').length} {t('reqDetail.files.lines', { n: '' }).trim()}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>{t('reqDetail.files.readOnly')}</span>
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              </div>
            </div>
          </div>
        ) : (
          /* Empty state - welcome page */
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <div className="text-6xl mb-4 opacity-20">{ }</div>
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <span className="text-3xl opacity-40">📝</span>
              </div>
              <p className="text-sm">{t('reqDetail.files.clickToView')}</p>
              <p className="text-[10px] mt-1 text-[var(--muted)]/60">{t('reqDetail.files.syntaxHighlight')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
