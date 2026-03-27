/**
 * Global State Management - Server-side Singleton
 * Shares Company instance across Next.js API Routes
 * 
 * Persistence:
 * - Auto-restores from data/company-state.json on startup
 * - Auto-saves to disk on state changes
 * - Uses globalThis to prevent state loss during hot reload
 */
import { loadState, saveState, clearState } from '@/core/organization/persistence.js';
import { Company } from '@/core/index.js';
import { initPluginRuntime } from '@/core/system/plugin.js';
import { sessionManager } from '@/core/agent/session.js';
import { cronScheduler } from '@/core/system/cron.js';
import { knowledgeManager } from '@/core/employee/knowledge.js';
import { llmClient } from '@/core/agent/llm-agent/client.js';
import { unbindCompanyLanguageSource } from '@/core/utils/app-language.js';

const globalStore = globalThis;

if (!globalStore.__aiEnterprise) {
  globalStore.__aiEnterprise = {
    company: null,
    loaded: false,
  };

  // Initialize plugin runtime: inject real singletons into the plugin system
  initPluginRuntime({
    sessionManager,
    cronScheduler,
    knowledgeManager,
    llmClient,
    messageBus: null, // messageBus is created after Company, injected lazily
  });

  // Try restoring from disk on first startup
  try {
    const savedData = loadState();
    if (savedData) {
      globalStore.__aiEnterprise.company = Company.deserialize(savedData);
      // Inject messageBus after restoration
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
} else if (process.env.NODE_ENV === 'development') {
  // HMR guard: module re-evaluated but globalThis still holds the company.
  // Just log a short notice instead of re-initializing everything.
  console.log('🔄 [HMR] store.js re-evaluated, company instance preserved');
}

export function getCompany() {
  return globalStore.__aiEnterprise.company;
}

export function setCompany(company) {
  globalStore.__aiEnterprise.company = company;
  // Inject messageBus into plugin runtime (only available after Company is created)
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
  unbindCompanyLanguageSource();
  clearState();
}
