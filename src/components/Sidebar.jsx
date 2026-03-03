'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import SecretarySettings from './SecretarySettings';

const NAV_ITEMS = [
  { id: 'overview', label: '仪表盘', icon: '📊' },
  { id: 'requirements', label: '需求看板', icon: '📋' },
  { id: 'departments', label: '公司架构', icon: '🏢' },
  { id: 'mailbox', label: '消息', icon: '💬' },
  { id: 'talent-market', label: '人才菜市场', icon: '🏣' },
  { id: 'providers', label: '大脑供应商', icon: '⚡' },
  // { id: 'messages', label: '窃听器', icon: '🔍' }, // 暂时隐藏，后续扩展
];
export default function Sidebar() {
  const { company, activeTab, setActiveTab, setChatOpen, chatOpen } = useStore();
  const [showSettings, setShowSettings] = useState(false);

  if (!company) return null;

  const deptCount = company.departments?.length || 0;
  const agentCount = company.departments?.reduce((s, d) => s + d.members.length, 0) || 0;
  const talentCount = company.talentMarket?.length || 0;
  const budget = company.budget || {};
  const unreadMail = company.unreadMailCount || 0;

  return (
    <aside className="w-64 bg-[#0d0d0d] border-r border-[var(--border)] flex flex-col h-screen">
      {/* 公司名称 - 左上角 */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-lg font-bold">
            {company.name.charAt(0)}
          </div>
          <div>
            <div className="font-semibold text-sm truncate">{company.name}</div>
            <div className="text-xs text-[var(--muted)]">👤 {company.boss}</div>
          </div>
        </div>
      </div>

      {/* 秘书信息 - 可点击打开聊天 */}
      <div className="mx-3 mt-3 rounded-lg bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/20">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full p-3 hover:bg-white/5 transition-all text-left rounded-t-lg"
        >
          <div className="flex items-center gap-2">
            <img
              src={company.secretary?.avatar || getAvatarUrl('secretary', 'bottts')}
              alt="秘书"
              className="w-8 h-8 rounded-full bg-[var(--card)]"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium flex items-center gap-1">
                {company.secretary?.name || '小秘'}
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />
              </div>
              <div className="text-[10px] text-[var(--muted)] truncate">
                点击对话 · {company.secretary?.provider}
              </div>
            </div>
            <span className="text-sm">💬</span>
          </div>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="w-full text-[10px] text-[var(--muted)] hover:text-[var(--accent)] py-1.5 border-t border-white/[0.06] transition-all hover:bg-white/5 rounded-b-lg"
        >
          ⚙️ 秘书设置 · 洗脑话术
        </button>
      </div>

      {/* 预算概览 */}
      <div className="px-3 mt-3">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-2.5">
          <div className="text-[10px] text-[var(--muted)] mb-1.5">💰 预算消耗</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-green-400">${budget.totalCost?.toFixed(4) || '0.00'}</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-1">
            Token: {(budget.totalTokens || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          let badge = null;
          if (item.id === 'departments') badge = deptCount;
          if (item.id === 'requirements') badge = company.requirements?.length || 0;
          if (item.id === 'talent-market') badge = talentCount;
          if (item.id === 'mailbox') badge = unreadMail;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive || (item.id === 'requirements' && activeTab === 'requirement-detail')
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/5'
              }`}
            >
              <span>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/10 text-[var(--muted)]'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部统计 */}
      <div className="p-4 border-t border-[var(--border)]">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-[var(--accent)]">{deptCount}</div>
            <div className="text-[10px] text-[var(--muted)]">部门</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-400">{agentCount}</div>
            <div className="text-[10px] text-[var(--muted)]">苦力</div>
          </div>
          <div>
            <div className="text-lg font-bold text-yellow-400">{talentCount}</div>
            <div className="text-[10px] text-[var(--muted)]">待榨</div>
          </div>
        </div>
      </div>

      {/* 秘书设置弹窗 */}
      {showSettings && <SecretarySettings onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
