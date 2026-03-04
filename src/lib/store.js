/**
 * Global State Management - Server-side Singleton
 * Shares Company instance across Next.js API Routes
 * 
 * Persistence:
 * - Auto-restores from data/company-state.json on startup
 * - Auto-saves to disk on state changes
 * - Uses globalThis to prevent state loss during hot reload
 */
import { loadState, saveState, clearState } from '@/core/persistence.js';
import { Company } from '@/core/index.js';
import { initPluginRuntime } from '@/core/plugin.js';
import { sessionManager } from '@/core/session.js';
import { cronScheduler } from '@/core/cron.js';
import { knowledgeManager } from '@/core/knowledge.js';
import { llmClient } from '@/core/llm-client.js';

const globalStore = globalThis;

if (!globalStore.__aiEnterprise) {
  globalStore.__aiEnterprise = {
    company: null,
    loaded: false,
  };

  // 初始化插件运行时：将真实单例注入插件系统
  initPluginRuntime({
    sessionManager,
    cronScheduler,
    knowledgeManager,
    llmClient,
    messageBus: null, // messageBus 在 Company 创建后才有，延迟注入
  });

  // Try restoring from disk on first startup
  try {
    const savedData = loadState();
    if (savedData) {
      globalStore.__aiEnterprise.company = Company.deserialize(savedData);
      // 恢复后注入 messageBus
      if (globalStore.__aiEnterprise.company?.messageBus) {
        initPluginRuntime({ messageBus: globalStore.__aiEnterprise.company.messageBus });
      }
      console.log('🔄 Company state restored from disk successfully');
    }
  } catch (e) {
    console.error('⚠️ Failed to restore state, starting with empty state:', e.message);
    globalStore.__aiEnterprise.company = null;
  }
  globalStore.__aiEnterprise.loaded = true;
}

export function getCompany() {
  return globalStore.__aiEnterprise.company;
}

export function setCompany(company) {
  globalStore.__aiEnterprise.company = company;
  // 注入 messageBus 到插件运行时（Company 创建后才有）
  if (company && company.messageBus) {
    initPluginRuntime({ messageBus: company.messageBus });
  }
  // Save to disk immediately
  if (company) {
    saveState(company);
  }
}

export function resetCompany() {
  globalStore.__aiEnterprise.company = null;
  clearState();
}
