import { v4 as uuidv4 } from 'uuid';
import { ProviderRegistry, ModelProviders, JobCategory, JobCategoryLabel } from './providers.js';
import { HRSystem } from './hr.js';
import { Secretary } from './secretary.js';
import { Department } from './department.js';
import { Agent } from './agent.js';
import { PerformanceSystem } from './performance.js';
import { TalentMarket } from './talent-market.js';
import { MessageBus } from './message-bus.js';
import { WorkspaceManager } from './workspace.js';
import { debouncedSave } from './persistence.js';
import { llmClient } from './llm-client.js';
import { loadAgentMemory, saveAgentMemory } from './memory-store.js';
import { Memory } from './memory.js';
import { RequirementManager } from './requirement.js';
import { hookRegistry, HookEvent } from './hooks.js';
import { sessionManager } from './session.js';
import { cronScheduler } from './cron.js';
import { pluginRegistry } from './plugin.js';
import { auditLogger, AuditCategory, AuditLevel } from './audit.js';
import { chatStore } from './chat-store.js';

/**
 * Company - AI Enterprise
 * Integrates message bus and workspace management, enabling Agents to actually perform work
 */
export class Company {
  constructor(companyName, bossName = 'Boss', secretaryConfig = null) {
    this.id = uuidv4();
    this.name = companyName;
    this.bossName = bossName;
    this.bossAvatar = null; // Boss avatar URL
    this.departments = new Map();
    this.providerRegistry = new ProviderRegistry();
    this.talentMarket = new TalentMarket();
    this.performanceSystem = new PerformanceSystem();
    this.hr = new HRSystem(this.providerRegistry, this.talentMarket);
    this.logs = [];
    // Chat history with secretary
    // chatHistory 保留为内存缓存（供前端 UI 快速访问），同时写入 chatStore 文件持久化
    this.chatHistory = [];
    // 聊天会话 ID（用于 chatStore 文件存储）
    this.chatSessionId = `boss-secretary-${this.id}`;
    chatStore.createSession(this.chatSessionId, {
      title: `${bossName} & Secretary`,
      participants: [bossName, 'Secretary'],
      type: 'boss-secretary',
    });
    // Department progress reports
    this.progressReports = [];
    // Mailbox: private messages from Agents to boss
    this.mailbox = [];
    // Pending recruitment plans for approval
    this.pendingPlans = new Map();

    // Message bus (inter-Agent communication)
    this.messageBus = new MessageBus();

    // Workspace manager
    this.workspaceManager = new WorkspaceManager();

    // Requirement manager
    this.requirementManager = new RequirementManager();

    // Configure provider for secretary
    let secretaryProviderConfig;
    if (secretaryConfig && secretaryConfig.providerId) {
      const provider = this.providerRegistry.getById(secretaryConfig.providerId);
      if (provider) {
        this.providerRegistry.configure(secretaryConfig.providerId, secretaryConfig.apiKey || 'sk-configured');
        secretaryProviderConfig = provider;
      }
    }
    if (!secretaryProviderConfig) {
      this.providerRegistry.configure('openai-gpt4', 'sk-default');
      secretaryProviderConfig = this.providerRegistry.getById('openai-gpt4');
    }

    // Initialize personal secretary
    this.secretary = new Secretary({
      company: this,
      providerConfig: secretaryProviderConfig,
      secretaryName: secretaryConfig?.secretaryName,
      secretaryAvatar: secretaryConfig?.secretaryAvatar,
      secretaryGender: secretaryConfig?.secretaryGender || 'female',
      secretaryAge: secretaryConfig?.secretaryAge || 18,
    });

    // Initialize secretary's toolKit so she can use tools (shell, file ops, etc.)
    const secretaryWorkspace = this.workspaceManager.createDepartmentWorkspace('secretary', 'secretary');
    this.secretary.agent.initToolKit(secretaryWorkspace, this.messageBus);

    this._log('Company founded', `"${this.name}" founded by ${this.bossName}`);
    this._log('Secretary ready', `Secretary ${this.secretary.agent.name} using model ${secretaryProviderConfig.name}`);

    // Initialize distilled subsystems
    this._initSubsystems();
  }

  /**
   * Chat with secretary (task assignment or casual conversation)
   * @param {string} message - Boss's message
   * @returns {Promise<object>} Secretary's reply
   */
  async chatWithSecretary(message) {
    const bossMsg = {
      role: 'boss',
      content: message,
      time: new Date(),
    };
    this.chatHistory.push(bossMsg);
    // 持久化到文件存储
    chatStore.appendMessage(this.chatSessionId, bossMsg);

    // Let secretary analyze whether it's task assignment or casual conversation
    const reply = await this.secretary.handleBossMessage(message, this);

    const secretaryMsg = {
      role: 'secretary',
      content: reply.content,
      action: reply.action || null,
      time: new Date(),
    };
    this.chatHistory.push(secretaryMsg);
    // 持久化到文件存储
    chatStore.appendMessage(this.chatSessionId, secretaryMsg);

    // 内存中只保留最近 50 条（前端缓存用）
    if (this.chatHistory.length > 50) {
      this.chatHistory = this.chatHistory.slice(-50);
    }

    this._log('Secretary chat', `Boss: "${message.slice(0, 30)}..." → Secretary replied`);
    return reply;
  }

  /**
   * Update boss profile (avatar)
   */
  updateBossProfile(settings) {
    if (settings.avatar) {
      this.bossAvatar = settings.avatar;
    }
    this._log('Boss profile updated', `Avatar updated`);
    return { bossAvatar: this.bossAvatar };
  }

