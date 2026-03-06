'use client';

import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

/**
 * 文件引用格式:
 *   完整格式: [[file:departmentId:filePath|displayName]]
 *   无显示名: [[file:departmentId:filePath]]
 * 例如: [[file:dept_abc123:src/index.js|index.js]]
 *       [[file:dept_abc123:src/index.js]]
 */
const FILE_REF_FULL_REGEX = /\[\[file:([^:]+):([^|\]]+)\|([^\]]+)\]\]/g;
const FILE_REF_NO_NAME_REGEX = /\[\[file:([^:]+):([^\]]+)\]\]/g;

/**
 * 从消息内容中解析文件引用，返回纯文本（去掉引用标记）+ 文件引用列表
 * 同时兼容有 |displayName 和没有 |displayName 的两种格式
 */
export function parseFileReferences(content) {
  if (!content || typeof content !== 'string') return { cleanContent: content, fileRefs: [] };

  const fileRefs = [];
  let match;

  // 先匹配完整格式 [[file:deptId:path|name]]
  const fullRegex = new RegExp(FILE_REF_FULL_REGEX.source, 'g');
  while ((match = fullRegex.exec(content)) !== null) {
    const filePath = match[2]?.trim();
    const displayName = match[3]?.trim();
    // Skip invalid refs with empty path or name
    if (!filePath || !displayName) continue;
    fileRefs.push({
      fullMatch: match[0],
      departmentId: match[1],
      filePath,
      displayName,
    });
  }

  // 去掉已匹配的完整格式后，再匹配无显示名格式 [[file:deptId:path]]
  let remaining = content.replace(FILE_REF_FULL_REGEX, '\0FILE_REF_PLACEHOLDER\0');
  const noNameRegex = new RegExp(FILE_REF_NO_NAME_REGEX.source, 'g');
  while ((match = noNameRegex.exec(remaining)) !== null) {
    const filePath = match[2].trim();
    // Skip invalid refs with empty or pipe-only paths (malformed tool args)
    if (!filePath || filePath === '|') continue;
    const displayName = filePath.split('/').pop() || filePath;
    fileRefs.push({
      fullMatch: match[0],
      departmentId: match[1],
      filePath,
      displayName,
    });
  }

  // 将所有文件引用标记从正文中移除，放到末尾作为附件展示
  const cleanContent = content
    .replace(FILE_REF_FULL_REGEX, '')
    .replace(FILE_REF_NO_NAME_REGEX, '')
    .trim();

  return { cleanContent, fileRefs };
}

/**
 * 文件引用标签组件 - 可点击打开文件内容弹窗
 */
export function FileRefChip({ departmentId, filePath, displayName }) {
  const [showModal, setShowModal] = useState(false);

  // 推断文件图标
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const iconMap = {
    js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
    py: '🐍', go: '🔵', rs: '🦀', java: '☕',
    html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄', sh: '🖥️', bash: '🖥️',
    sql: '🗃️', graphql: '🔗', proto: '📡',
    png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
  };
  const icon = iconMap[ext] || '📄';

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
        className="inline px-2.5 py-1 my-0.5 mx-0.5 rounded-lg
          bg-[#0f2418] border border-[#1e3a2a] hover:bg-[#152e1f] hover:border-[#2a4d38]
          text-[#8cc9a1] text-xs font-medium transition-all cursor-pointer group text-left shadow-sm"
        title={filePath}
      >
        <span className="mr-1.5">{icon}</span>
        <span className="break-all">{displayName}</span>
        <span className="ml-1.5 text-[#4a8a5c]/60 group-hover:text-[#6abf7e] transition-colors">↗</span>
      </button>

      {showModal && (
        <FileViewerModal
          departmentId={departmentId}
          filePath={filePath}
          displayName={displayName}
          icon={icon}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

/**
 * 文件查看弹窗
 */
function FileViewerModal({ departmentId, filePath, displayName, icon, onClose }) {
  const { t } = useI18n();
  const { fetchWorkspaceFile } = useStore();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // 加载文件内容
  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkspaceFile(departmentId, filePath);
      if (typeof data?.content === 'string') {
        setContent(data.content);
      } else if (typeof data === 'string') {
        setContent(data);
      } else if (data?.error) {
        setError(data.error);
      } else {
        setError(t('fileRef.loadFailed'));
      }
    } catch (e) {
      setError(e.message || t('fileRef.loadFailed'));
    }
    setLoading(false);
  }, [departmentId, filePath, fetchWorkspaceFile, t]);

  // 首次加载
  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 推断语言
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', go: 'go', rs: 'rust', java: 'java',
    html: 'html', css: 'css', scss: 'scss',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sh: 'bash', sql: 'sql',
  };
  const lang = langMap[ext] || 'text';

  const lineCount = content?.split('\n').length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] !m-0" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-lg shrink-0">{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{displayName}</div>
              <div className="text-[10px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
                <span className="truncate">{filePath}</span>
                {lineCount > 0 && (
                  <span className="shrink-0 px-1.5 py-0.5 bg-white/5 rounded">{t('fileRef.lines', { n: lineCount })}</span>
                )}
                <span className="shrink-0 px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded uppercase text-[9px] font-medium">{lang}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              onClick={handleCopyPath}
              className="text-[10px] text-[var(--muted)] hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-all"
            >
              {copied ? t('fileRef.copied') : t('fileRef.copyPath')}
            </button>
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="text-2xl animate-pulse mb-2">⏳</div>
                <p className="text-sm text-[var(--muted)]">{t('fileRef.loading')}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="text-2xl mb-2">❌</div>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          ) : (
            <pre className="p-4 text-sm font-mono leading-relaxed overflow-x-auto">
              <code>
                {(content ?? '').split('\n').map((line, i) => (
                  <div key={i} className="flex hover:bg-white/[0.03] transition-colors">
                    <span className="inline-block w-12 text-right pr-4 text-[var(--muted)]/40 select-none text-xs leading-relaxed shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">{line || ' '}</span>
                  </div>
                ))}
              </code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 文件引用列表 - 在消息气泡底部展示文件引用标签
 */
export function FileRefList({ fileRefs }) {
  if (!fileRefs || fileRefs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-white/[0.06]">
      {fileRefs.map((ref, i) => (
        <FileRefChip
          key={`${ref.departmentId}-${ref.filePath}-${i}`}
          departmentId={ref.departmentId}
          filePath={ref.filePath}
          displayName={ref.displayName}
        />
      ))}
    </div>
  );
}
