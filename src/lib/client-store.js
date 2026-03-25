/**
 * Client-side state management - Zustand
 * Where the blood and tears of capital flow
 */
import { create } from 'zustand';
import { normalizeAvatarUrl } from '@/lib/avatar';

const API_BASE = '/api';

/**
 * Get the current user language for API requests.
 * Reads from localStorage (set by the i18n provider).
 */
function getCurrentLang() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('idea-unlimited-lang')) || 'en';
  } catch {
    return 'en';
  }
}

async function apiCall(url, options = {}) {
  const lang = getCurrentLang();
  // Destructure headers out of options so we can merge them without
  // accidentally overwriting Content-Type or X-App-Lang.
  const { headers: callerHeaders, ...restOptions } = options;
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-App-Lang': lang,
      ...callerHeaders,
    },
    ...restOptions,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server error (${res.status}): invalid response`);
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Convert all avatar URLs in company data to local proxy URLs
 */
function normalizeCompanyAvatars(company) {
  if (!company) return company;
  if (company.bossAvatar) {
    company.bossAvatar = normalizeAvatarUrl(company.bossAvatar);
  }
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
  if (company.agentChatSessions) {
    for (const session of company.agentChatSessions) {
      if (session.agentAvatar) session.agentAvatar = normalizeAvatarUrl(session.agentAvatar);
    }
  }
  return company;
}

/**
 * Attempt to refresh ChatGPT cookie via Electron IPC.
 * Called when a "session expired" error is detected from web provider.
 * Returns true if cookie was refreshed successfully.
 */
async function tryRefreshChatGPTCookie() {
  if (typeof window === 'undefined' || !window.electronAPI?.refreshChatGPTCookie) {
    return false;
  }
  try {
    console.log('[cookie-refresh] Attempting to refresh ChatGPT cookie via Electron...');
    const result = await window.electronAPI.refreshChatGPTCookie();
    if (result.ok && result.cookie) {
      // Find the web-chatgpt provider and update its cookie on the server
      await apiCall('/providers/web-chatgpt-4o/refresh-cookie', {
        method: 'POST',
        body: JSON.stringify({ cookie: result.cookie }),
      });
      console.log('[cookie-refresh] Cookie refreshed successfully');
      return true;
    }
    console.warn('[cookie-refresh] Refresh failed:', result.error);
    return false;
  } catch (e) {
    console.error('[cookie-refresh] Error:', e.message);
    return false;
  }
}

/**
 * Check if an error message indicates ChatGPT session expiry
 */
function isChatGPTSessionExpired(errorMessage) {
  if (!errorMessage) return false;
  return errorMessage.includes('session expired') ||
    errorMessage.includes('re-login and update cookie') ||
    errorMessage.includes('Session expired') ||
    errorMessage.includes('login required');
}

export const useStore = create((set, get) => ({
  // === Company State ===
  company: null,
  initialized: false,
  loading: false,
  error: null,
activeTab: 'requirements',
chatOpen: true,
chatMinimized: false,
chatPanelWidth: 380,

  // === Recruitment Plan ===
  pendingPlan: null, // Current pending recruitment plan

  setActiveTab: (tab) => set({ activeTab: tab }),
  setChatOpen: (open) => set({ chatOpen: open, chatMinimized: false }),
  setChatMinimized: (minimized) => set({ chatMinimized: minimized }),
  setChatPanelWidth: (width) => set({ chatPanelWidth: Math.max(300, Math.min(600, width)) }),
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

  // === Department Detail Navigation ===
  activeDepartmentId: null,
  navigateToDepartment: (deptId) => {
    const { activeTab } = get();
    set({
      previousTab: activeTab === 'department-detail' ? get().previousTab : activeTab,
      activeTab: 'department-detail',
      activeDepartmentId: deptId,
    });
  },
  navigateBackFromDepartment: () => {
    const { previousTab } = get();
    set({
      activeTab: previousTab || 'departments',
      activeDepartmentId: null,
      previousTab: null,
    });
  },

  // === Team Detail Navigation ===
  activeTeamId: null,
  activeSprintId: null,
  navigateToTeam: (teamId) => {
    const { activeTab } = get();
    set({
      previousTab: activeTab === 'team-detail' ? get().previousTab : activeTab,
      activeTab: 'team-detail',
      activeTeamId: teamId,
      activeSprintId: null,
    });
  },
  navigateBackFromTeam: () => {
    const { previousTab } = get();
    set({
      activeTab: previousTab || 'departments',
      activeTeamId: null,
      activeSprintId: null,
      previousTab: null,
    });
  },
  setActiveSprintId: (sprintId) => set({ activeSprintId: sprintId }),

  // === Company Operations ===
  fetchCompany: async () => {
    try {
      const data = await apiCall('/company');
      const newCompany = normalizeCompanyAvatars(data.data);

      // Read current state WITHOUT triggering set()
      const state = get();
      const old = state.company;

      if (!old) {
        set({ company: newCompany, initialized: true });
        return;
      }

      // Shallow-compare key fields to decide if company actually changed.
      // If nothing meaningful changed, skip set() entirely so zustand
      // does NOT notify any subscribers — preventing unnecessary re-renders.
      const chatHistoryChanged = (old.chatHistory?.length ?? 0) !== (newCompany.chatHistory?.length ?? 0);
      const agentSessionsChanged = (old.agentChatSessions?.length ?? 0) !== (newCompany.agentChatSessions?.length ?? 0);
      const deptsChanged = (old.departments?.length ?? 0) !== (newCompany.departments?.length ?? 0);
      const bossChanged = old.boss !== newCompany.boss || old.bossAvatar !== newCompany.bossAvatar;
      const secChanged = old.secretary?.name !== newCompany.secretary?.name
        || old.secretary?.avatar !== newCompany.secretary?.avatar
        || old.secretary?.signature !== newCompany.secretary?.signature;
      const balanceChanged = old.balance !== newCompany.balance;
      const talentChanged = (old.talentMarket?.length ?? 0) !== (newCompany.talentMarket?.length ?? 0);
      const nameChanged = old.name !== newCompany.name;

      // Also check if any department's groupChat or member count changed
      let deptContentChanged = false;
      if (!deptsChanged && old.departments) {
        for (let i = 0; i < old.departments.length; i++) {
          const od = old.departments[i];
          const nd = newCompany.departments?.[i];
          if (!nd || od.id !== nd.id
            || (od.groupChat?.length ?? 0) !== (nd.groupChat?.length ?? 0)
            || (od.members?.length ?? 0) !== (nd.members?.length ?? 0)
            || od.status !== nd.status) {
            deptContentChanged = true;
            break;
          }
        }
      }

      const hasChanges = chatHistoryChanged || agentSessionsChanged || deptsChanged
        || deptContentChanged || bossChanged || secChanged || balanceChanged
        || talentChanged || nameChanged;

      if (!hasChanges) {
        // Nothing meaningful changed — do NOT call set(), no re-render at all
        if (!state.initialized) set({ initialized: true });
        return;
      }

      // Preserve chatHistory reference when messages haven't changed
      if (!chatHistoryChanged && old.chatHistory) {
        newCompany.chatHistory = old.chatHistory;
      }
      set({ company: newCompany, initialized: true });
    } catch (e) {
      set({ error: e.message, initialized: true });
    }
  },

  /**
   * Lightweight poll: fetch only secretary chat history (avoids heavy getFullState).
   * Updates company.chatHistory in-place so Mailbox picks it up via the existing useEffect.
   */
  fetchSecretaryChatHistory: async () => {
    try {
      const data = await apiCall('/chat/history');
      const msgs = data.data;
      if (!msgs) return;
      const state = get();
      if (!state.company) return;
      // Only update if message count actually changed
      if (state.company.chatHistory?.length === msgs.length) return;
      set({ company: { ...state.company, chatHistory: msgs } });
    } catch {
      // Silently ignore — the heavy fetchCompany poll is still running as fallback
    }
  },

  /**
   * Paginated secretary chat: load a page of messages.
   * @param {{ before?: string, limit?: number }} opts
   * @returns {{ messages: Array, hasMore: boolean, total: number }}
   */
  fetchSecretaryChatPage: async ({ before = null, limit = 30 } = {}) => {
    try {
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      params.set('limit', String(limit));
      const data = await apiCall(`/chat/history?${params.toString()}`);
      return {
        messages: data.data || [],
        hasMore: !!data.hasMore,
        total: data.total || 0,
      };
    } catch {
      return { messages: [], hasMore: false, total: 0 };
    }
  },

  /**
   * Lightweight poll: fetch only messages newer than `after` timestamp.
   * Returns an array of new messages (empty if none).
   */
  pollSecretaryNewMessages: async (after) => {
    try {
      const data = await apiCall(`/chat/history?after=${encodeURIComponent(after)}`);
      return data.data || [];
    } catch {
      return [];
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

  // === Factory Reset (nuclear) ===
  factoryReset: async () => {
    set({ loading: true, error: null });
    try {
      await apiCall('/company/factory-reset', { method: 'POST' });
      set({ company: null, loading: false, initialized: true });
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  // === Provider Operations ===
  configureProvider: async (providerId, apiKey, options = {}) => {
    try {
      await apiCall(`/providers/${providerId}/configure`, {
        method: 'POST',
        body: JSON.stringify({ apiKey, ...options }),
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

  updateAgent: async (agentId, updates) => {
    try {
      const data = await apiCall(`/agents/${agentId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      // Refresh global company store so the main dashboard reflects changes
      // (e.g. updated provider name on agent cards)
      get().fetchCompany().catch(() => {});
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

  // === Boss Profile ===
  updateBossProfile: async (settings) => {
    try {
      const data = await apiCall('/company', {
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

  // === Chat with Secretary ===
  chatWithSecretary: async (message) => {
    const attempt = async () => {
      const data = await apiCall('/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      await get().fetchCompany();

      return data.data;
    };

    try {
      return await attempt();
    } catch (e) {
      // Auto-retry once if ChatGPT session expired
      if (isChatGPTSessionExpired(e.message)) {
        const refreshed = await tryRefreshChatGPTCookie();
        if (refreshed) {
          try {
            return await attempt();
          } catch (retryErr) {
            set({ error: retryErr.message });
            throw retryErr;
          }
        }
      }
      set({ error: e.message });
      throw e;
    }
  },

  // === Streaming Chat with Secretary ===
  streamingContent: '',    // Accumulated streamed content text
  streamingThinking: '',   // Accumulated thinking/reasoning text
  streamingToolCalls: [],  // Tool call progress events [{tool, args, status, result?, error?}]
  isStreaming: false,       // Whether a stream is currently active

  chatWithSecretaryStream: async (message, { onDelta, onThinking, onDone, onError } = {}) => {
    set({ streamingContent: '', streamingThinking: '', streamingToolCalls: [], isStreaming: true });
    const lang = getCurrentLang();

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Lang': lang },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        let errMsg = `Server error (${res.status})`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalReply = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete last line in buffer

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === 'delta') {
                if (data.reset) {
                  // Reset streaming content for a new tool-loop iteration
                  set({ streamingContent: '' });
                } else {
                  set(state => ({ streamingContent: state.streamingContent + data.content }));
                  if (onDelta) onDelta(data.content);
                }
              } else if (currentEvent === 'thinking') {
                set(state => ({ streamingThinking: state.streamingThinking + data.content }));
                if (onThinking) onThinking(data.content);
              } else if (currentEvent === 'tool_call') {
                set(state => {
                  const calls = [...state.streamingToolCalls];
                  if (data.status === 'start') {
                    calls.push({ tool: data.tool, args: data.args, status: 'running' });
                  } else {
                    // Update the matching entry (last one with same tool name that is running)
                    let found = false;
                    for (let i = calls.length - 1; i >= 0; i--) {
                      if (calls[i].tool === data.tool && calls[i].status === 'running') {
                        calls[i] = { ...calls[i], status: data.status, result: data.result, error: data.error };
                        found = true;
                        break;
                      }
                    }
                    // If no matching running entry (e.g. _llm_error), add it directly
                    if (!found) {
                      calls.push({ tool: data.tool, args: data.args, status: data.status, result: data.result, error: data.error });
                    }
                  }
                  return { streamingToolCalls: calls };
                });
              } else if (currentEvent === 'done') {
                finalReply = data.reply;
                if (onDone) onDone(data.reply);
              } else if (currentEvent === 'error') {
                if (onError) onError(data.message);
              }
            } catch {}
            currentEvent = null;
          } else if (line === '') {
            currentEvent = null;
          }
        }
      }

      set({ isStreaming: false });

      // Refresh company state to get updated chat history
      await get().fetchCompany();

      return finalReply;
    } catch (e) {
      set({ isStreaming: false, error: e.message });
      if (onError) onError(e.message);
      throw e;
    }
  },

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
  fetchSkills: async (opts = {}) => {
    try {
      const params = new URLSearchParams();
      if (opts.source) params.set('source', opts.source);
      if (opts.category) params.set('category', opts.category);
      if (opts.q) params.set('q', opts.q);
      const qs = params.toString();
      const data = await apiCall(`/system/skills${qs ? `?${qs}` : ''}`);
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

  // Custom skills
  fetchCustomSkills: async () => {
    try {
      const data = await apiCall('/system/skills/custom');
      return data.data;
    } catch (e) {
      return [];
    }
  },

  createCustomSkill: async (markdown) => {
    try {
      const data = await apiCall('/system/skills/custom', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', markdown }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  updateCustomSkill: async (skillId, markdown) => {
    try {
      const data = await apiCall('/system/skills/custom', {
        method: 'POST',
        body: JSON.stringify({ action: 'update', skillId, markdown }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  deleteCustomSkill: async (skillId) => {
    try {
      const data = await apiCall('/system/skills/custom', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', skillId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  getCustomSkillRaw: async (skillId) => {
    try {
      const data = await apiCall('/system/skills/custom', {
        method: 'POST',
        body: JSON.stringify({ action: 'getRaw', skillId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // Marketplace
  searchMarketplace: async (query = '', opts = {}) => {
    try {
      const params = new URLSearchParams({ q: query });
      if (opts.page) params.set('page', String(opts.page));
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.category) params.set('category', opts.category);
      if (opts.featured) params.set('featured', 'true');
      const data = await apiCall(`/system/skills/marketplace?${params}`);
      return data.data;
    } catch (e) {
      return { skills: [], total: 0, page: 1 };
    }
  },

  installMarketplaceSkill: async (slug, version) => {
    try {
      const data = await apiCall('/system/skills/marketplace', {
        method: 'POST',
        body: JSON.stringify({ action: 'install', slug, version }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  uninstallMarketplaceSkill: async (skillId) => {
    try {
      const data = await apiCall('/system/skills/marketplace', {
        method: 'POST',
        body: JSON.stringify({ action: 'uninstall', skillId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  listInstalledMarketplaceSkills: async () => {
    try {
      const data = await apiCall('/system/skills/marketplace', {
        method: 'POST',
        body: JSON.stringify({ action: 'listInstalled' }),
      });
      return data.data;
    } catch (e) {
      return [];
    }
  },

  // Per-agent skill management
  fetchAgentSkills: async (agentId) => {
    try {
      const data = await apiCall(`/agents/${agentId}/skills`);
      return data.data;
    } catch (e) {
      return { enabledSkills: [], pinnedSkills: [], legacySkills: [], allSkills: [] };
    }
  },

  manageAgentSkill: async (agentId, action, skillId, skillIds) => {
    try {
      const data = await apiCall(`/agents/${agentId}/skills`, {
        method: 'POST',
        body: JSON.stringify({ action, skillId, skillIds }),
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

  // === Channels (Multi-channel messaging system) ===
  fetchChannels: async () => {
    try {
      const data = await apiCall('/channels');
      return data.data;
    } catch (e) {
      return { adapters: [], channels: [], stats: {} };
    }
  },

  installChannel: async (adapterId, config = {}) => {
    try {
      const data = await apiCall('/channels', {
        method: 'POST',
        body: JSON.stringify({ adapterId, config }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  manageChannel: async (channelId, action, config = null) => {
    try {
      const body = { action };
      if (config) body.config = config;
      const data = await apiCall(`/channels/${channelId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  uninstallChannel: async (channelId) => {
    try {
      const data = await apiCall(`/channels/${channelId}`, { method: 'DELETE' });
      return data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // === CLI Backends ===
  fetchCLIBackends: async () => {
    try {
      const data = await apiCall('/system/cli-backends');
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  detectCLIBackends: async () => {
    try {
      const data = await apiCall('/system/cli-backends', {
        method: 'POST',
        body: JSON.stringify({ action: 'detect' }),
      });
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  manageCLIBackend: async (action, payload = {}) => {
    try {
      const data = await apiCall('/system/cli-backends', {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
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
  fetchWorkspaceFiles: async (departmentId, subPath = '') => {
    try {
      const query = subPath ? `?path=${encodeURIComponent(subPath)}` : '';
      const data = await apiCall(`/ws-files/${departmentId}/files${query}`);
      return data.data;
    } catch (e) {
      return [];
    }
  },

  fetchWorkspaceFile: async (departmentId, filePath) => {
    try {
      const data = await apiCall(`/ws-files/${departmentId}/file?path=${encodeURIComponent(filePath)}`);
      return data.data;
    } catch (e) {
      console.error(`[fetchWorkspaceFile] Failed to read ${filePath}:`, e.message || e);
      // Return error info so the UI can display a meaningful message
      return { path: filePath, content: null, error: e.message || 'Unknown error' };
    }
  },

  // === Chat with Agent (1-on-1) ===
  chatWithAgent: async (agentId, message) => {
    try {
      const data = await apiCall(`/agents/${agentId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  fetchAgentChatHistory: async (agentId, limit = 30) => {
    try {
      const data = await apiCall(`/agents/${agentId}/chat?limit=${limit}`);
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Paginated agent chat: load a page of messages.
   * @param {string} agentId
   * @param {{ before?: string, limit?: number }} opts
   * @returns {{ messages: Array, hasMore: boolean, total: number }}
   */
  fetchAgentChatPage: async (agentId, { before = null, limit = 30 } = {}) => {
    try {
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      params.set('limit', String(limit));
      const data = await apiCall(`/agents/${agentId}/chat?${params.toString()}`);
      return {
        messages: data.data || [],
        hasMore: !!data.hasMore,
        total: data.total || 0,
      };
    } catch {
      return { messages: [], hasMore: false, total: 0 };
    }
  },

  /**
   * Lightweight poll: fetch only agent chat messages newer than `after` timestamp.
   * Returns an array of new messages (empty if none).
   */
  pollAgentNewMessages: async (agentId, after) => {
    try {
      const data = await apiCall(`/agents/${agentId}/chat?after=${encodeURIComponent(after)}`);
      return data.data || [];
    } catch {
      return [];
    }
  },

  markAgentChatRead: async (agentId) => {
    try {
      await apiCall(`/agents/${agentId}/chat`, { method: 'PUT' });
      // Refresh company state to get latest unread status
      await get().fetchCompany();
    } catch (e) {
      // Failure to mark as read does not affect usage
    }
  },

  // === Agent Conversations (agent-to-agent chat) ===
  fetchAgentConversations: async (agentId) => {
    try {
      const data = await apiCall(`/agents/${agentId}/conversations`);
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  fetchAgentConversationHistory: async (agentId, sessionId, limit = 50) => {
    try {
      const data = await apiCall(`/agents/${agentId}/conversations?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`);
      // New format returns { messages, participants }, compatible with old format (direct array)
      const result = data.data || {};
      if (Array.isArray(result)) {
        return { messages: result, participants: [] };
      }
      return { messages: result.messages || [], participants: result.participants || [] };
    } catch (e) {
      return { messages: [], participants: [] };
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
  createRequirement: async (departmentId, title, description, workspaceDir) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/requirements', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', departmentId, title, description, workspaceDir: workspaceDir || undefined }),
      });
      set({ loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

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

  // Boss sends a message in requirement group chat
  sendGroupChatMessage: async (requirementId, message) => {
    try {
      const data = await apiCall('/requirements', {
        method: 'POST',
        body: JSON.stringify({ action: 'boss_message', id: requirementId, message }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // Department group chat: send message
  sendDeptGroupChatMessage: async (departmentId, message) => {
    try {
      const data = await apiCall('/departments?action=boss_message', {
        method: 'POST',
        body: JSON.stringify({ departmentId, message }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // Department group chat: get message list
  fetchDeptGroupChat: async (departmentId) => {
    try {
      const data = await apiCall('/departments?action=dept_chat', {
        method: 'POST',
        body: JSON.stringify({ departmentId }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  clearRequirementDetail: () => set({ requirementDetail: null }),

  // === Team Operations ===
  fetchTeams: async (departmentId) => {
    try {
      const query = departmentId ? `?departmentId=${departmentId}` : '';
      const data = await apiCall(`/teams${query}`);
      return data.data || [];
    } catch (e) {
      return [];
    }
  },

  fetchTeamDetail: async (teamId) => {
    try {
      const data = await apiCall(`/teams?id=${teamId}`);
      return data.data;
    } catch (e) {
      set({ error: e.message });
      return null;
    }
  },

  createTeam: async (departmentId, name, memberIds, leaderId, description) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', departmentId, name, memberIds, leaderId, description }),
      });
      set({ loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  updateTeam: async (teamId, updates) => {
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'update', teamId, ...updates }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  deleteTeam: async (teamId) => {
    try {
      await apiCall(`/teams?id=${teamId}`, { method: 'DELETE' });
      return true;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  // Sprint operations
  createSprint: async (teamId, title, goal) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'create_sprint', teamId, title, goal }),
      });
      set({ loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  discussSprint: async (teamId, sprintId) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'discuss_sprint', teamId, sprintId }),
      });
      set({ loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  approveSprint: async (teamId, sprintId) => {
    set({ loading: true, error: null });
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'approve_sprint', teamId, sprintId }),
      });
      set({ loading: false });
      return data.data;
    } catch (e) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  fetchSprintDetail: async (teamId, sprintId) => {
    try {
      const data = await apiCall(`/teams?teamId=${teamId}&sprintId=${sprintId}`);
      return data.data;
    } catch (e) {
      set({ error: e.message });
      return null;
    }
  },

  sendSprintMessage: async (teamId, sprintId, message) => {
    try {
      const data = await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'sprint_message', teamId, sprintId, message }),
      });
      return data.data;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },

  deleteSprint: async (teamId, sprintId) => {
    try {
      await apiCall('/teams', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_sprint', teamId, sprintId }),
      });
      return true;
    } catch (e) {
      set({ error: e.message });
      throw e;
    }
  },
}));