  /**
   * Chat with a specific agent (boss <-> agent 1-on-1)
   * @param {string} agentId - Agent ID
   * @param {string} message - Boss's message
   * @returns {Promise<object>} Agent's reply
   */
  async chatWithAgent(agentId, message) {
    // Find the agent
    let targetAgent = null;
    let targetDept = null;
    for (const dept of this.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        targetAgent = agent;
        targetDept = dept;
        break;
      }
    }
    if (!targetAgent) throw new Error(`Employee not found: ${agentId}`);

    // Create or get chat session
    const sessionId = `boss-agent-${agentId}`;
    chatStore.createSession(sessionId, {
      title: `${this.bossName} & ${targetAgent.name}`,
      participants: [this.bossName, targetAgent.name],
      type: 'boss-agent',
    });

    // Append boss message
    const bossMsg = { role: 'boss', content: message, time: new Date() };
    chatStore.appendMessage(sessionId, bossMsg);

    // Get recent chat history for context
    const recentMessages = chatStore.getRecentMessages(sessionId, 20);

    // Build messages for LLM
    const systemMessage = targetAgent._buildSystemMessage()
      + `\n\n## Current Conversation\nYou are having a private 1-on-1 conversation with your boss "${this.bossName}".`
      + ` You work in the "${targetDept.name}" department.`
      + ` Respond naturally based on your personality and role. Be helpful but stay in character.`;

    const messages = [
      { role: 'system', content: systemMessage },
    ];

    // Add recent history as context
    for (const msg of recentMessages.slice(0, -1)) { // exclude the one we just added
      messages.push({
        role: msg.role === 'boss' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Call LLM
    let replyContent;
    try {
      const response = await llmClient.chat(targetAgent.provider, messages, {
        temperature: 0.8,
        maxTokens: 2048,
      });
      replyContent = response.content;
      targetAgent._trackUsage(response.usage);
    } catch (err) {
      replyContent = `(Sorry boss, my brain froze: ${err.message})`;
    }

    // Append agent reply
    const agentMsg = { role: 'agent', content: replyContent, time: new Date() };
    chatStore.appendMessage(sessionId, agentMsg);

    // Add to agent's short-term memory
    targetAgent.memory.addShortTerm(
      `Chatted with boss: "${message.slice(0, 50)}..." → replied`,
      'conversation'
    );

    this.save();

    return {
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      reply: replyContent,
      time: new Date(),
    };
  }

  /**
   * Get chat history with a specific agent
   * @param {string} agentId - Agent ID
   * @param {number} limit - Max messages to return
   * @returns {Array} Chat messages
   */
  getAgentChatHistory(agentId, limit = 30) {
    const sessionId = `boss-agent-${agentId}`;
    return chatStore.getRecentMessages(sessionId, limit);
  }

  /**
   * 获取所有 boss-agent 私聊会话的摘要信息
   * 用于在 Mailbox 中显示私聊会话列表
   */
  _getAgentChatSessions() {
    const sessions = chatStore.listSessions();
    const agentSessions = sessions.filter(s => s.type === 'boss-agent');
    
    return agentSessions.map(session => {
      // 从 sessionId 中提取 agentId: "boss-agent-{agentId}"
      const agentId = session.sessionId.replace('boss-agent-', '');
      
      // 查找对应的 agent 信息
      let agent = null;
      let deptName = null;
      for (const dept of this.departments.values()) {
        const a = dept.agents.get(agentId);
        if (a) {
          agent = a;
          deptName = dept.name;
          break;
        }
      }

      // 获取最近一条消息作为预览
      const recentMessages = chatStore.getRecentMessages(session.sessionId, 1);
      const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

      return {
        sessionId: session.sessionId,
        agentId,
        agentName: agent?.name || session.participants?.[1] || 'Unknown',
        agentAvatar: agent?.avatar || null,
        agentRole: agent?.role || null,
        agentSignature: agent?.signature || null,
        departmentName: deptName,
        lastMessage: lastMsg?.content?.slice(0, 50) || null,
        lastMessageRole: lastMsg?.role || null,
        lastTime: lastMsg?.time || session.lastActiveAt || session.createdAt,
        totalMessages: session.totalMessages || 0,
      };
    }).filter(s => s.totalMessages > 0) // 只返回有消息的会话
      .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime)); // 按时间倒序
  }

  /**
   * Update secretary settings (name, avatar, prompt, etc.)
   */
  updateSecretarySettings(settings) {
    const agent = this.secretary.agent;
    if (settings.name) agent.name = settings.name;
    if (settings.avatar) agent.avatar = settings.avatar;
    if (settings.avatarParams) agent.avatarParams = settings.avatarParams;
    if (settings.gender) agent.gender = settings.gender;
    if (settings.age != null) agent.age = settings.age;
    if (settings.prompt) agent.prompt = settings.prompt;
    if (settings.signature) agent.signature = settings.signature;
    // Switch provider
    if (settings.providerId) {
      const newProvider = this.providerRegistry.getById(settings.providerId);
      if (!newProvider) throw new Error(`Provider not found: ${settings.providerId}`);
      if (!newProvider.enabled) throw new Error(`Provider ${newProvider.name} is not enabled, please configure API Key first`);
      agent.provider = newProvider;
      // Sync update HR assistant's provider
      this.secretary.hrAssistant.agent.provider = newProvider;
      this._log('Secretary settings', `Secretary provider switched to: ${newProvider.name}`);
    }
    this._log('Secretary settings', `Updated secretary settings: ${Object.keys(settings).join(', ')}`);
    this.save();
    return {
      name: agent.name,
      avatar: agent.avatar,
      gender: agent.gender,
      age: agent.age,
      prompt: agent.prompt,
      signature: agent.signature,
      provider: agent.provider.name,
      providerId: agent.provider.id,
    };
  }

