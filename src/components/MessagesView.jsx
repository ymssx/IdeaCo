'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';

const TYPE_COLORS = {
  task: 'text-blue-400 bg-blue-900/20',
  report: 'text-green-400 bg-green-900/20',
  question: 'text-yellow-400 bg-yellow-900/20',
  review: 'text-purple-400 bg-purple-900/20',
  feedback: 'text-orange-400 bg-orange-900/20',
  broadcast: 'text-cyan-400 bg-cyan-900/20',
};

export default function MessagesView() {
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

  // 建立 agentId -> name 映射
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
          <h1 className="text-2xl font-bold">💬 通信日志</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Agent之间的消息通信记录</p>
        </div>
        <button onClick={loadMessages} className="btn-secondary text-sm" disabled={loading}>
          🔄 刷新
        </button>
      </div>

      {/* 统计 */}
      {company?.messageBusStats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <div className="text-2xl font-bold text-[var(--accent)]">{company.messageBusStats.totalMessages}</div>
            <div className="text-xs text-[var(--muted)]">总消息数</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-green-400">{company.messageBusStats.activeAgents || 0}</div>
            <div className="text-xs text-[var(--muted)]">活跃Agent</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-purple-400">
              {Object.keys(company.messageBusStats.byType || {}).length}
            </div>
            <div className="text-xs text-[var(--muted)]">消息类型</div>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      {loading ? (
        <div className="text-center py-8 text-[var(--muted)]">加载中...</div>
      ) : messages.length === 0 ? (
        <div className="card text-center py-12 text-[var(--muted)]">
          <div className="text-5xl mb-4">💬</div>
          <p>暂无通信记录</p>
          <p className="text-sm mt-1">Agent执行任务时会自动产生通信消息</p>
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
                    {agentNameMap[msg.to] || msg.to?.slice(0, 8) || '广播'}
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
