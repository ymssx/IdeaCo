'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

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
 * Shared FilesView component - VSCode style left-right layout
 * Left: file explorer (tree structure)
 * Right: Monaco Editor code preview
 *
 * Props:
 *  - fileChanges: array of recent file changes from agents (optional)
 *  - departmentId: department ID for workspace API calls
 *  - previewFile: { path, content, loading } or null
 *  - onPreview: (filePath) => void
 *  - onClosePreview: () => void
 */
export default function FilesView({ fileChanges, departmentId, previewFile, onPreview, onClosePreview }) {
  const { t } = useI18n();
  const { fetchWorkspaceFiles } = useStore();
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const [openTabs, setOpenTabs] = useState([]);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [dirChildren, setDirChildren] = useState({});
  const [dirLoading, setDirLoading] = useState(new Set());
  const resizeRef = useRef(null);
  const [rootEntries, setRootEntries] = useState([]);
  const [wsLoading, setWsLoading] = useState(false);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    setWsLoading(true);
    (async () => {
      try {
        const files = await fetchWorkspaceFiles(departmentId);
        if (!cancelled && Array.isArray(files)) {
          setRootEntries(files);
        }
      } catch {
        // silently fail
      }
      if (!cancelled) setWsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [departmentId, fetchWorkspaceFiles]);

  const loadDirChildren = useCallback(async (dirPath) => {
    if (dirChildren[dirPath] || dirLoading.has(dirPath)) return;
    setDirLoading(prev => new Set(prev).add(dirPath));
    try {
      const children = await fetchWorkspaceFiles(departmentId, dirPath);
      if (Array.isArray(children)) {
        setDirChildren(prev => ({ ...prev, [dirPath]: children }));
      }
    } catch { /* ignore */ }
    setDirLoading(prev => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });
  }, [departmentId, dirChildren, dirLoading, fetchWorkspaceFiles]);

  const toggleDir = useCallback((dirPath) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        loadDirChildren(dirPath);
      }
      return next;
    });
  }, [loadDirChildren]);

  const recentTree = useMemo(() => {
    const tree = {};
    (fileChanges || []).forEach(fc => {
      const parts = fc.filePath?.split('/').filter(Boolean) || [];
      let node = tree;
      parts.forEach((part, idx) => {
        if (idx === parts.length - 1) {
          node[part] = { __isFile: true, __data: fc, __path: fc.filePath };
        } else {
          if (!node[part] || node[part].__isFile) node[part] = {};
          node = node[part];
        }
      });
    });
    return tree;
  }, [fileChanges]);

  const totalCount = useMemo(() => {
    const countRecent = (fileChanges || []).length;
    return rootEntries.length + countRecent;
  }, [rootEntries, fileChanges]);

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

  const handleFileClick = (filePath) => {
    const name = filePath?.split('/').pop() || filePath;
    if (!openTabs.find(t => t.path === filePath)) {
      setOpenTabs(prev => [...prev, { path: filePath, name }]);
    }
    onPreview(filePath);
  };

  const handleCloseTab = (e, tabPath) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t.path !== tabPath));
    if (previewFile?.path === tabPath) {
      const remaining = openTabs.filter(t => t.path !== tabPath);
      if (remaining.length > 0) {
        onPreview(remaining[remaining.length - 1].path);
      } else {
        onClosePreview();
      }
    }
  };

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

  const getFileIcon = (name) => {
    const ext = name?.split('.').pop()?.toLowerCase();
    const iconMap = {
      js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️', py: '🐍', json: '📋',
      md: '📝', css: '🎨', html: '🌐', yaml: '⚙️', yml: '⚙️', txt: '📄',
      sh: '🖥️', sql: '🗃️',
    };
    return iconMap[ext] || '📄';
  };

  // Sort helper: directories first
  const sortEntries = (entries) =>
    [...entries].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

  const sortedRootEntries = useMemo(() => sortEntries(rootEntries), [rootEntries]);

  // Empty state
  if (rootEntries.length === 0 && (fileChanges || []).length === 0 && !previewFile && !wsLoading) {
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
  if (rootEntries.length === 0 && (fileChanges || []).length === 0 && wsLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--muted)]">
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">⏳</div>
          <p>{t('reqDetail.files.loading')}</p>
        </div>
      </div>
    );
  }

  const renderFileEntry = (entry, depth = 0) => {
    if (entry.type === 'file') {
      const filePath = entry.path || entry.name;
      const isActive = previewFile?.path === filePath;
      const recentMatch = (fileChanges || []).find(fc => fc.filePath === filePath);
      return (
        <div
          key={filePath}
          className={`flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-xs transition-colors group ${
            isActive
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'text-[var(--foreground)]/80 hover:bg-white/[0.06]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => handleFileClick(filePath)}
          title={filePath}
        >
          <span className="text-[11px] shrink-0">{getFileIcon(entry.name)}</span>
          <span className="truncate">{entry.name}</span>
          {recentMatch?.agentName && (
            <span className="ml-auto text-[10px] text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {recentMatch.agentName}
            </span>
          )}
        </div>
      );
    }

    // Directory entry
    const dirPath = entry.path || entry.name;
    const isExpanded = expandedDirs.has(dirPath);
    const isLoading = dirLoading.has(dirPath);
    const children = dirChildren[dirPath] || [];
    const sortedChildren = sortEntries(children);

    return (
      <div key={dirPath}>
        <div
          className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-xs text-[var(--foreground)]/80 hover:bg-white/[0.06] transition-colors"
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => toggleDir(dirPath)}
        >
          <span className="text-[10px] text-[var(--muted)] w-3 text-center shrink-0">
            {isLoading ? <span className="animate-pulse">⏳</span> : isExpanded ? '▼' : '▶'}
          </span>
          <span className="text-[11px] shrink-0">📁</span>
          <span className="truncate font-medium">{entry.name}</span>
        </div>
        {isExpanded && sortedChildren.map(child =>
          renderFileEntry(child, depth + 1)
        )}
      </div>
    );
  };

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

    const entries = Object.entries(node).filter(([k]) => !k.startsWith('__'));
    const dirs = entries.filter(([, v]) => !v.__isFile).sort(([a], [b]) => a.localeCompare(b));
    const files = entries.filter(([, v]) => v.__isFile).sort(([a], [b]) => a.localeCompare(b));
    const sorted = [...dirs, ...files];
    const isExpanded = expandedDirs.has(path);

    return (
      <div key={path}>
        <div
          className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-xs text-[var(--foreground)]/80 hover:bg-white/[0.06] transition-colors"
          style={{ paddingLeft: `${depth * 16 + 16}px` }}
          onClick={() => setExpandedDirs(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; })}
        >
          <span className="text-[10px] text-[var(--muted)] w-3 text-center shrink-0">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="text-[11px] shrink-0">📁</span>
          <span className="truncate font-medium">{name}</span>
          <span className="ml-auto text-[10px] text-[var(--muted)]">{entries.length}</span>
        </div>
        {isExpanded && sorted.map(([childName, childNode]) =>
          renderTreeNode(childNode, childName, `${path}/${childName}`, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-[400px] overflow-hidden">
      {/* Left: file explorer */}
      <div
        className="shrink-0 bg-[var(--card)] flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase flex items-center justify-between">
          <span>{t('reqDetail.files.explorer')}</span>
          <span className="text-[10px] normal-case font-normal text-[var(--muted)]/60">
            {totalCount}
          </span>
        </div>

        <div className="flex-1 overflow-auto py-1 select-none">
          {(fileChanges || []).length > 0 && Object.keys(recentTree).length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-yellow-400 font-medium">
                {t('systemSettings.agentChanges')}
              </div>
              {Object.entries(recentTree).sort(([a, av], [b, bv]) => {
                const aDir = !av.__isFile;
                const bDir = !bv.__isFile;
                if (aDir && !bDir) return -1;
                if (!aDir && bDir) return 1;
                return a.localeCompare(b);
              }).map(([name, node]) =>
                renderTreeNode(node, name, name, 0)
              )}
              {rootEntries.length > 0 && (
                <div className="mx-3 my-1 h-px bg-white/[0.06]" />
              )}
            </>
          )}
          {sortedRootEntries.map(entry => renderFileEntry(entry, 0))}
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
        {openTabs.length > 0 && (
          <div className="flex bg-[var(--card)] overflow-x-auto shrink-0">
            {openTabs.map(tab => {
              const isActive = previewFile?.path === tab.path;
              return (
                <div
                  key={tab.path}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer min-w-0 group transition-colors ${
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

        {previewFile ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1 bg-[var(--card)] text-[10px] text-[var(--muted)]">
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
                  value={previewFile.content != null ? previewFile.content : t('reqDetail.files.emptyFile')}
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

            <div className="flex items-center justify-between px-3 py-1 bg-[var(--card)] text-[10px] text-[var(--muted)]">
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
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <div className="text-6xl mb-4 opacity-20">{ }</div>
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-white/[0.03] flex items-center justify-center">
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