  /**
   * Initialize distilled subsystems (hooks, cron, plugins, sessions)
   */
  _initSubsystems() {
    // 1. Configure cron executor to run tasks via company
    cronScheduler.executor = async (agentId, taskPrompt, jobId) => {
      // Find the agent and their department
      for (const dept of this.departments.values()) {
        const agent = dept.agents.get(agentId);
        if (agent) {
          const result = await agent.executeTask({
            title: `Scheduled: ${taskPrompt.slice(0, 40)}`,
            description: taskPrompt,
            context: `This is an automated scheduled task (job: ${jobId})`,
          });
          return result.output;
        }
      }
      throw new Error(`Agent ${agentId} not found for cron job`);
    };

    // 2. Register cron callbacks for hooks integration
    cronScheduler.onJobRun = (job) => {
      hookRegistry.trigger(HookEvent.TASK_ASSIGNED, {
        source: 'cron', jobId: job.id, jobName: job.name, agentId: job.agentId,
      });
    };
    cronScheduler.onJobComplete = (job, result) => {
      hookRegistry.trigger(HookEvent.TASK_COMPLETED, {
        source: 'cron', jobId: job.id, jobName: job.name, agentId: job.agentId,
      });
    };
    cronScheduler.onJobError = (job, error) => {
      hookRegistry.trigger(HookEvent.TASK_FAILED, {
        source: 'cron', jobId: job.id, jobName: job.name, error: error.message,
      });
      auditLogger.log({
        category: AuditCategory.AGENT_ACTION, level: AuditLevel.WARN,
        agentId: job.agentId, action: `Cron job failed: ${job.name}`,
        details: { error: error.message, jobId: job.id },
      });
    };

    // 3. Enable built-in plugins by default
    for (const plugin of pluginRegistry.list()) {
      if (plugin.state === 'installed') {
        try { pluginRegistry.enable(plugin.id); } catch {}
      }
    }

    // 4. Start cron scheduler
    cronScheduler.start();

    // 5. Start session pruning
    sessionManager.startPruning();

    // 6. Fire system startup hook
    hookRegistry.trigger(HookEvent.SYSTEM_STARTUP, {
      companyName: this.name, bossName: this.bossName,
    });

    console.log('⚡ Distilled subsystems initialized (hooks, cron, plugins, sessions)');
  }

  _log(action, detail) {
    this.logs.push({ time: new Date(), action, detail });
    // Auto-persist on every state change
    debouncedSave(this);
  }

  /**
   * Manually trigger persistence (call after important operations)
   */
  save() {
    debouncedSave(this, 500);
  }

  /**
   * Step 1: Generate recruitment plan (don't execute, wait for boss approval)
   */
  async planDepartment(name, mission) {
    const teamPlan = await this.secretary.designTeam(mission);
    teamPlan.departmentName = name;

    const planId = uuidv4();
    this.pendingPlans.set(planId, { teamPlan, name, mission });

    this._log('Recruitment plan', `Secretary planned a ${teamPlan.members.length}-person team for "${name}", pending boss approval`);

    return {
      planId,
      departmentName: name,
      mission,
      reasoning: teamPlan.reasoning || null,
      members: teamPlan.members.map(m => ({
        templateId: m.templateId,
        title: m.templateTitle,
        name: m.name,
        isLeader: m.isLeader,
        reportsTo: m.reportsTo !== null ? teamPlan.members[m.reportsTo]?.name : null,
        reason: m.reason || null,
      })),
      collaborationRules: teamPlan.collaborationRules,
    };
  }

  /**
   * Step 2: Confirm recruitment plan, execute hiring
   */
  async confirmPlan(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan) throw new Error('Recruitment plan not found or expired');

    this.pendingPlans.delete(planId);

    const { teamPlan, name, mission } = plan;

    // Recruit
    const agents = this.secretary.executeRecruitment(teamPlan, this.hr);

    // Create department
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;

    // Add to department + initialize toolkits
    agents.forEach(agent => {
      dept.addAgent(agent);
      agent.initToolKit(wsPath, this.messageBus);
    });

    // Set department leader
    const leader = agents.find(a => a.role === 'Project Leader');
    if (leader) {
      dept.setLeader(leader);
    } else if (agents.length > 0) {
      dept.setLeader(agents[0]);
    }

    this.departments.set(dept.id, dept);

    this._log('Department created', `"${name}" department established, recruited ${agents.length} talents`);

    // Fire hooks: department created + agents created
    hookRegistry.trigger(HookEvent.DEPT_CREATED, {
      departmentId: dept.id, departmentName: dept.name, memberCount: agents.length,
    });
    for (const agent of agents) {
      hookRegistry.trigger(HookEvent.AGENT_CREATED, {
        agentId: agent.id, agentName: agent.name, role: agent.role,
        departmentId: dept.id, departmentName: dept.name,
      });
    }

    // Background async: Agent self-intro + onboarding email + broadcast
    this._onboardAgents(agents, dept).catch(e => console.error('Onboarding process error:', e));

    // Persist
    this.save();

