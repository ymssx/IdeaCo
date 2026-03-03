'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/client-store';

/**
 * 清理消息内容：过滤掉LLM泄漏的内部标签（如DeepSeek的DSML工具调用格式）
 */
function cleanMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  let cleaned = content.replace(/<[｜|]DSML[｜|][^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|DSML\|[^>]*>[\s\S]*/g, '').trim();
  cleaned = cleaned.replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '').trim();
  return cleaned || content;
}import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// 动态导入 Monaco Editor，避免 SSR 问题
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// 自定义 Monaco 主题 - 与页面配色保持一致
// VSCode Dark+ 主题配色
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
 * 需求详情页
 * 展示：需求信息、工作流DAG、群聊消息、产出结果
 */
export default function RequirementDetail({ requirementId, onClose }) {
  const { fetchRequirementDetail, requirementDetail, clearRequirementDetail, fetchWorkspaceFile, navigateBack, activeRequirementId, deleteRequirement, restartRequirement } = useStore();
  const reqId = requirementId || activeRequirementId;
  const isPage = !onClose; // 如果没有传 onClose，则为独立页面模式
  const [activeTab, setActiveTab] = useState('workflow'); // workflow | chat | outputs | files
  const chatEndRef = useRef(null);
  const pollRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null); // { path, content, loading }

  // 保存 reqId 到 ref，避免 closure 中读到 stale 值
  const reqIdRef = useRef(reqId);
  reqIdRef.current = reqId;

  useEffect(() => {
    if (!reqId) return;
    fetchRequirementDetail(reqId);
    // 执行中的需求加快轮询（2秒）
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

  // 组件卸载时清除所有状态
  useEffect(() => {
    return () => {
      clearRequirementDetail();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // 停止轮询已完成的需求，或减慢轮询频率
  useEffect(() => {
    if (requirementDetail && (requirementDetail.status === 'completed' || requirementDetail.status === 'failed')) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        // 完成后降为10秒轮询（保持更新但不占太多资源）
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

  // 文件预览加载
  const loadFilePreview = useCallback(async (filePath) => {
    if (!requirementDetail?.departmentId) return;
    setPreviewFile({ path: filePath, content: null, loading: true });
    try {
      const content = await fetchWorkspaceFile(requirementDetail.departmentId, filePath);
      setPreviewFile({ path: filePath, content: content?.content || content || '(无内容)', loading: false });
    } catch {
      setPreviewFile({ path: filePath, content: '(读取失败)', loading: false });
    }
  }, [requirementDetail?.departmentId]);

  const handleClose = onClose || navigateBack;

  if (!requirementDetail) {
    return isPage ? (
      <div className="flex items-center justify-center h-full">
        <div className="card p-8">
          <span className="animate-pulse text-[var(--muted)]">加载中...</span>
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0">
        <div className="card p-8">
          <span className="animate-pulse text-[var(--muted)]">加载中...</span>
        </div>
      </div>
    );
  }

  const req = requirementDetail;
  const statusConfig = {
    pending: { label: '待处理', color: 'text-gray-400', bg: 'bg-gray-900/30' },
    planning: { label: '规划中', color: 'text-blue-400', bg: 'bg-blue-900/30' },
    in_progress: { label: '执行中', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
    completed: { label: '已完成', color: 'text-green-400', bg: 'bg-green-900/30' },
    failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-900/30' },
  };
  const st = statusConfig[req.status] || statusConfig.pending;

  // 页面模式：全屏独立页面
  if (isPage) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {/* 头部导航栏 */}
        <div className="px-6 py-4 border-b border-white/[0.06] bg-[var(--card)] flex items-start justify-between shrink-0">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button
              onClick={handleClose}
              className="text-[var(--muted)] hover:text-white text-sm flex items-center gap-1 shrink-0 transition-colors hover:bg-white/5 px-2 py-1 rounded-lg"
            >
              ← 返回
            </button>
            <div className="w-px h-8 bg-white/[0.08]" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold truncate">{req.title}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                  {st.label}
                </span>
                {req.status === 'in_progress' && (
                  <span className="animate-pulse text-yellow-400 text-xs">⚙️ 执行中</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-[var(--muted)]">
                <span>🏢 {req.departmentName}</span>
                <span>📅 {new Date(req.createdAt).toLocaleString('zh')}</span>
                <span className="truncate max-w-md">{req.description}</span>
                {req.summary && (
                  <>
                    <span>✅ {req.summary.successTasks}/{req.summary.totalTasks} 任务</span>
                    <span>⏱️ {Math.round((req.summary.totalDuration || 0) / 1000)}秒</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tab栏 */}
        <div className="flex border-b border-white/[0.06] shrink-0 px-6 bg-[var(--card)]">
          {[
            { id: 'workflow', label: '📊 工作流', badge: req.workflow?.nodes?.length },
            { id: 'chat', label: '💬 群聊', badge: req.groupChat?.length },
            { id: 'outputs', label: '📦 产出', badge: req.outputs?.length },
            { id: 'files', label: '📁 文件', badge: req.liveStatus?.recentFileChanges?.length || 0 },
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

        {/* 内容区 - 全屏 */}
        <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {activeTab === 'workflow' && (
            <>
              {/* 实时进度面板（仅在工作流tab下展示） */}
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

  // 弹窗模式（兼容旧的调用方式，但实际已不用）
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center !m-0" onClick={handleClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-5xl w-full mx-4 max-h-[90vh] min-h-[60vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-start justify-between shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold truncate">{req.title}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                {st.label}
              </span>
              {req.status === 'in_progress' && (
                <span className="animate-pulse text-yellow-400 text-xs">⚙️ 执行中</span>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{req.description}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
              <span>🏢 {req.departmentName}</span>
              <span>📅 {new Date(req.createdAt).toLocaleString('zh')}</span>
              {req.summary && (
                <>
                  <span>✅ {req.summary.successTasks}/{req.summary.totalTasks} 任务</span>
                  <span>⏱️ {Math.round((req.summary.totalDuration || 0) / 1000)}秒</span>
                </>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="text-[var(--muted)] hover:text-white text-xl ml-4 shrink-0">✕</button>
        </div>

        {/* Tab栏 */}
        <div className="flex border-b border-white/[0.06] shrink-0 px-6">
          {[
            { id: 'workflow', label: '📊 工作流', badge: req.workflow?.nodes?.length },
            { id: 'chat', label: '💬 群聊', badge: req.groupChat?.length },
            { id: 'outputs', label: '📦 产出', badge: req.outputs?.length },
            { id: 'files', label: '📁 文件', badge: req.liveStatus?.recentFileChanges?.length || 0 },
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

        {/* 内容区 */}
        <div className={`flex-1 min-h-0 flex flex-col pb-6 ${activeTab === 'files' ? 'overflow-hidden' : 'overflow-auto'}`} style={{ minHeight: activeTab === 'files' ? '400px' : undefined }}>
          {activeTab === 'workflow' && (
            <>
              {/* 实时进度面板（仅在工作流tab下展示） */}
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
 * 工作流可视化 - SVG 流程图 + div 卡片（foreignObject）
 * 多箭头汇合：多条入线先汇合为一根垂直线再连接目标节点
 */
function WorkflowView({ workflow, liveStatus }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const measureRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredNode, setHoveredNode] = useState(null); // { node, rect }
  const [measuredHeights, setMeasuredHeights] = useState({}); // nodeId -> height
  const [measureTick, setMeasureTick] = useState(0); // 用于触发重新测量

  // 监听容器宽度
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setContainerWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // MutationObserver：监听测量容器的 DOM 变化，防抖后自动重新测量
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

  // 测量所有卡片的实际高度
  useEffect(() => {
    if (!measureRef.current) return;
    const cards = measureRef.current.querySelectorAll('[data-node-id]');
    const heights = {};
    cards.forEach(card => {
      const id = card.getAttribute('data-node-id');
      if (id) {
        // scrollHeight 获取内容实际高度
        heights[id] = Math.max(card.scrollHeight, 60); // 最小 60px
      }
    });
    setMeasuredHeights(prev => {
      // 只有真正变化了才更新，避免无限循环
      const changed = Object.keys(heights).some(k => prev[k] !== heights[k]) ||
                      Object.keys(heights).length !== Object.keys(prev).length;
      return changed ? heights : prev;
    });
  }, [workflow, liveStatus, containerWidth, measureTick]);

  // 拓扑分层 + 布局计算（根据测量的实际高度）
  const layout = useMemo(() => {
    if (!workflow?.nodes?.length) return null;
    const nodes = workflow.nodes;

    // 拓扑分层
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

    // 布局参数
    const nodeW = 280;
    const defaultH = 90; // 默认高度（测量前的初始值）
    const padding = 8; // 额外内边距
    const gapX = 32, gapY = 80;
    const padX = 40, padY = 40;

    // 有效宽度
    const effectiveW = Math.max(containerWidth - padX * 2, 600);

    // 计算每层节点位置（居中排列，高度取实际测量值）
    const nodePositions = {};
    let cumulativeY = padY;
    levels.forEach((level, li) => {
      // 该层最大高度 = 该层中最高卡片的测量高度
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

    // 构建边的汇合信息
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
          <p>工作流尚未拆解</p>
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

  // 卡片内容渲染函数（测量容器和实际渲染共用）
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
            {Math.round((new Date(node.completedAt) - new Date(node.startedAt)) / 1000)}秒
          </span>
        )}
      </div>
      {node.description && (
        <p className="text-xs text-[var(--muted)] mt-1.5 line-clamp-2">{node.description}</p>
      )}
      {/* 实时操作提示 */}
      {node.status === 'running' && liveStatus?.currentNodeId === node.id && liveStatus.currentAction && (
        <div className="mt-1.5 bg-yellow-900/10 border border-yellow-500/20 rounded-lg px-2 py-1 text-[10px] text-yellow-300 flex items-center gap-1 overflow-hidden">
          <span className="animate-spin text-xs shrink-0">⚙️</span>
          <span className="truncate">{liveStatus.currentAction}</span>
        </div>
      )}
      {/* 工具调用进度 */}
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

  // 生成连线路径：多条入线汇合成一根垂直线
  const renderEdges = () => {
    const paths = [];
    const mergeGap = 25; // 汇合点距离目标节点顶部的距离

    Object.entries(edgeGroups).forEach(([targetId, fromIds]) => {
      const to = nodePositions[targetId];
      if (!to) return;

      const toCenterX = to.x + to.w / 2;
      const toTopY = to.y;
      const mergeY = toTopY - mergeGap; // 汇合点 Y 坐标

      // 判断边的状态颜色
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
        // 单条入线：直接贝塞尔曲线连接
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
        // 多条入线汇合：所有入线先汇到目标上方的汇合点，再用一根垂直线+箭头连接目标
        // 使用统一颜色避免重叠时颜色不一致
        const allStyles = fromIds.map(fid => getEdgeStyle(fid));
        const bestStyle = allStyles.find(s => s.isActive) || allStyles.find(s => s.color === '#22c55e') || allStyles[0];

        // 1. 汇合的垂直线：从 mergeY 到 toTopY（统一颜色）
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

        // 2. 每条入线用同一颜色，避免重叠时颜色不一致
        // 对入线按 X 坐标排序，使路径更清晰
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
            // 几乎垂直对齐，直接垂直线到汇合点
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
            // 从源底部出发，先垂直下行，然后平滑转弯水平到达汇合点
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
            {/* 箭头标记（按颜色） */}
            {['4b5563', '22c55e', 'eab308', '3b82f6', 'ef4444'].map(hex => (
              <marker key={hex} id={`arrow-${hex}`} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M1,1 L9,5 L1,9" fill="none" stroke={`#${hex}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            ))}
            {/* 流动动画 */}
            <style>{`
              @keyframes dash-flow { to { stroke-dashoffset: -20; } }
              .edge-running { stroke-dasharray: 8 4; animation: dash-flow 0.8s linear infinite; }
            `}</style>
          </defs>

          {/* 连线 */}
          {renderEdges()}

          {/* 节点卡片（foreignObject 嵌入 div） */}
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

      {/* 隐藏的测量容器：渲染所有卡片获取实际高度 */}
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

      {/* Hover Tooltip - 独立浮动层，展示完整任务内容 */}
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
              <div className="mt-1 text-[var(--muted)]">⏱ 耗时 {Math.round((new Date(hoveredNode.node.completedAt) - new Date(hoveredNode.node.startedAt)) / 1000)}秒</div>
            )}
            {hoveredNode.node.status === 'running' && liveStatus?.currentNodeId === hoveredNode.node.id && liveStatus.currentAction && (
              <div className="mt-1 text-yellow-300">⚙️ {liveStatus.currentAction}</div>
            )}
            {/* 小三角 */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white/10" />
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * 群聊视图
 */
function ChatView({ groupChat, chatEndRef }) {
  if (groupChat.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">💬</div>
          <p>暂无群聊消息</p>
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
 * 产出视图
 */
function OutputsView({ outputs }) {
  const [expandedId, setExpandedId] = useState(null);

  if (outputs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📦</div>
          <p>暂无产出</p>
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
            {/* 头部 */}
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
                <span className="text-[var(--muted)] text-xs">{isExpanded ? '收起 ▲' : '展开 ▼'}</span>
              </div>
            </div>

            {/* 内容 */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-white/[0.06]">
                {output.outputType === 'code' ? (
                  <pre className="mt-3 bg-black/30 rounded-lg p-4 overflow-auto text-xs font-mono text-green-300 max-h-96 leading-relaxed">
                    {output.content}
                  </pre>
                ) : output.outputType === 'image' && output.content?.startsWith('http') ? (
                  <div className="mt-3">
                    <img src={output.content} alt="产出图片" className="max-w-full rounded-lg" />
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
 * 实时进度面板 - 展示当前执行状态、心跳、卡住检测
 */
function LiveStatusPanel({ liveStatus, requirementId, requirementStatus, onRestart, onDelete }) {
  const [now, setNow] = useState(Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [operating, setOperating] = useState(false);

  // 每秒更新，计算心跳间隔
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

  // 判断是否可能卡住：超过60秒没有心跳
  const maybeStuck = heartbeatAge !== null && heartbeatAge > 60;
  // 长时间无活动：超过120秒
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
                ? '🔴 可能卡住了'
                : maybeStuck
                ? '🟡 等待响应中...'
                : '🟢 正在执行'}
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
              💓 {heartbeatAge < 60 ? `${heartbeatAge}秒前` : `${Math.round(heartbeatAge / 60)}分钟前`}
            </span>
          )}
          {/* 工具调用中 */}
          {liveStatus.toolCallsInProgress?.length > 0 && (
            <span className="text-purple-400 animate-pulse">
              🔧 {liveStatus.toolCallsInProgress.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* 卡住时显示操作按钮 */}
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
            🔄 {operating ? '重启中...' : '重新开始'}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={operating}
              className="text-[11px] px-3 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              🗑️ 删除需求
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red-400">确认删除？</span>
              <button
                onClick={async () => {
                  setOperating(true);
                  try { await onDelete(); } finally { setOperating(false); setConfirmDelete(false); }
                }}
                disabled={operating}
                className="text-[10px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                确认
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[var(--muted)] transition-colors"
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}

      {/* 最近文件变更快速预览 */}
      {liveStatus.recentFileChanges?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] text-[var(--muted)] shrink-0">最近文件:</span>
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
 * 文件变更视图 - VSCode 风格左右布局
 * 左侧：文件资源管理器（树形结构）
 * 右侧：Monaco Editor 代码预览
 */
function FilesView({ fileChanges, departmentId, previewFile, onPreview, onClosePreview }) {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const [openTabs, setOpenTabs] = useState([]); // 打开的标签页 [{path, name}]
  const [collapsedDirs, setCollapsedDirs] = useState(new Set());
  const resizeRef = useRef(null);

  // 按文件路径去重，只保留最新的
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

  // 构建文件树结构
  const fileTree = useMemo(() => {
    const tree = {};
    uniqueFiles.forEach(fc => {
      const parts = fc.filePath?.split('/').filter(Boolean) || [];
      let node = tree;
      parts.forEach((part, idx) => {
        if (idx === parts.length - 1) {
          // 文件节点
          node[part] = { __isFile: true, __data: fc, __path: fc.filePath };
        } else {
          // 目录节点
          if (!node[part] || node[part].__isFile) {
            node[part] = {};
          }
          node = node[part];
        }
      });
    });
    return tree;
  }, [uniqueFiles]);

  // 拖拽调整侧边栏宽度
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

  // 点击文件：打开标签 + 预览
  const handleFileClick = (filePath) => {
    const name = filePath?.split('/').pop() || filePath;
    if (!openTabs.find(t => t.path === filePath)) {
      setOpenTabs(prev => [...prev, { path: filePath, name }]);
    }
    onPreview(filePath);
  };

  // 关闭标签
  const handleCloseTab = (e, tabPath) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t.path !== tabPath));
    if (previewFile?.path === tabPath) {
      // 如果关闭的是当前预览的，切到最近的标签或关闭预览
      const remaining = openTabs.filter(t => t.path !== tabPath);
      if (remaining.length > 0) {
        onPreview(remaining[remaining.length - 1].path);
      } else {
        onClosePreview();
      }
    }
  };

  // 切换目录折叠
  const toggleDir = (dirPath) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  // 根据扩展名获取语言
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

  // 根据扩展名获取文件图标
  const getFileIcon = (name) => {
    const ext = name?.split('.').pop()?.toLowerCase();
    const iconMap = {
      js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️', py: '🐍', json: '📋',
      md: '📝', css: '🎨', html: '🌐', yaml: '⚙️', yml: '⚙️', txt: '📄',
      sh: '🖥️', sql: '🗃️',
    };
    return iconMap[ext] || '📄';
  };

  // 空状态
  if (fileChanges.length === 0 && !previewFile) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📁</div>
          <p>暂无文件变更</p>
          <p className="text-xs mt-1">任务执行过程中产生的文件会在这里显示</p>
        </div>
      </div>
    );
  }

  // 渲染文件树节点
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

    // 目录节点
    const dirPath = path;
    const isCollapsed = collapsedDirs.has(dirPath);
    const entries = Object.entries(node).filter(([k]) => !k.startsWith('__'));
    // 目录优先排列
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
      {/* 左侧：文件资源管理器 */}
      <div
        className="shrink-0 border-r border-[var(--border)] bg-[var(--card)] flex flex-col"
        style={{ width: sidebarWidth }}
      >
        {/* 侧边栏标题 */}
        <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase border-b border-[var(--border)] flex items-center justify-between">
          <span>资源管理器</span>
          <span className="text-[10px] normal-case font-normal bg-white/10 px-1.5 py-0.5 rounded">
            {uniqueFiles.length} 文件
          </span>
        </div>

        {/* 文件树 */}
        <div className="flex-1 overflow-auto py-1 select-none">
          {Object.entries(fileTree).sort(([a, av], [b, bv]) => {
            // 目录优先
            const aDir = !av.__isFile;
            const bDir = !bv.__isFile;
            if (aDir && !bDir) return -1;
            if (!aDir && bDir) return 1;
            return a.localeCompare(b);
          }).map(([name, node]) =>
            renderTreeNode(node, name, name, 0)
          )}
        </div>

        {/* 侧边栏底部状态 */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--muted)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>实时同步中</span>
        </div>
      </div>

      {/* 拖拽调整手柄 */}
      <div
        ref={resizeRef}
        className={`w-[3px] cursor-col-resize hover:bg-[var(--accent)]/40 transition-colors shrink-0 ${
          isResizing ? 'bg-[var(--accent)]/50' : 'bg-transparent'
        }`}
        onMouseDown={() => setIsResizing(true)}
      />

      {/* 右侧：编辑器区域 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--background)]">
        {/* 打开的标签页 */}
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

        {/* 编辑器主体 */}
        {previewFile ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* 面包屑路径栏 */}
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
                  <span className="text-yellow-400 animate-pulse">同步中...</span>
                )}
                <button
                  onClick={() => onPreview(previewFile.path)}
                  className="text-[var(--muted)] hover:text-white transition-colors px-1"
                  title="刷新"
                >
                  ↻
                </button>
              </div>
            </div>

            {/* Monaco 编辑器 */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {previewFile.loading ? (
                <div className="flex items-center justify-center h-full text-[var(--muted)] animate-pulse">
                  <div className="text-center">
                    <div className="text-2xl mb-2">⏳</div>
                    <p className="text-sm">加载中...</p>
                  </div>
                </div>
              ) : (
                <MonacoEditor
                  height="100%"
                  language={getLanguage(previewFile.path)}
                  value={previewFile.content || '(空文件)'}
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

            {/* 底部状态栏 */}
            <div className="flex items-center justify-between px-3 py-1 bg-[var(--card)] border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
              <div className="flex items-center gap-3">
                <span>{getLanguage(previewFile.path).toUpperCase()}</span>
                <span>UTF-8</span>
                {previewFile.content && (
                  <span>{previewFile.content.split('\n').length} 行</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>只读</span>
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              </div>
            </div>
          </div>
        ) : (
          /* 空状态 - 欢迎页 */
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <div className="text-6xl mb-4 opacity-20">{ }</div>
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <span className="text-3xl opacity-40">📝</span>
              </div>
              <p className="text-sm">点击左侧文件查看内容</p>
              <p className="text-[10px] mt-1 text-[var(--muted)]/60">支持语法高亮 · 实时同步</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
