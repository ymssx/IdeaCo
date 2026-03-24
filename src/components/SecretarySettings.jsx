'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarChoices } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n';
import CachedAvatar from './CachedAvatar';
import AvatarGrid from './AvatarGrid';

export default function SecretarySettings({ onClose }) {
  const { t } = useI18n();
  const { company, updateSecretarySettings } = useStore();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [signature, setSignature] = useState('');
  const [providerId, setProviderId] = useState('');
  const [gender, setGender] = useState('female');
  const [age, setAge] = useState(18);
  const [selectedAvatar, setSelectedAvatar] = useState(null); // { url, params }
  const [avatarChoices, setAvatarChoices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  // LLM Logs tab state
  const [llmLogs, setLlmLogs] = useState(null);
  const [llmLogsLoading, setLlmLogsLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState(null);
  const [selectedLogDetail, setSelectedLogDetail] = useState(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);

  const secretary = company?.secretary;

  // Initialize data
  useEffect(() => {
    if (secretary) {
      setName(secretary.name || '');
      setPrompt(secretary.prompt || '');
      setSignature(secretary.signature || '');
      setProviderId(secretary.providerId || '');
      setGender(secretary.gender || 'female');
      setAge(secretary.age || 18);
    }
  }, [secretary]);

  // Regenerate avatar choices when gender/age changes (debounced)
  const debounceTimer = useRef(null);
  const refreshAvatarDebounced = useCallback((g, a) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const choices = getAvatarChoices(24, g, a);
      setAvatarChoices(choices);
    }, 300);
  }, []);

  useEffect(() => {
    refreshAvatarDebounced(gender, age);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [gender, age, refreshAvatarDebounced]);

  if (!secretary) return null;

  const previewAvatar = selectedAvatar?.url || secretary.avatar;

  // Shuffle avatar choices
  const refreshChoices = () => {
    const choices = getAvatarChoices(24, gender, age);
    setAvatarChoices(choices);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const settings = {};
      if (name && name !== secretary.name) settings.name = name;
      if (gender !== secretary.gender) settings.gender = gender;
      if (age !== secretary.age) settings.age = age;
      if (selectedAvatar) {
        settings.avatar = selectedAvatar.url;
        settings.avatarParams = selectedAvatar.params;
      }
      if (prompt !== secretary.prompt) settings.prompt = prompt;
      if (signature && signature !== secretary.signature) settings.signature = signature;
      if (providerId && providerId !== secretary.providerId) settings.providerId = providerId;

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
      <div className="card max-w-2xl w-full mx-4 max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <CachedAvatar src={previewAvatar} alt="secretary" className="w-14 h-14 rounded-full bg-[var(--border)]" />
            <div>
              <h2 className="text-lg font-bold">{t('secretarySettings.title')}</h2>
              <p className="text-xs text-[var(--muted)]">{t('secretarySettings.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto py-4 space-y-5">
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)]">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                activeTab === 'profile'
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-white hover:bg-white/5'
              }`}
            >{t('secretarySettings.tabProfile')}</button>
            <button
              onClick={() => setActiveTab('soul')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                activeTab === 'soul'
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-white hover:bg-white/5'
              }`}
            >{t('secretarySettings.tabSoul')}</button>
            <button
              onClick={() => setActiveTab('llmLogs')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                activeTab === 'llmLogs'
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-white hover:bg-white/5'
              }`}
            >{t('secretarySettings.tabLLMLogs')}</button>
          </div>

          {activeTab === 'profile' && (<>
{/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">{t('secretarySettings.nameLabel')}</label>
            <input
              className="input w-full"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('secretarySettings.namePlaceholder')}
            />
          </div>

{/* Gender & Age */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">{t('setup.gender')}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { setGender('female'); setSelectedAvatar(null); }}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm transition-all ${
                    gender === 'female'
                      ? 'border-pink-400 bg-pink-400/10 text-pink-300'
                      : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                  }`}
                >{t('setup.female')}</button>
                <button
                  onClick={() => { setGender('male'); setSelectedAvatar(null); }}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm transition-all ${
                    gender === 'male'
                      ? 'border-blue-400 bg-blue-400/10 text-blue-300'
                      : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40'
                  }`}
                >{t('setup.male')}</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">{t('setup.age', { n: age })}</label>
              <div className="relative flex items-center gap-3">
                <button
                  onClick={() => setAge(a => Math.max(18, a - 1))}
                  className="w-7 h-7 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-sm font-bold shrink-0"
                >−</button>
                <div className="flex-1 relative h-5 flex items-center">
{/* Track background */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[var(--border)] pointer-events-none" />
{/* Gradient progress bar */}
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-purple-400 pointer-events-none"
                    style={{ width: `${((age - 18) / 42) * 100}%` }}
                  />
{/* Range slider input (transparent track, thumb only) */}
                  <input
                    type="range"
                    min="18"
                    max="60"
                    value={age}
                    onChange={e => { setAge(Number(e.target.value)); setSelectedAvatar(null); }}
                    className="absolute inset-0 z-10 w-full appearance-none cursor-pointer bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(99,102,241,0.5)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:-mt-[5px]"
                  />
                </div>
                <button
                  onClick={() => setAge(a => Math.min(60, a + 1))}
                  className="w-7 h-7 rounded-full border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center justify-center text-sm font-bold shrink-0"
                >+</button>
              </div>
              <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1 px-10">
                <span>18</span><span>30</span><span>45</span><span>60</span>
              </div>
            </div>
          </div>

{/* Avatar selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[var(--muted)]">{t('secretarySettings.avatarStyle')}</label>
              <button
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
                onClick={refreshChoices}
              >{t('secretarySettings.refreshAvatar')}</button>
            </div>
{/* Avatar grid */}
            <AvatarGrid
              choices={avatarChoices}
              selectedId={selectedAvatar?.id}
              onSelect={setSelectedAvatar}
            />
          </div>

{/* Signature */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">{t('secretarySettings.signatureLabel')}</label>
            <input
              className="input w-full"
              value={signature}
              onChange={e => setSignature(e.target.value)}
              placeholder={t('secretarySettings.signaturePlaceholder')}
            />
          </div>
          </>)}

          {activeTab === 'soul' && (<>
{/* Service provider */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">{t('secretarySettings.providerLabel')}</label>
            <p className="text-[10px] text-[var(--muted)] mb-2">
              {t('secretarySettings.providerDesc')}
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
                {t('secretarySettings.noProviders')}
              </div>
            )}
          </div>

{/* Prompt */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--muted)]">
              {t('secretarySettings.promptLabel')}
            </label>
            <p className="text-[10px] text-[var(--muted)] mb-2">
              {t('secretarySettings.promptDesc')}
            </p>
            <textarea
              className="input w-full h-48 resize-y text-sm font-mono"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={t('secretarySettings.promptLabel')}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[var(--muted)]">
                {t('secretarySettings.charCount', { n: prompt.length })}
              </span>
              <button
                className="text-[10px] text-[var(--accent)] hover:underline"
                onClick={() => {
                  setPrompt(t('setup.defaultPrompt'));
                }}
              >{t('secretarySettings.restoreDefault')}</button>
            </div>
          </div>
          </>)}

          {activeTab === 'llmLogs' && secretary.id && (
            <SecretaryLLMLogs
              agentId={secretary.id}
              logs={llmLogs}
              loading={llmLogsLoading}
              selectedLogId={selectedLogId}
              selectedLogDetail={selectedLogDetail}
              logDetailLoading={logDetailLoading}
              onLoad={async () => {
                setLlmLogsLoading(true);
                try {
                  const res = await fetch(`/api/agents/${secretary.id}/llm-logs?limit=50&offset=0`);
                  const data = await res.json();
                  setLlmLogs(data);
                } catch { setLlmLogs({ logs: [], total: 0 }); }
                setLlmLogsLoading(false);
              }}
              onSelectLog={async (logId) => {
                if (logId === selectedLogId) { setSelectedLogId(null); setSelectedLogDetail(null); return; }
                setSelectedLogId(logId);
                setLogDetailLoading(true);
                try {
                  const res = await fetch(`/api/agents/${secretary.id}/llm-logs?logId=${logId}`);
                  const data = await res.json();
                  setSelectedLogDetail(data);
                } catch { setSelectedLogDetail(null); }
                setLogDetailLoading(false);
              }}
              onClear={async () => {
                await fetch(`/api/agents/${secretary.id}/llm-logs`, { method: 'DELETE' });
                setLlmLogs({ logs: [], total: 0 });
                setSelectedLogId(null);
                setSelectedLogDetail(null);
              }}
              t={t}
            />
          )}
        </div>

{/* Footer actions */}
        <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-xs text-[var(--muted)]">
            {t('secretarySettings.modelInfo', { provider: secretary.provider, info: ''})} {secretary.hrAssistant ? t('secretarySettings.withHR') : ''}
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-400 animate-fade-in">{t('secretarySettings.saved')}</span>}
            <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? t('secretarySettings.saving') : t('secretarySettings.saveBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SecretaryLLMLogs — View LLM call logs for the secretary (full input/output)
 */
function SecretaryLLMLogs({ agentId, logs, loading, selectedLogId, selectedLogDetail, logDetailLoading, onLoad, onSelectLog, onClear, t }) {
  useEffect(() => {
    if (!logs && !loading) onLoad();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-8 text-[var(--muted)] animate-fade-in">
        <div className="animate-spin text-2xl mb-2">⏳</div>
        <p className="text-xs">{t('common.loading')}</p>
      </div>
    );
  }

  if (!logs || logs.logs.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--muted)] animate-fade-in">
        <div className="text-3xl mb-2">📋</div>
        <p className="text-sm">{t('agent.llmLogs.empty')}</p>
        <p className="text-xs mt-1 text-[var(--muted)]">{t('agent.llmLogs.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted)]">
          {t('agent.llmLogs.totalCount', { n: logs.total })}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onLoad}
            className="text-[10px] px-2 py-1 rounded bg-white/5 text-[var(--muted)] hover:bg-white/10 transition-colors"
          >
            🔄 {t('agent.llmLogs.refresh')}
          </button>
          <button
            onClick={() => { if (confirm(t('agent.llmLogs.clearConfirm'))) onClear(); }}
            className="text-[10px] px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/30 transition-colors"
          >
            🗑 {t('agent.llmLogs.clear')}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[50vh] overflow-auto">
        {logs.logs.map((log) => (
          <div key={log.id}>
            <button
              onClick={() => onSelectLog(log.id)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                selectedLogId === log.id
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                  : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)]/30'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[var(--accent)]">{log.model}</span>
                  {log.streamed && <span className="text-[8px] bg-cyan-900/30 text-cyan-400 px-1 py-0.5 rounded">STREAM</span>}
                  {log.error && <span className="text-[8px] bg-red-900/30 text-red-400 px-1 py-0.5 rounded">ERROR</span>}
                </div>
                <span className="text-[10px] text-[var(--muted)]">{log.latency}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--muted)]">
                  {new Date(log.timestamp).toLocaleString()} · {log.messageCount} msgs
                  {log.usage?.total_tokens ? ` · ${log.usage.total_tokens} tokens` : ''}
                </span>
                <span className="text-[10px] text-[var(--muted)]">{selectedLogId === log.id ? '▲' : '▼'}</span>
              </div>
              {log.outputPreview && (
                <div className="text-[10px] text-[var(--muted)] mt-1 truncate">
                  {log.outputPreview}
                </div>
              )}
            </button>

            {selectedLogId === log.id && (
              <div className="mt-1 border border-[var(--border)] rounded-lg overflow-hidden">
                {logDetailLoading ? (
                  <div className="p-4 text-center text-[var(--muted)]">
                    <span className="animate-spin inline-block">⏳</span> {t('common.loading')}
                  </div>
                ) : selectedLogDetail ? (
                  <div className="divide-y divide-[var(--border)]">
                    {/* Input - Messages */}
                    <div className="p-3">
                      <h5 className="text-xs font-bold text-green-400 mb-2">📥 {t('agent.llmLogs.input')} ({selectedLogDetail.input?.messages?.length || 0} messages)</h5>
                      <div className="space-y-1.5 max-h-80 overflow-auto">
                        {(selectedLogDetail.input?.messages || []).map((msg, i) => (
                          <div key={i} className={`rounded-lg p-2 text-xs ${
                            msg.role === 'system' ? 'bg-purple-900/15 border border-purple-500/10' :
                            msg.role === 'assistant' ? 'bg-blue-900/15 border border-blue-500/10' :
                            msg.role === 'tool' ? 'bg-orange-900/15 border border-orange-500/10' :
                            'bg-white/5 border border-white/10'
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold uppercase ${
                                msg.role === 'system' ? 'text-purple-400' :
                                msg.role === 'assistant' ? 'text-blue-400' :
                                msg.role === 'tool' ? 'text-orange-400' :
                                'text-green-400'
                              }`}>{msg.role}</span>
                              {msg.tool_call_id && <span className="text-[8px] text-[var(--muted)]">tool_call_id: {msg.tool_call_id}</span>}
                            </div>
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--foreground)] max-h-40 overflow-auto">
                              {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
                            </pre>
                            {msg.tool_calls && (
                              <div className="mt-1 text-[10px] text-orange-400">
                                🔧 Tool calls: {msg.tool_calls.map(tc => tc.function?.name).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {selectedLogDetail.input?.tools?.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[10px] text-[var(--muted)] cursor-pointer hover:text-white">
                            🔧 {t('agent.llmLogs.toolDefs')} ({selectedLogDetail.input.tools.length})
                          </summary>
                          <pre className="mt-1 text-[10px] font-mono text-[var(--muted)] bg-[var(--background)] rounded p-2 max-h-40 overflow-auto">
                            {JSON.stringify(selectedLogDetail.input.tools, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>

                    {/* Output - Response */}
                    <div className="p-3">
                      <h5 className="text-xs font-bold text-blue-400 mb-2">📤 {t('agent.llmLogs.output')}</h5>
                      {selectedLogDetail.error ? (
                        <div className="bg-red-900/15 border border-red-500/10 rounded-lg p-2 text-xs text-red-400">
                          ❌ {selectedLogDetail.error}
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--foreground)] bg-blue-900/10 border border-blue-500/10 rounded-lg p-2 max-h-60 overflow-auto">
                          {typeof selectedLogDetail.output === 'string'
                            ? selectedLogDetail.output
                            : JSON.stringify(selectedLogDetail.output, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="p-3 bg-[var(--background)]">
                      <div className="flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
                        <span>🏷 {selectedLogDetail.providerId}</span>
                        <span>🧠 {selectedLogDetail.model}</span>
                        <span>⏱ {selectedLogDetail.latency}ms</span>
                        {selectedLogDetail.usage?.total_tokens && <span>🔢 {selectedLogDetail.usage.total_tokens} tokens</span>}
                        {selectedLogDetail.options?.temperature !== undefined && <span>🌡 temp={selectedLogDetail.options.temperature}</span>}
                        {selectedLogDetail.options?.hasTools && <span>🔧 {selectedLogDetail.options.toolCount} tools</span>}
                        {selectedLogDetail.streamed && <span>📡 streamed</span>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center text-[var(--muted)] text-xs">{t('agent.llmLogs.loadError')}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
