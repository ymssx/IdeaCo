'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import SetupWizard from '@/components/SetupWizard';
import Sidebar from '@/components/Sidebar';
import Overview from '@/components/Overview';
import DepartmentView from '@/components/DepartmentView';
import Mailbox from '@/components/Mailbox';
import TalentMarket from '@/components/TalentMarket';
import ProvidersBoard from '@/components/ProvidersBoard';
import MessagesView from '@/components/MessagesView';
import RequirementsBoard from '@/components/RequirementsBoard';
import RequirementDetail from '@/components/RequirementDetail';
import ChatPanel from '@/components/ChatPanel';

export default function Home() {
  const { company, initialized, activeTab, fetchCompany, error, clearError } = useStore();

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  // 尚未完成初始化请求，显示加载画面而非 SetupWizard
  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="text-6xl mb-4">🏢</div>
          <p className="text-[var(--muted)]">加载中...</p>
        </div>
      </div>
    );
  }

  if (!company) {
    return <SetupWizard />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return <Overview />;
      case 'requirements': return <RequirementsBoard />;
      case 'requirement-detail': return <RequirementDetail />;
      case 'departments': return <DepartmentView />;
      case 'mailbox': return <Mailbox />;
      case 'talent-market': return <TalentMarket />;
      case 'providers': return <ProvidersBoard />;
      case 'messages': return <MessagesView />;
      default: return <Overview />;
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto relative">
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 text-red-300 px-4 py-3 m-4 rounded-lg flex justify-between items-center animate-fade-in">
            <span>💀 {error}</span>
            <button onClick={clearError} className="text-red-300 hover:text-red-100 ml-4">✕</button>
          </div>
        )}
        {renderContent()}
      </main>
      <ChatPanel />
    </div>
  );
}
