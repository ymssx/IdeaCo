/**
 * 客户端状态管理 - Zustand
 * 资本的血泪都在这里流转
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
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

/**
 * 将公司数据中所有头像 URL 转换为本地代理 URL
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
  // === 公司状态 ===
  company: null,
  initialized: false,
  loading: false,
  error: null,
  activeTab: 'overview',
  chatOpen: false,

  // === 招聘方案 ===
  pendingPlan: null, // 当前待审批的招聘方案

  setActiveTab: (tab) => set({ activeTab: tab }),
  setChatOpen: (open) => set({ chatOpen: open }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setPendingPlan: (plan) => set({ pendingPlan: plan }),

  // === 需求详情页导航 ===
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

  // === 公司操作 ===
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

  // === 供应商操作 ===
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

  // === 部门操作（两步流程） ===
  // 第一步：获取招聘方案
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

  // 第二步：确认方案，开始招人
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

  // === 部门调整（两步流程） ===
  // 第一步：获取调整方案
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

  // 第二步：确认调整
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

  // 解散部门
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

  // === 员工操作 ===
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

  // === 人才市场 ===
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

  // === 与秘书聊天 ===
  chatWithSecretary: async (message) => {
    try {
      const data = await apiCall('/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      await get().fetchCompany();

      // 如果有任务正在执行，启动轮询
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

  // === 任务状态轮询 ===
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
          // 刷新公司状态以获取最新邮件和数据
          await get().fetchCompany();
          return; // 停止轮询
        } else if (state.status === 'failed') {
          set({ taskResult: { error: state.error }, runningTaskId: null });
          return; // 停止轮询
        }

        // 还在执行中，继续轮询
        setTimeout(poll, 3000);
      } catch {
        // 轮询失败，重试
        setTimeout(poll, 5000);
      }
    };

    // 首次延迟5秒后开始轮询（给任务一些执行时间）
    setTimeout(poll, 5000);
  },

  clearTaskResult: () => set({ taskResult: null, runningTaskId: null }),

  // === 秘书设置 ===
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

  // === 邮箱 ===
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
      // 本地更新已读状态
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

  // === 消息 ===
  fetchMessages: async (limit = 20) => {
    try {
      const data = await apiCall(`/messages?limit=${limit}`);
      return data.data;
    } catch (e) {
      return [];
    }
  },

  // === 工作空间 ===
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

  // === 需求管理 ===
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

  // === 需求操作 ===
  deleteRequirement: async (id) => {
    try {
      await apiCall(`/requirements?id=${id}`, { method: 'DELETE' });
      // 如果当前正在查看这个需求，跳回列表
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
      // 如果有新的需求ID，导航到新需求
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
