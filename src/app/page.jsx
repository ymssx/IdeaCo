'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import SetupWizard from '@/components/SetupWizard';
import Sidebar from '@/components/Sidebar';
import Overview from '@/components/Overview';
import DepartmentView from '@/components/DepartmentView';
import DepartmentDetail from '@/components/DepartmentDetail';
import Mailbox from '@/components/Mailbox';
import MessagesView from '@/components/MessagesView';
import RequirementsBoard from '@/components/RequirementsBoard';
import RequirementDetail from '@/components/RequirementDetail';
import ChatPanel from '@/components/ChatPanel';

export default function Home() {
  const { company, initialized, activeTab, fetchCompany, error, clearError } = useStore();
  const { t } = useI18n();

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  // Initialization request not yet complete, show loading screen instead of SetupWizard
  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="text-6xl mb-4">🏢</div>
          <p className="text-[var(--muted)]">{t('loadingScreen.text')}</p>
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
      case 'department-detail': return <DepartmentDetail />;
      case 'mailbox': return <Mailbox />;
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
