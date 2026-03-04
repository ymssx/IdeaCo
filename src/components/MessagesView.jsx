'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';

const TYPE_COLORS = {
  task: 'text-blue-400 bg-blue-900/20',
  report: 'text-green-400 bg-green-900/20',
  question: 'text-yellow-400 bg-yellow-900/20',
  review: 'text-purple-400 bg-purple-900/20',
  feedback: 'text-orange-400 bg-orange-900/20',
  broadcast: 'text-cyan-400 bg-cyan-900/20',
};

export default function MessagesView() {
  const { t } = useI18n();
  const { company, fetchMessages } = useStore();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const msgs = await fetchMessages(50);
    setMessages(msgs || []);
    setLoading(false);
  }, [fetchMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Build agentId -> name mapping
  const agentNameMap = {};
  if (company) {
    for (const dept of company.departments) {
      for (const m of dept.members) {
        agentNameMap[m.id] = m.name;
      }
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('messages.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t('messages.subtitle')}</p>
        </div>
        <button onClick={loadMessages} className="btn-secondary text-sm" disabled={loading}>
          {t('messages.refresh')}
        </button>
      </div>

      {/* Statistics */}
      {company?.messageBusStats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <div className="text-2xl font-bold text-[var(--accent)]">{company.messageBusStats.totalMessages}</div>
            <div className="text-xs text-[var(--muted)]">{t('messages.totalMessages')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-green-400">{company.messageBusStats.activeAgents || 0}</div>
            <div className="text-xs text-[var(--muted)]">{t('messages.activeAgents')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-purple-400">
              {Object.keys(company.messageBusStats.byType || {}).length}
            </div>
            <div className="text-xs text-[var(--muted)]">{t('messages.messageTypes')}</div>
          </div>
        </div>
      )}

      {/* Message list */}
      {loading ? (
        <div className="text-center py-8 text-[var(--muted)]">{t('common.loading')}</div>
      ) : messages.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">💬</div>
          <p>{t('messages.noRecords')}</p>
          <p className="text-sm mt-1">{t('messages.noRecordsHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.slice().reverse().map((msg) => (
            <div key={msg.id} className="card py-3 flex items-start gap-3">
              <div className={`text-xs px-2 py-0.5 rounded shrink-0 ${TYPE_COLORS[msg.type] || 'text-gray-400 bg-gray-900/20'}`}>
                {msg.type}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="font-medium text-[var(--accent)]">
                    {agentNameMap[msg.from] || msg.from?.slice(0, 8) || '?'}
                  </span>
                  <span className="text-[var(--muted)]"> → </span>
                  <span className="font-medium text-green-400">
                    {agentNameMap[msg.to] || msg.to?.slice(0, 8) || t('messages.broadcast')}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted)] mt-1 break-all">{msg.content}</div>
              </div>
              <div className="text-[10px] text-[var(--muted)] shrink-0">
                {msg.timestamp && new Date(msg.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