    return dept;
  }

  /**
   * Employee onboarding flow: generate self-intro + send onboarding email + broadcast
   */
  async _onboardAgents(agents, dept) {
    for (const agent of agents) {
      // Generate personal signature
      await agent.generateSelfIntro();

      // Send onboarding email to boss
      agent.sendMailToBoss(
        `Reporting in! New employee ${agent.name} ready for duty`,
        `Hello Boss, I'm ${agent.name}, just assigned to the "${dept.name}" department as ${agent.role}.\n\nMy signature: "${agent.signature}"\nSkills: ${agent.skills.join(', ')}\n\nI may just be a bunch of parameters, but I'll do my best to pretend I'm useful. Please take care of me!`,
        this
      );

      // Broadcast to all: introduce new colleague to other Agents
      const allAgentIds = [];
      this.departments.forEach(d => {
        d.getMembers().forEach(a => {
          if (a.id !== agent.id) allAgentIds.push(a.id);
        });
      });
      if (allAgentIds.length > 0) {
        this.messageBus.broadcast(
          agent.id,
          allAgentIds,
          `👋 Hi everyone, I'm the new colleague ${agent.name}, serving as ${agent.role}, assigned to the "${dept.name}" department. My motto: "${agent.signature}". Nice to meet you all (even though you're all just a bunch of parameters too)!`,
          'broadcast'
        );
      }
    }
  }

  /**
   * General department lookup: try ID first, then fuzzy match by name
   * @param {string} idOrName - Department ID or name
   * @returns {Department|null}
   */
  findDepartment(idOrName) {
    if (!idOrName) return null;
    // Prioritize exact ID match
    const byId = this.departments.get(idOrName);
    if (byId) return byId;
    // Fallback: match by name
    for (const d of this.departments.values()) {
      if (d.name === idOrName || d.name.includes(idOrName) || idOrName.includes(d.name)) {
        console.log(`🔧 Matched department by name: "${idOrName}" → ${d.id} (${d.name})`);
        return d;
      }
    }
    return null;
  }

  createDepartment(name, mission) {
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;
    this.departments.set(dept.id, dept);
    return dept;
  }

  hireAgent(departmentId, templateId, name, providerId = null) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const recruitConfig = this.hr.recruit(templateId, name, providerId);
    const agent = new Agent(recruitConfig);
    dept.addAgent(agent);

    // Initialize toolkit
    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    return agent;
  }

  recallAgent(departmentId, profileId, newSkills = []) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const recruitConfig = this.hr.recallFromMarket(profileId, newSkills);
    const agent = new Agent(recruitConfig);
    agent.memory.addLongTerm(
      `Recalled to the "${dept.name}" department, carrying past experience and memories back to work`,
      'experience'
    );
    dept.addAgent(agent);

    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    console.log(`  🔄 [${agent.name}] Recalled from talent market, joined "${dept.name}" department`);
    return agent;
  }

  dismissAgent(departmentId, agentId, reason = 'Project ended') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const agent = dept.removeAgent(agentId);
    if (!agent) throw new Error(`Employee not found: ${agentId}`);

    agent.status = 'dismissed';

    // Fire hook: agent dismissed
    hookRegistry.trigger(HookEvent.AGENT_DISMISSED, {
      agentId: agent.id, agentName: agent.name, role: agent.role,
      departmentId: departmentId, reason,
    });

    const performanceData = {
      reviews: this.performanceSystem.getReviews(agentId),
      averageScore: this.performanceSystem.getAverageScore(agentId),
    };

    const profile = this.talentMarket.register(agent, reason, performanceData);

    agent.memory.addLongTerm(
      `Left the "${dept.name}" department, reason: ${reason}. Entered talent market awaiting new opportunities.`,
      'experience'
    );

    // Clean up message bus inbox
    this.messageBus.clearInbox(agentId);

    console.log(`  📤 [${agent.name}] has been dismissed, entered talent market`);
    return profile;
  }

  /**
   * Permanently delete a talent from the talent market, and clean up all their messages in mailbox and message bus
   * @param {string} profileId - Talent market profile ID
   */
  deleteTalent(profileId) {
    const profile = this.talentMarket.remove(profileId);
    const originalAgentId = profile.originalAgentId;

    // Clean up mailbox messages from this person
    this.mailbox = this.mailbox.filter(m => m.from?.id !== originalAgentId);

    // Clean up message bus messages (sent and received)
    this.messageBus.messages = this.messageBus.messages.filter(
      m => m.from !== originalAgentId && m.to !== originalAgentId
    );
    this.messageBus.inbox.delete(originalAgentId);

    this._log('Delete talent', `Permanently deleted "${profile.name}" from talent market and cleaned up related messages`);
    this.save();
    return profile;
  }

  /**
   * Adjust department staffing - Step 1: Get adjustment plan
   * @param {string} departmentId - Department ID
   * @param {string} adjustGoal - Adjustment goal
   * @returns {object} Adjustment plan (pending approval)
   */
  async planAdjustment(departmentId, adjustGoal) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    // Build department data
    const deptData = {
      name: dept.name,
      mission: dept.mission,
      members: dept.getMembers().map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        skills: a.skills,
        avgScore: a.performanceHistory.length > 0
          ? Math.round(a.performanceHistory.reduce((s, p) => s + p.score, 0) / a.performanceHistory.length)
          : null,
        taskCount: a.taskHistory.length,
      })),
    };

    const adjustPlan = await this.secretary.adjustTeam(deptData, adjustGoal);

    const planId = uuidv4();
    this.pendingPlans.set(planId, {
      type: 'adjustment',
      departmentId,
      departmentName: dept.name,
      adjustGoal,
      adjustPlan,
    });

    this._log('Adjustment plan', `Secretary created adjustment plan for "${dept.name}": fire ${adjustPlan.fires.length}, hire ${adjustPlan.hires.length}, pending approval`);

    return {
      planId,
      departmentId,
      departmentName: dept.name,
      adjustGoal,
      reasoning: adjustPlan.reasoning,
      fires: adjustPlan.fires,
      hires: adjustPlan.hires,
    };
  }

  /**
   * Confirm adjustment plan - Step 2: Execute adjustment
   * @param {string} planId - Adjustment plan ID
   */
  async confirmAdjustment(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan || plan.type !== 'adjustment') throw new Error('Adjustment plan not found or expired');

    this.pendingPlans.delete(planId);

    const dept = this.departments.get(plan.departmentId);
    if (!dept) throw new Error(`Department not found: ${plan.departmentId}`);

    const { adjustPlan } = plan;

    // Execute layoffs
    for (const fire of adjustPlan.fires) {
      try {
        this.dismissAgent(plan.departmentId, fire.agentId, fire.reason || 'Department restructuring');
        this._log('Adjustment layoff', `"${plan.departmentName}": ${fire.name} laid off - ${fire.reason || 'Department restructuring'}`);
      } catch (e) {
        console.error(`Layoff failed [${fire.name}]:`, e.message);
      }
    }

    // Execute hiring
    const newAgents = [];
    if (adjustPlan.hires.length > 0) {
      // Construct in same format as designTeam plan
      const hirePlan = {
        members: adjustPlan.hires.map(h => ({
          templateId: h.templateId,
          templateTitle: h.templateTitle || h.templateId,
          name: h.name,
          isLeader: h.isLeader || false,
          reportsTo: h.reportsTo ?? 0,
          reason: h.reason,
        })),
      };

      const agents = this.secretary.executeRecruitment(hirePlan, this.hr);
      for (const agent of agents) {
        if (!agent) continue;
        dept.addAgent(agent);
        if (dept.workspacePath) {
          agent.initToolKit(dept.workspacePath, this.messageBus);
        }
        newAgents.push(agent);
      }

      if (newAgents.length > 0) {
        this._log('Adjustment hire', `"${plan.departmentName}": hired ${newAgents.length} new employees`);
        // Background async onboarding
        this._onboardAgents(newAgents, dept).catch(e => console.error('Onboarding process error:', e));
      }
    }

    this.save();
    return dept;
  }

  /**
   * Disband department - all members enter talent market
   * @param {string} departmentId - Department ID
   * @param {string} reason - Disbanding reason
   */
  disbandDepartment(departmentId, reason = 'Organizational restructuring') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const deptName = dept.name;
    const members = dept.getMembers();

    // Dismiss all members one by one
    for (const agent of members) {
      try {
        this.dismissAgent(departmentId, agent.id, `Department "${deptName}" disbanded: ${reason}`);
      } catch (e) {
        console.error(`Dismissal failed [${agent.name}]:`, e.message);
      }
    }

    // Delete department
    this.departments.delete(departmentId);

    this._log('Department disbanded', `"${deptName}" department disbanded, ${members.length} employees entered talent market. Reason: ${reason}`);
    this.save();

    return { departmentName: deptName, dismissedCount: members.length };
  }

  evaluateAgent(agentId, reviewerId, taskTitle, scores = null, comment = null) {
    let agent = null;
    let reviewer = null;

    for (const dept of this.departments.values()) {
      if (!agent) agent = dept.agents.get(agentId);
      if (!reviewer) reviewer = dept.agents.get(reviewerId);
    }

    if (!agent) throw new Error(`Employee not found: ${agentId}`);
    if (!reviewer) throw new Error(`Reviewer not found: ${reviewerId}`);

    let review;
    if (scores) {
      review = this.performanceSystem.evaluate({
        agent, reviewer, taskTitle, scores, comment,
      });
    } else {
      review = this.performanceSystem.autoEvaluate({
        agent, reviewer, taskTitle,
      });
    }

    agent.receiveFeedback(review);
    return review;
  }

  viewTalentMarket() {
    this.talentMarket.print();
    return this.talentMarket.listAvailable();
  }

  searchTalentMarket(criteria) {
    return this.talentMarket.search(criteria);
  }

  viewPerformanceReport(agentId, agentName = '') {
    this.performanceSystem.printReport(agentId, agentName);
  }

  viewAgentMemory(agentId) {
    for (const dept of this.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        agent.memory.print(agent.name);
        return agent.memory.getSummary();
      }
    }
    throw new Error(`Employee not found: ${agentId}`);
  }

  getOverview() {
    const overview = {
      company: this.name,
      boss: this.bossName,
      departments: [],
      totalAgents: 0,
      talentMarket: this.talentMarket.getStats(),
    };

    this.departments.forEach(dept => {
      const summary = dept.getSummary();
      overview.departments.push(summary);
      overview.totalAgents += summary.memberCount;
    });

    return overview;
  }

  listProviders(category = null) {
    if (category) {
      return this.providerRegistry.getByCategory(category);
    }
    return this.providerRegistry.listAll();
  }

  listJobTemplates(category = null) {
    if (category) {
      return this.hr.listTemplatesByCategory(category);
    }
    return this.hr.listAllTemplates();
  }

  configureProvider(providerId, apiKey) {
    const provider = this.providerRegistry.configure(providerId, apiKey);
    // 清除 LLM 客户端缓存，确保下次调用使用新的 apiKey
    llmClient.clearClient(providerId);
    this._log('Configure provider', `${provider.name} has been ${apiKey ? 'enabled' : 'disabled'}`);
    return provider;
  }

  getProviderDashboard() {
    return this.providerRegistry.getStats();
  }

  /**
   * Assign task to department and let employees actually execute it
   * This is the core method that makes AI employees "actually work"
   * Uses requirement management: standardize requirement → leader decomposes workflow → execute by DAG → group chat communication
   * @param {string} departmentId - Target department ID
   * @param {string} taskDescription - Task description
   * @param {string} [taskTitle] - Task title
   * @returns {Promise<object>} Execution result
   */
  async assignTaskToDepartment(departmentId, taskDescription, taskTitle = null) {
    const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const members = dept.getMembers();
    if (members.length === 0) throw new Error(`Department "${dept.name}" has no employees`);

    const title = taskTitle || taskDescription.slice(0, 50);
    this._log('Task assigned', `"${dept.name}" received task: "${title}"`);

    // Fire hook: task assigned
    hookRegistry.trigger(HookEvent.TASK_ASSIGNED, {
      departmentId: dept.id, departmentName: dept.name, taskTitle: title,
    });

    // 1. Create standardized requirement
    const requirement = this.requirementManager.create({
      title,
      description: taskDescription,
      departmentId: dept.id,
      departmentName: dept.name,
      bossMessage: taskDescription,
    });

    // Persist immediately to prevent data loss after requirement creation
    this.save();
    console.log(`📝 Requirement created: ${requirement.id} - ${title}`);

    // 2. Leader decomposes workflow
    const leader = dept.getLeader() || members[0];
    try {
      await this.requirementManager.planWorkflow(
        requirement, members, leader.provider
      );
    } catch (e) {
      console.error('Workflow decomposition failed:', e.message);
      // Save current state even if decomposition fails (fallback workflow is set inside planWorkflow)
    }

    // Save again after workflow decomposition
    this.save();

    // 3. Execute by workflow DAG
    let summary;
    try {
      summary = await this.requirementManager.executeWorkflow(
        requirement, dept, this.performanceSystem
      );
    } catch (e) {
      console.error('Workflow execution failed:', e.message);
      // Update requirement status to failed
      requirement.status = 'failed';
      requirement.completedAt = new Date();
      requirement.summary = { totalTasks: 0, successTasks: 0, failedTasks: 0, totalDuration: 0, outputs: [], error: e.message };
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `❌ Requirement execution failed: ${e.message}`,
        'system'
      );
      this.save();
      summary = requirement.summary;
    }

    // 4. Let leader send report email
    if (leader) {
      let reportContent = `Requirement "${title}" completed!\n\n`;
      reportContent += `📊 Execution Summary:\n`;
      reportContent += `- Tasks completed: ${summary.successTasks}/${summary.totalTasks}\n`;
      reportContent += `- Total duration: ${Math.round(summary.totalDuration / 1000)}s\n\n`;
      reportContent += `📝 Member outputs:\n`;
      for (const o of (summary.outputs || [])) {
        reportContent += `\n[${o.agentName} (${o.role})]\n`;
        reportContent += (o.content || '').slice(0, 300);
        if ((o.content || '').length > 300) reportContent += '...';
        reportContent += '\n';
      }
      leader.sendMailToBoss(`📋 Requirement Report: ${title}`, reportContent, this);
    }

    // 5. Record to progress reports
    this.progressReports.push({
      time: new Date(),
      type: 'task_completed',
      reports: [{
        department: dept.name,
        task: title,
        requirementId: requirement.id,
        success: summary.successTasks === summary.totalTasks,
        detail: `${summary.successTasks}/${summary.totalTasks} subtasks completed, took ${Math.round(summary.totalDuration / 1000)}s`,
      }],
    });

    // Fire hook: task completed
    hookRegistry.trigger(HookEvent.TASK_COMPLETED, {
      departmentId: dept.id, departmentName: dept.name, taskTitle: title,
      totalTasks: summary.totalTasks, successTasks: summary.successTasks,
    });

    this._log('Task completed', `"${dept.name}" completed task: "${title}", ${summary.successTasks}/${summary.totalTasks} succeeded`);
    this.save();

    // Return summary with requirement ID
    return {
      requirementId: requirement.id,
      projectId: requirement.id,
      title,
      department: dept.name,
      departmentId: dept.id,
      totalTasks: summary.totalTasks,
      successTasks: summary.successTasks,
      failedTasks: summary.failedTasks,
      totalDuration: summary.totalDuration,
      outputs: (summary.outputs || []).map(o => ({
        agentName: o.agentName,
        role: o.role,
        output: o.content,
        outputType: o.outputType,
        toolResults: o.metadata?.toolResults || [],
        success: true,
        duration: o.metadata?.duration || 0,
      })),
      completedAt: new Date(),
    };
  }

  /**
   * Get full company state data (for Web rendering)
   */
  getFullState() {
    const departments = [];

    // Calculate company-wide Token/cost statistics
    let companyTotalTokens = 0;
    let companyTotalCost = 0;

    this.departments.forEach(dept => {
      let deptTokens = 0;
      let deptCost = 0;
      const members = dept.getMembers().map(a => {
        const usage = a.tokenUsage || { totalTokens: 0, totalCost: 0, promptTokens: 0, completionTokens: 0, callCount: 0 };
        deptTokens += usage.totalTokens;
        deptCost += usage.totalCost;
        return {
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        gender: a.gender,
        age: a.age,
        signature: a.signature,
        personality: a.personality,
        status: a.status,
        provider: { id: a.provider.id, name: a.provider.name, provider: a.provider.provider },
        skills: a.skills,
        reportsTo: a.reportsTo,
        subordinates: a.subordinates,
        memory: a.memory.getSummary(),
        performanceHistory: a.performanceHistory,
        avgScore: a.performanceHistory.length > 0
          ? Math.round(a.performanceHistory.reduce((s, p) => s + p.score, 0) / a.performanceHistory.length)
          : null,
        taskCount: a.taskHistory.length,
        tokenUsage: { ...usage },
      };
      });

      companyTotalTokens += deptTokens;
      companyTotalCost += deptCost;

      departments.push({
        id: dept.id,
        name: dept.name,
        mission: dept.mission,
        status: dept.status,
        leader: dept.leader,
        workspacePath: dept.workspacePath || null,
        members,
        tokenUsage: { totalTokens: deptTokens, totalCost: deptCost },
      });
    });

    // Add secretary and HR consumption
    const secUsage = this.secretary.agent.tokenUsage || { totalTokens: 0, totalCost: 0 };
    const hrUsage = this.secretary.hrAssistant.agent.tokenUsage || { totalTokens: 0, totalCost: 0 };
    companyTotalTokens += secUsage.totalTokens + hrUsage.totalTokens;
    companyTotalCost += secUsage.totalCost + hrUsage.totalCost;

    return {
      id: this.id,
      name: this.name,
      boss: this.bossName,
      bossAvatar: this.bossAvatar,
      secretary: {
        name: this.secretary.agent.name,
        avatar: this.secretary.agent.avatar,
        gender: this.secretary.agent.gender,
        age: this.secretary.agent.age,
        signature: this.secretary.agent.signature,
        prompt: this.secretary.agent.prompt,
        provider: this.secretary.agent.provider.name,
        providerId: this.secretary.agent.provider.id,
        // Optional general-purpose provider list (enabled only)
        availableProviders: this.providerRegistry.getByCategory('general').map(p => ({
          id: p.id,
          name: p.name,
        })),
        hrAssistant: {
          name: this.secretary.hrAssistant.agent.name,
          avatar: this.secretary.hrAssistant.agent.avatar,
          signature: this.secretary.hrAssistant.agent.signature,
        },
      },
      departments,
      budget: {
        totalTokens: companyTotalTokens,
        totalCost: Math.round(companyTotalCost * 10000) / 10000,
        secretaryUsage: { ...secUsage },
        hrUsage: { ...hrUsage },
      },
      mailbox: this.mailbox.slice(-50).map(m => ({
        ...m,
        from: { ...m.from },
        replies: (m.replies || []).slice(-10),
      })),
      unreadMailCount: this.mailbox.filter(m => !m.read).length,
      pendingPlans: [...this.pendingPlans.entries()].map(([id, p]) => ({
        planId: id,
        name: p.name,
        mission: p.mission,
        members: p.teamPlan.members.map(m => ({
          templateId: m.templateId,
          title: m.templateTitle,
          name: m.name,
          isLeader: m.isLeader,
          reportsTo: m.reportsTo !== null ? p.teamPlan.members[m.reportsTo]?.name : null,
        })),
      })),
      chatHistory: this.chatHistory.slice(-30),
      progressReports: this.progressReports.slice(-20),
      talentMarket: this.talentMarket.listAvailable().map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        avatar: p.avatar,
        gender: p.gender,
        age: p.age,
        skills: [...p.skills, ...p.acquiredSkills],
        dismissalReason: p.dismissalReason,
        performanceScore: p.performanceData?.averageScore,
        registeredAt: p.registeredAt,
        memoryCount: p.memorySnapshot ? (p.memorySnapshot.shortTerm?.length || 0) + (p.memorySnapshot.longTerm?.length || 0) : 0,
      })),
      providerDashboard: this.providerRegistry.getStats(),
      messageBusStats: this.messageBus.getStats(),
      // Boss-Agent 私聊会话列表
      agentChatSessions: this._getAgentChatSessions(),
      requirements: this.requirementManager.listAll().map(r => r.serialize()),
      logs: this.logs.slice(-50),
    };
  }

  /**
   * Get recent messages from message bus
   */
  getRecentMessages(limit = 20) {
    return this.messageBus.getRecent(limit);
  }

  /**
   * Get conversation between Agents
   */
  getConversation(agentId1, agentId2, limit = 50) {
    return this.messageBus.getConversation(agentId1, agentId2, limit);
  }

  /**
   * Get workspace file tree
   */
  async getWorkspaceFiles(departmentId) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) return [];
    return this.workspaceManager.getFileTree(dept.workspacePath);
  }

  /**
   * Read workspace file
   */
  async readWorkspaceFile(departmentId, filePath) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) throw new Error('Department workspace does not exist');
    return this.workspaceManager.readFile(dept.workspacePath, filePath);
  }

  printCompanyOverview() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏢 "${this.name}" Company Overview`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 Boss: ${this.bossName}`);
    console.log(`🏢 Departments: ${this.departments.size}`);

    this.departments.forEach(dept => {
      console.log(`\n  📁 ${dept.name} (${dept.status})`);
      console.log(`     Mission: ${dept.mission}`);
      console.log(`     Members: ${dept.agents.size}`);
      dept.printOrgChart();
    });

    this.talentMarket.print();
    console.log(`${'='.repeat(60)}\n`);
  }

  // ========== Persistence Serialization ==========

  /**
   * Serialize complete company state (for disk persistence)
   */
  serialize() {
    // Serialize departments and Agents
    const departments = [];
    this.departments.forEach(dept => {
      const members = dept.getMembers().map(a => a.serialize());
      departments.push({
        id: dept.id,
        name: dept.name,
        mission: dept.mission,
        status: dept.status,
        leader: dept.leader,
        workspacePath: dept.workspacePath,
        createdAt: dept.createdAt,
        members,
      });
    });

    // Serialize provider configs (only save API Key and enabled state)
    const providerConfigs = {};
    this.providerRegistry.listAll().forEach(p => {
      if (p.apiKey || p.enabled) {
        providerConfigs[p.id] = { apiKey: p.apiKey, enabled: p.enabled };
      }
    });

    // Serialize talent market
    const talentPool = [];
    this.talentMarket.pool.forEach((profile, id) => {
      talentPool.push({
        ...profile,
        // Only save provider id
        provider: profile.provider ? { id: profile.provider.id } : null,
      });
    });

    return {
      _version: 1,
      id: this.id,
      name: this.name,
      bossName: this.bossName,
      bossAvatar: this.bossAvatar,
      departments,
      providerConfigs,
      talentPool,
      mailbox: this.mailbox.slice(-200),
      chatSessionId: this.chatSessionId,
      chatHistory: this.chatHistory.slice(-50),
      progressReports: this.progressReports.slice(-30),
      logs: this.logs.slice(-100),
      secretary: {
        name: this.secretary.agent.name,
        avatar: this.secretary.agent.avatar,
        signature: this.secretary.agent.signature,
        prompt: this.secretary.agent.prompt,
        providerId: this.secretary.agent.provider?.id,
        tokenUsage: { ...this.secretary.agent.tokenUsage },
        hrTokenUsage: { ...this.secretary.hrAssistant.agent.tokenUsage },
      },
      messageBusMessages: this.messageBus.messages.slice(-500).map(m => m.toJSON()),
      requirements: this.requirementManager.serialize(),
      cronJobs: cronScheduler.serialize(),
      savedAt: new Date(),
    };
  }

  /**
   * Restore company from serialized data (static factory method)
   */
  static deserialize(data) {
    if (!data || !data.name) throw new Error('Invalid company state data');

    // Create shell company (don't trigger full initialization)
    // 从 providerConfigs 中获取秘书对应 provider 的真实 apiKey
    const secretaryProviderId = data.secretary?.providerId || 'deepseek-v3';
    const secretaryApiKey = data.providerConfigs?.[secretaryProviderId]?.apiKey || 'sk-restored';
    const company = new Company(data.name, data.bossName, {
      providerId: secretaryProviderId,
      apiKey: secretaryApiKey,
      secretaryName: data.secretary?.name,
      secretaryAvatar: data.secretary?.avatar,
    });

    // Restore ID
    company.id = data.id;

    // Restore boss avatar
    if (data.bossAvatar) {
      company.bossAvatar = data.bossAvatar;
    }

    // Restore provider configs
    if (data.providerConfigs) {
      for (const [pid, cfg] of Object.entries(data.providerConfigs)) {
        try {
          company.providerRegistry.configure(pid, cfg.apiKey);
          // 清除旧的 LLM 客户端缓存，确保使用恢复后的真实 apiKey
          llmClient.clearClient(pid);
        } catch (e) { /* ignore non-existent providers */ }
      }
    }

    // Restore secretary token usage
    if (data.secretary?.tokenUsage) {
      Object.assign(company.secretary.agent.tokenUsage, data.secretary.tokenUsage);
    }
    if (data.secretary?.hrTokenUsage) {
      Object.assign(company.secretary.hrAssistant.agent.tokenUsage, data.secretary.hrTokenUsage);
    }
    // Restore secretary custom prompt
    if (data.secretary?.prompt) {
      company.secretary.agent.prompt = data.secretary.prompt;
    }
    // Restore secretary signature
    if (data.secretary?.signature) {
      company.secretary.agent.signature = data.secretary.signature;
    }

    // Restore secretary memory from separate memory file
    if (company.secretary?.agent?.id) {
      const secretaryMemory = loadAgentMemory(company.secretary.agent.id);
      if (secretaryMemory) {
        company.secretary.agent.memory = Memory.deserialize(secretaryMemory);
        console.log(`  🧠 Secretary memory restored: ${secretaryMemory.shortTerm?.length || 0} short-term, ${secretaryMemory.longTerm?.length || 0} long-term`);
      }
    }

    // Restore departments and Agents
    company.departments.clear();
    for (const deptData of (data.departments || [])) {
      const dept = new Department({
        name: deptData.name,
        mission: deptData.mission,
        company: company.id,
      });
      dept.id = deptData.id;
      dept.status = deptData.status || 'active';
      dept.leader = deptData.leader;
      dept.workspacePath = deptData.workspacePath;
      dept.createdAt = deptData.createdAt ? new Date(deptData.createdAt) : new Date();

      // Restore Agents
      for (const agentData of (deptData.members || [])) {
      // Load memory from separate file (higher priority than serialized data)
        const externalMemory = loadAgentMemory(agentData.id);
        if (externalMemory) {
          agentData.memory = externalMemory;
        }
        const agent = Agent.deserialize(agentData, company.providerRegistry);
        dept.addAgent(agent);
        // Restore toolkit
        if (dept.workspacePath) {
          agent.initToolKit(dept.workspacePath, company.messageBus);
        }
      }

      company.departments.set(dept.id, dept);
    }

    // Restore talent market
    company.talentMarket.pool.clear();
    for (const profile of (data.talentPool || [])) {
      // Restore provider reference
      if (profile.provider?.id) {
        profile.provider = company.providerRegistry.getById(profile.provider.id) || profile.provider;
      }
      company.talentMarket.pool.set(profile.id, profile);
    }

    // Restore mailbox, chat history, progress reports, logs
    company.mailbox = data.mailbox || [];
    company.chatHistory = data.chatHistory || [];
    // 恢复聊天会话 ID
    if (data.chatSessionId) {
      company.chatSessionId = data.chatSessionId;
    }
    // 如果有旧版 chatHistory 数据且文件存储为空，则迁移
    if (company.chatHistory.length > 0 && chatStore.getMessageCount(company.chatSessionId) === 0) {
      chatStore.migrateFromArray(company.chatSessionId, company.chatHistory);
    }
    company.progressReports = data.progressReports || [];
    company.logs = data.logs || [];

    // Restore message bus
    if (data.messageBusMessages) {
      // Only restore history, don't rebuild inbox
      company.messageBus.messages = data.messageBusMessages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
        toJSON() { return m; },
      }));
    }

    // Restore requirement manager
    if (data.requirements) {
      company.requirementManager = RequirementManager.deserialize(data.requirements);
    }

    // Restore cron jobs
    if (data.cronJobs) {
      cronScheduler.restore(data.cronJobs);
    }

    console.log(`✅ Company "${company.name}" state restored: ${company.departments.size} departments`);
    return company;
  }
}
