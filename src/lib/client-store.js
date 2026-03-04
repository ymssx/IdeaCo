/**
 * Client-side state management - Zustand
 * Where the blood and tears of capital flow
 */
import { create } from 'zustand';
import { normalizeAvatarUrl } from '@/lib/avatar';

const API_BASE = '/api';

async function apiCall(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Convert all avatar URLs in company data to local proxy URLs
 */
function normalizeCompanyAvatars(company) {
  if (!company) return company;
  if (company.secretary?.avatar) {
    company.secretary.avatar = normalizeAvatarUrl(company.secretary.avatar);
  }
  if (company.departments) {
    for (const dept of company.departments) {
      if (dept.members) {
        for (const m of dept.members) {
          if (m.avatar) m.avatar = normalizeAvatarUrl(m.avatar);
        }
      }
    }
  }
  if (company.talentMarket) {
    for (const t of company.talentMarket) {
      if (t.avatar) t.avatar = normalizeAvatarUrl(t.avatar);
    }
  }
  if (company.mailbox) {
    for (const mail of company.mailbox) {
      if (mail.from?.avatar) mail.from.avatar = normalizeAvatarUrl(mail.from.avatar);
    }
  }
  return company;
}

export const useStore = create((set, get) => ({
  // === Company State ===
  company: null,
  initialized: false,
  loading: false,
  error: null,
  activeTab: 'overview',
  chatOpen: false,

  // === Recruitment Plan ===
  pendingPlan: null, // Current pending recruitment plan

  setActiveTab: (tab) => set({ activeTab: tab }),
  setChatOpen: (open) => set({ chatOpen: open }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setPendingPlan: (plan) => set({ pendingPlan: plan }),

  // === Requirement Detail Navigation ===
  previousTab: null,
  navigateToRequirement: (id) => {
    const { activeTab } = get();
    set({
      previousTab: activeTab === 'requirement-detail' ? get().previousTab : activeTab,
      activeTab: 'requirement-detail',
      activeRequirementId: id,
    });
  },
  navigateBack: () => {
    const { previousTab } = get();
    set({
      activeTab: previousTab || 'requirements',
      activeRequirementId: null,
      requirementDetail: null,
      previousTab: null,
    });
  },

  // === Company Operations ===
  fetchCompany: async () => {
    try {
      const data = await apiCall('/company');
      set({ company: normalizeCompanyAvatars(data.data), initialized: true });
    } catch (e) {
      set({ error: e.message, initialized: true });
    }
  },

  createCompany: async (companyName, bossName, secretaryConfig) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/company', {
        method: 'POST',
        body: JSON.stringify({ companyName, bossName, secretaryConfig }),
      });
      set({ company: normalizeCompanyAvatars(data.data), loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // === Provider Operations ===
  configureProvider: async (providerId, apiKey) => {
    try {
      await apiCall(`/providers/${providerId}/configure`, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
      await get().fetchCompany();
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Department Operations (two-step flow) ===
  // Step 1: Get recruitment plan
  planDepartment: async (name, mission) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/departments', {
        method: 'POST',
        body: JSON.stringify({ name, mission }),
      });
      set({ pendingPlan: data.data, loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // Step 2: Confirm plan, start recruiting
  confirmPlan: async (planId) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/departments?action=confirm', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      set({ company: normalizeCompanyAvatars(data.data), loading: false, pendingPlan: null });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // === Department Adjustment (two-step flow) ===
  // Step 1: Get adjustment plan
  planAdjustment: async (departmentId, adjustGoal) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/departments?action=adjust', {
        method: 'POST',
        body: JSON.stringify({ departmentId, adjustGoal }),
      });
      set({ pendingPlan: { ...data.data, type: 'adjustment' }, loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // Step 2: Confirm adjustment
  confirmAdjustment: async (planId) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/departments?action=confirmAdjust', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      set({ company: normalizeCompanyAvatars(data.data), loading: false, pendingPlan: null });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // Disband department
  disbandDepartment: async (departmentId, reason) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/departments?action=disband', {
        method: 'POST',
        body: JSON.stringify({ departmentId, reason }),
      });
      set({ company: normalizeCompanyAvatars(data.data), loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // === Employee Operations ===
  dismissAgent: async (deptId, agentId, reason) => {
    try {
      const data = await apiCall(`/departments/${deptId}/agents/${agentId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      set({ company: normalizeCompanyAvatars(data.data) });
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  fetchAgentDetail: async (agentId) => {
    try {
      const data = await apiCall(`/agents/${agentId}`);
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Talent Market ===
  recallAgent: async (profileId, departmentId, newSkills) => {
    try {
      const data = await apiCall(`/talent-market/${profileId}/recall`, {
        method: 'POST',
        body: JSON.stringify({ departmentId, newSkills }),
      });
      set({ company: normalizeCompanyAvatars(data.data) });
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  deleteTalent: async (profileId) => {
    try {
      const data = await apiCall(`/talent-market/${profileId}`, {
        method: 'DELETE',
      });
      set({ company: normalizeCompanyAvatars(data.data) });
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Chat with Secretary ===
  chatWithSecretary: async (message) => {
    try {
      const data = await apiCall('/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      await get().fetchCompany();

      // If a task is running, start polling
      const reply = data.data?.reply;
      if (reply?.action?.taskId && reply?.action?.taskStatus === 'running') {
        get()._pollTaskStatus(reply.action.taskId);
      }

      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Task Status Polling ===
  runningTaskId: null,
  taskResult: null,

  _pollTaskStatus: (taskId) => {
    set({ runningTaskId: taskId, taskResult: null });

    const poll = async () => {
      try {
        const data = await apiCall(`/chat?taskId=${taskId}`);
        const state = data.data;

        if (state.status === 'completed') {
          set({ taskResult: state.summary, runningTaskId: null });
          // Refresh company state to get latest mail and data
          await get().fetchCompany();
          return; // Stop polling
        } else if (state.status === 'failed') {
          set({ taskResult: { error: state.error }, runningTaskId: null });
          return; // Stop polling
        }

        // Still running, continue polling
        setTimeout(poll, 3000);
      } catch {
        // Polling failed, retry
        setTimeout(poll, 5000);
      }
    };

    // Initial 5-second delay before polling (give the task some execution time)
    setTimeout(poll, 5000);
  },

  clearTaskResult: () => set({ taskResult: null, runningTaskId: null }),

  // === Cron Jobs ===
  fetchCronJobs: async () => {
    try {
      const data = await apiCall('/system/cron');
      return data.data;
    } catch (e) {
      return { summary: {}, jobs: [] };
    }
  },

  createCronJob: async (config) => {
    try {
      const data = await apiCall('/system/cron', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', ...config }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  manageCronJob: async (action, jobId) => {
    try {
      const data = await apiCall('/system/cron', {
        method: 'POST',
        body: JSON.stringify({ action, jobId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Plugins ===
  fetchPlugins: async () => {
    try {
      const data = await apiCall('/system/plugins');
      return data.data;
    } catch (e) {
      return [];
    }
  },

  managePlugin: async (action, pluginId) => {
    try {
      const data = await apiCall('/system/plugins', {
        method: 'POST',
        body: JSON.stringify({ action, pluginId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Skills ===
  fetchSkills: async () => {
    try {
      const data = await apiCall('/system/skills');
      return data.data;
    } catch (e) {
      return [];
    }
  },

  manageSkill: async (action, skillId, config) => {
    try {
      const data = await apiCall('/system/skills', {
        method: 'POST',
        body: JSON.stringify({ action, skillId, config }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Knowledge Base ===
  fetchKnowledge: async () => {
    try {
      const data = await apiCall('/system/knowledge');
      return data.data;
    } catch (e) {
      return { bases: [], stats: {} };
    }
  },

  searchKnowledge: async (query) => {
    try {
      const data = await apiCall(`/system/knowledge?query=${encodeURIComponent(query)}`);
      return data.data;
    } catch (e) {
      return [];
    }
  },

  manageKnowledge: async (action, payload) => {
    try {
      const data = await apiCall('/system/knowledge', {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === System Status ===
  fetchSystemStatus: async () => {
    try {
      const data = await apiCall('/system/status');
      return data.data;
    } catch (e) {
      return null;
    }
  },

  // === Secretary Settings ===
  updateSecretarySettings: async (settings) => {
    try {
      const data = await apiCall('/secretary', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      if (data.fullState) {
        set({ company: normalizeCompanyAvatars(data.fullState) });
      } else {
        await get().fetchCompany();
      }
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === Mailbox ===
  replyMail: async (mailId, content) => {
    try {
      const data = await apiCall('/mailbox', {
        method: 'POST',
        body: JSON.stringify({ action: 'reply', mailId, content }),
      });
      await get().fetchCompany();
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  markMailRead: async (mailId) => {
    try {
      await apiCall('/mailbox', {
        method: 'POST',
        body: JSON.stringify({ action: 'read', mailId }),
      });
      // Locally update read status
      const { company } = get();
      if (company?.mailbox) {
        const mail = company.mailbox.find(m => m.id === mailId);
        if (mail) mail.read = true;
        set({ company: { ...company } });
      }
    } catch (e) { /* ignore */ }
  },

  markAllMailRead: async () => {
    try {
      await apiCall('/mailbox', {
        method: 'POST',
        body: JSON.stringify({ action: 'readAll' }),
      });
      await get().fetchCompany();
    } catch (e) { /* ignore */ }
  },

  // === Messages ===
  fetchMessages: async (limit = 20) => {
    try {
      const data = await apiCall(`/messages?limit=${limit}`);
      return data.data;
    } catch (e) {
      return [];
    }
  },

  // === Workspace ===
  fetchWorkspaceFiles: async (departmentId) => {
    try {
      const data = await apiCall(`/workspace/${departmentId}/files`);
      return data.data;
    } catch (e) {
      return [];
    }
  },

  fetchWorkspaceFile: async (departmentId, filePath) => {
    try {
      const data = await apiCall(`/workspace/${departmentId}/file?path=${encodeURIComponent(filePath)}`);
      return data.data;
    } catch (e) {
      return null;
    }
  },

  // === Requirement Management ===
  activeRequirementId: null,
  requirementDetail: null,

  setActiveRequirement: (id) => set({ activeRequirementId: id }),

  fetchRequirements: async () => {
    try {
      const data = await apiCall('/requirements');
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  fetchRequirementDetail: async (id) => {
    try {
      const data = await apiCall(`/requirements?id=${id}`);
      set({ requirementDetail: data.data, activeRequirementId: id });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      return null;
    }
  },

  fetchDepartmentRequirements: async (departmentId) => {
    try {
      const data = await apiCall(`/requirements?departmentId=${departmentId}`);
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  // === Requirement Operations ===
  deleteRequirement: async (id) => {
    try {
      await apiCall(`/requirements?id=${id}`, { method: 'DELETE' });
      // If currently viewing this requirement, navigate back to list
      const { activeRequirementId } = get();
      if (activeRequirementId === id) {
        get().navigateBack();
      }
      return true;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  restartRequirement: async (id) => {
    try {
      const data = await apiCall('/requirements', {
        method: 'POST',
        body: JSON.stringify({ action: 'restart', id }),
      });
      // If there's a new requirement ID, navigate to the new requirement
      if (data.data?.newId) {
        set({ activeRequirementId: data.data.newId, requirementDetail: null });
        await get().fetchRequirementDetail(data.data.newId);
      }
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  clearRequirementDetail: () => set({ requirementDetail: null }),
}));
