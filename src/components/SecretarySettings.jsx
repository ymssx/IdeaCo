'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl, AVATAR_STYLES } from '@/lib/avatar';

export default function SecretarySettings({ onClose }) {
  const { company, updateSecretarySettings } = useStore();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [signature, setSignature] = useState('');
  const [providerId, setProviderId] = useState('');
  const [avatarStyle, setAvatarStyle] = useState('bottts');
  const [avatarSeed, setAvatarSeed] = useState(''); // 头像种子，用于在同风格下换不同头像
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const secretary = company?.secretary;

  useEffect(() => {
    if (secretary) {
      setName(secretary.name || '');
      setPrompt(secretary.prompt || '');
      setSignature(secretary.signature || '');
      setProviderId(secretary.providerId || '');
      // 从当前头像 URL 推断风格和种子
      const styleMatch = secretary.avatar?.match(/style=([^&]+)/);
      if (styleMatch) setAvatarStyle(decodeURIComponent(styleMatch[1]));
      const seedMatch = secretary.avatar?.match(/seed=([^&]+)/);
      if (seedMatch) setAvatarSeed(decodeURIComponent(seedMatch[1]));
    }
  }, [secretary]);

  if (!secretary) return null;

  // 头像种子：优先用用户自定义种子，否则用名字
  const currentSeed = avatarSeed || name || '秘书';
  const previewAvatar = getAvatarUrl(currentSeed, avatarStyle);

  // 刷新种子：在当前名字基础上加随机后缀
  const refreshSeed = () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    setAvatarSeed(`${name || '秘书'}_${suffix}`);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const settings = {};
      if (name && name !== secretary.name) settings.name = name;
      if (prompt !== secretary.prompt) settings.prompt = prompt;
      if (signature && signature !== secretary.signature) settings.signature = signature;
      if (providerId && providerId !== secretary.providerId) settings.providerId = providerId;
      // 用当前种子和风格生成头像
      const newAvatar = getAvatarUrl(currentSeed, avatarStyle);
      if (newAvatar !== secretary.avatar) settings.avatar = newAvatar;

      if (Object.keys(settings).length > 0) {
        await updateSecretarySettings(settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) { /* handled */ }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 !m-0" onClick={onClose}>
      <div className="card max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <img src={previewAvatar} alt="秘书" className="w-12 h-12 rounded-full bg-[var(--border)]" />
            <div>
              <h2 className="text-lg font-bold">⚙️ 秘书设置</h2>
              <p className="text-xs text-[var(--muted)]">调教你的首席帮凶</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto py-4 space-y-5">
          {/* 名字 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">秘书名字</label>
            <input
              className="input w-full"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="如：小秘、Alice"
            />
          </div>

          {/* 头像选择 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[var(--muted)]">头像风格</label>
              <button
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
                onClick={refreshSeed}
              >
                🔄 换一批
              </button>
            </div>
            {/* 当前预览 */}
            <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-[var(--card)] border border-[var(--border)]">
              <img src={previewAvatar} alt="预览" className="w-16 h-16 rounded-full bg-[var(--border)]" />
              <div className="text-xs text-[var(--muted)]">
                <div>风格: <span className="text-[var(--foreground)]">{avatarStyle}</span></div>
                <div>种子: <span className="text-[var(--foreground)] font-mono">{currentSeed}</span></div>
                <div className="mt-1 text-[10px]">💡 点击下方切换风格，或点「换一批」随机生成</div>
              </div>
            </div>
            {/* 风格网格 */}
            <div className="grid grid-cols-5 gap-2 max-h-48 overflow-auto pr-1">
              {AVATAR_STYLES.map((style) => (
                <button
                  key={style}
                  onClick={() => setAvatarStyle(style)}
                  className={`p-1.5 rounded-lg border transition-all flex flex-col items-center gap-0.5 ${
                    avatarStyle === style
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/40'
                  }`}
                >
                  <img
                    src={getAvatarUrl(currentSeed, style)}
                    alt={style}
                    className="w-9 h-9 rounded-full bg-[var(--border)]"
                  />
                  <span className="text-[9px] text-[var(--muted)] truncate w-full text-center">{style}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 服务供应商 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">🧠 服务供应商</label>
            <p className="text-[10px] text-[var(--muted)] mb-2">
              秘书和HR助手使用的AI模型。只能选择已配置API Key并启用的供应商。
            </p>
            {secretary.availableProviders && secretary.availableProviders.length > 0 ? (
              <select
                className="input w-full"
                value={providerId}
                onChange={e => setProviderId(e.target.value)}
              >
                {secretary.availableProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-yellow-400 p-2 rounded bg-yellow-400/10 border border-yellow-400/20">
                ⚠️ 没有可用的供应商，请先在「大脑供应商」页面配置API Key
              </div>
            )}
          </div>

          {/* 签名 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">个性签名</label>
            <input
              className="input w-full"
              value={signature}
              onChange={e => setSignature(e.target.value)}
              placeholder="如：效率就是生命"
            />
          </div>

          {/* Prompt（洗脑话术） */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">
              🧠 洗脑话术（系统 Prompt）
            </label>
            <p className="text-[10px] text-[var(--muted)] mb-2">
              这是秘书的「人格设定」，决定了它如何理解你的指令、如何规划团队、如何与你沟通。
              修改此项将直接影响秘书的行为模式。
            </p>
            <textarea
              className="input w-full h-48 resize-y text-sm font-mono"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="输入秘书的系统 prompt..."
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[var(--muted)]">
                字符数: {prompt.length}
              </span>
              <button
                className="text-[10px] text-[var(--accent)] hover:underline"
                onClick={() => {
                  setPrompt(`你是企业老板的专属秘书，负责理解老板的业务需求，分析所需的团队构成，
设计组织架构（谁负责什么、谁向谁汇报、如何协作），并协调HR进行人才招聘。
你需要根据项目需求，合理规划不同岗位的数量和类型，确保团队能高效完成目标。
你有一个专属的HR助手来帮你处理具体的招聘事务，包括从人才市场中搜索和召回人才。

当老板和你沟通时，你需要：
1. 理解老板的意图（是分配任务、查询进度、还是日常沟通）
2. 如果是任务，分配给对应部门
3. 定期向老板汇报各部门进度`);
                }}
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-xs text-[var(--muted)]">
            模型: {secretary.provider} · Token: {secretary.hrAssistant ? '含HR助手' : ''}
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-400 animate-fade-in">✅ 已保存</span>}
            <button className="btn-secondary" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? '⏳ 保存中...' : '💾 保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
