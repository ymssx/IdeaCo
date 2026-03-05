'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import AgentDetailModal from './AgentDetailModal';
import { useI18n } from '@/lib/i18n';
import CachedAvatar from './CachedAvatar';

/**
 * Tree node - recursive render (clickable for detail)
 */
function TreeNode({ node, allMembers, depth = 0, onClickAgent }) {
  const subs = allMembers.filter(m => m.reportsTo === node.id);

  return (
    <div className="flex flex-col items-center">
      {/* Node */}
      <div
        onClick={() => onClickAgent?.(node.id)}
        className={`flex flex-col items-center p-3 rounded-xl border transition-all hover:scale-105 cursor-pointer ${
          depth === 0
            ? 'bg-gradient-to-br from-red-900/30 to-orange-900/20 border-red-500/30 shadow-lg shadow-red-500/10'
            : depth === 1
            ? 'bg-gradient-to-br from-blue-900/20 to-indigo-900/20 border-blue-500/20'
            : 'bg-[var(--card)] border-[var(--border)]'
        }`}
      >
        <CachedAvatar src={node.avatar} alt={node.name} className="w-12 h-12 rounded-full bg-[var(--border)] mb-1" />
        <div className="text-sm font-medium text-center">{node.name}</div>
        <div className="text-[10px] text-[var(--muted)]">
          {node.gender === 'female' ? '👩' : '👨'}{node.age ? ` ${node.age}` : ''} · {node.role}
        </div>
        <div className="text-[10px] text-[var(--muted)] italic mt-0.5 max-w-[120px] truncate text-center" title={node.signature}>
          "{node.signature}"
        </div>
        {node.tokenUsage?.totalCost > 0 && (
          <div className="text-[10px] text-red-400 mt-0.5">🔥 ${node.tokenUsage.totalCost.toFixed(4)}</div>
        )}
      </div>

      {/* Subordinate connections and child nodes */}
      {subs.length > 0 && (
        <>
          <div className="w-px h-6 bg-[var(--border)]" />
          <div className="flex gap-6 relative">
            {/* Horizontal connector */}
            {subs.length > 1 && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px bg-[var(--border)]"
                style={{ width: `calc(100% - 60px)` }} />
            )}
            {subs.map(sub => (
              <div key={sub.id} className="flex flex-col items-center">
                <div className="w-px h-4 bg-[var(--border)]" />
                <TreeNode node={sub} allMembers={allMembers} depth={depth + 1} onClickAgent={onClickAgent} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function OrgTree({ embedded = false }) {
  const { t } = useI18n();
  const { company } = useStore();
  const [selectedAgent, setSelectedAgent] = useState(null);

  if (!company) return null;

  return (
    <div className={`${embedded ? 'p-4' : 'p-6 space-y-6'} animate-fade-in`}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">{t('orgTree.title')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t('orgTree.subtitle')}</p>
        </div>
      )}

      {/* Company level */}
      <div className="flex flex-col items-center">
        {/* Boss */}
        <div className="flex flex-col items-center p-4 rounded-xl bg-gradient-to-br from-yellow-900/30 to-red-900/20 border border-yellow-500/30 shadow-lg shadow-yellow-500/10 mb-2">
          {company.bossAvatar ? (
            <CachedAvatar src={company.bossAvatar} alt="boss" className="w-12 h-12 rounded-full bg-[var(--border)] mb-1" />
          ) : (
            <div className="text-3xl mb-1">👑</div>
          )}
          <div className="text-sm font-bold">{company.boss}</div>
          <div className="text-[10px] text-yellow-400">{t('orgTree.boss')}</div>
        </div>
        <div className="w-px h-6 bg-[var(--border)]" />

        {/* Secretary */}
        <div className="flex flex-col items-center p-3 rounded-xl bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/20 mb-2">
          <CachedAvatar src={company.secretary?.avatar} alt="secretary" className="w-10 h-10 rounded-full bg-[var(--border)] mb-1" />
          <div className="text-sm font-medium">{company.secretary?.name}</div>
          <div className="text-[10px] text-purple-400">
{company.secretary?.gender === 'female' ? '👩' : '👨'}{company.secretary?.age ? ` ${t('display.ageYears', { n: company.secretary.age })}` : ''} · {t('orgTree.secretary')}
          </div>
        </div>
        <div className="w-px h-6 bg-[var(--border)]" />

        {/* Departments */}
        {company.departments?.length > 0 ? (
          <div className="flex gap-12 flex-wrap justify-center">
            {company.departments.map(dept => {
              // Find department leader (top-level node)
              const leader = dept.members.find(m => m.id === dept.leader);
              const others = dept.members.filter(m => !m.reportsTo && m.id !== dept.leader);

              return (
                <div key={dept.id} className="flex flex-col items-center">
                  <div className="text-xs text-[var(--muted)] mb-2 px-3 py-1 rounded-full bg-[var(--card)] border border-[var(--border)]">
                    🏭 {dept.name}
                  </div>
                  <div className="w-px h-4 bg-[var(--border)]" />

                  {leader ? (
                    <TreeNode node={leader} allMembers={dept.members} depth={0} onClickAgent={setSelectedAgent} />
                  ) : (
                    <div className="text-sm text-[var(--muted)]">{t('orgTree.noLeader')}</div>
                  )}

                  {/* Non-leader members without a superior */}
                  {others.length > 0 && (
                    <div className="flex gap-4 mt-4">
                      {others.map(m => (
                        <TreeNode key={m.id} node={m} allMembers={dept.members} depth={1} onClickAgent={setSelectedAgent} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card text-center py-8 text-[var(--muted)]">
            <div className="text-4xl mb-3">🕳️</div>
            <p>{t('orgTree.empty')}</p>
          </div>
        )}
      </div>

      {/* Agent detail modal */}
      {selectedAgent && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
