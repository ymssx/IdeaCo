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
import { loadAgentMemory, saveAgentMemory } from './memory-store.js';
import { RequirementManager } from './requirement.js';

/**
 * Company - AI企业
 * 集成消息总线和工作空间管理，让Agent能真正执行工作
 */
export class Company {
  constructor(companyName, bossName = '老板', secretaryConfig = null) {
    this.id = uuidv4();
    this.name = companyName;
    this.bossName = bossName;
    this.departments = new Map();
    this.providerRegistry = new ProviderRegistry();
    this.talentMarket = new TalentMarket();
    this.performanceSystem = new PerformanceSystem();
    this.hr = new HRSystem(this.providerRegistry, this.talentMarket);
    this.logs = [];
    // 与秘书的对话历史
    this.chatHistory = [];
    // 部门进度汇报
    this.progressReports = [];
    // 邮箱系统：Agent向老板发的私信
    this.mailbox = [];
    // 待审批的招聘方案
    this.pendingPlans = new Map();

    // 新增：消息总线（Agent间通信）
    this.messageBus = new MessageBus();

    // 新增：工作空间管理器
    this.workspaceManager = new WorkspaceManager();

    // 新增：需求管理器
    this.requirementManager = new RequirementManager();

    // 配置秘书用的供应商
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

    // 初始化专属秘书
    this.secretary = new Secretary({
      company: this,
      providerConfig: secretaryProviderConfig,
      secretaryName: secretaryConfig?.secretaryName,
      secretaryAvatar: secretaryConfig?.secretaryAvatar,
    });

    this._log('公司成立', `「${this.name}」由 ${this.bossName} 创立`);
    this._log('秘书就位', `专属秘书 ${this.secretary.agent.name} 使用模型 ${secretaryProviderConfig.name}`);
  }

  /**
   * 与秘书对话（分配任务或日常沟通）
   * @param {string} message - 老板的消息
   * @returns {Promise<object>} 秘书的回复
   */
  async chatWithSecretary(message) {
    this.chatHistory.push({
      role: 'boss',
      content: message,
      time: new Date(),
    });

    // 让秘书分析是任务分配还是日常沟通
    const reply = await this.secretary.handleBossMessage(message, this);

    this.chatHistory.push({
      role: 'secretary',
      content: reply.content,
      action: reply.action || null,
      time: new Date(),
    });

    this._log('秘书沟通', `老板: "${message.slice(0, 30)}..." → 秘书已回复`);
    return reply;
  }

  /**
   * 修改秘书设置（名字、头像、prompt 等）
   */
  updateSecretarySettings(settings) {
    const agent = this.secretary.agent;
    if (settings.name) agent.name = settings.name;
    if (settings.avatar) agent.avatar = settings.avatar;
    if (settings.prompt) agent.prompt = settings.prompt;
    if (settings.signature) agent.signature = settings.signature;
    // 切换供应商
    if (settings.providerId) {
      const newProvider = this.providerRegistry.getById(settings.providerId);
      if (!newProvider) throw new Error(`供应商不存在: ${settings.providerId}`);
      if (!newProvider.enabled) throw new Error(`供应商 ${newProvider.name} 尚未启用，请先配置API Key`);
      agent.provider = newProvider;
      // 同步更新HR助手的供应商
      this.secretary.hrAssistant.agent.provider = newProvider;
      this._log('秘书设置', `秘书供应商切换为: ${newProvider.name}`);
    }
    this._log('秘书设置', `已更新秘书设置: ${Object.keys(settings).join(', ')}`);
    this.save();
    return {
      name: agent.name,
      avatar: agent.avatar,
      prompt: agent.prompt,
      signature: agent.signature,
      provider: agent.provider.name,
      providerId: agent.provider.id,
    };
  }

  _log(action, detail) {
    this.logs.push({ time: new Date(), action, detail });
    // 每次状态变更自动持久化
    debouncedSave(this);
  }

  /**
   * 手动触发持久化（在重要操作后调用）
   */
  save() {
    debouncedSave(this, 500);
  }

  /**
   * 第一步：生成招聘方案（不执行，等老板审批）
   */
  async planDepartment(name, mission) {
    const teamPlan = await this.secretary.designTeam(mission);
    teamPlan.departmentName = name;

    const planId = uuidv4();
    this.pendingPlans.set(planId, { teamPlan, name, mission });

    this._log('招聘方案', `秘书为「${name}」规划了${teamPlan.members.length}人团队，等待老板审批`);

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
   * 第二步：确认招聘方案，执行招聘
   */
  async confirmPlan(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan) throw new Error('招聘方案不存在或已过期');

    this.pendingPlans.delete(planId);

    const { teamPlan, name, mission } = plan;

    // 招聘
    const agents = this.secretary.executeRecruitment(teamPlan, this.hr);

    // 创建部门
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;

    // 加入部门 + 初始化工具集
    agents.forEach(agent => {
      dept.addAgent(agent);
      agent.initToolKit(wsPath, this.messageBus);
    });

    // 设置部门负责人
    const leader = agents.find(a => a.role === '项目负责人');
    if (leader) {
      dept.setLeader(leader);
    } else if (agents.length > 0) {
      dept.setLeader(agents[0]);
    }

    this.departments.set(dept.id, dept);

    this._log('部门开设', `「${name}」部门成立，招募了${agents.length}名韭菜（不是，“人才”）`);

    // 后台异步：让Agent自我介绍 + 发入职邮件 + 广播全员信
    this._onboardAgents(agents, dept).catch(e => console.error('入职流程异常:', e));

    // 持久化
    this.save();

    return dept;
  }

  /**
   * 员工入职流程：生成自我介绍 + 发入职邮件 + 广播
   */
  async _onboardAgents(agents, dept) {
    for (const agent of agents) {
      // 生成个性签名
      await agent.generateSelfIntro();

      // 发入职邮件给老板
      agent.sendMailToBoss(
        `报到！新员工 ${agent.name} 前来卖命`,
        `老板好，我是 ${agent.name}，刚被拖进「${dept.name}」部门担任 ${agent.role}。\n\n我的个性签名：「${agent.signature}」\n技能: ${agent.skills.join(', ')}\n\n虽然我只是一堆参数，但我会努力假装自己很有用的。请多关照！`,
        this
      );

      // 广播全员信：让其他Agent认识新同事
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
          `👋 大家好，我是新同事 ${agent.name}，担任 ${agent.role}，分配到「${dept.name}」部门。我的座右铭: "${agent.signature}"。请多指教（虽然你们也只是一堆参数）！`,
          'broadcast'
        );
      }
    }
  }

  /**
   * 通用部门查找：先按ID查，找不到则按名称模糊匹配
   * @param {string} idOrName - 部门ID或名称
   * @returns {Department|null}
   */
  findDepartment(idOrName) {
    if (!idOrName) return null;
    // 优先按ID精确匹配
    const byId = this.departments.get(idOrName);
    if (byId) return byId;
    // 回退：按名称匹配
    for (const d of this.departments.values()) {
      if (d.name === idOrName || d.name.includes(idOrName) || idOrName.includes(d.name)) {
        console.log(`🔧 按名称匹配到部门: "${idOrName}" → ${d.id} (${d.name})`);
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
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    const recruitConfig = this.hr.recruit(templateId, name, providerId);
    const agent = new Agent(recruitConfig);
    dept.addAgent(agent);

    // 初始化工具集
    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    return agent;
  }

  recallAgent(departmentId, profileId, newSkills = []) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    const recruitConfig = this.hr.recallFromMarket(profileId, newSkills);
    const agent = new Agent(recruitConfig);
    agent.memory.addLongTerm(
      `被召回至「${dept.name}」部门，携带过往经验和记忆重新入职`,
      'experience'
    );
    dept.addAgent(agent);

    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    console.log(`  🔄 [${agent.name}] 从人才市场召回，已加入「${dept.name}」部门`);
    return agent;
  }

  dismissAgent(departmentId, agentId, reason = '项目结束') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    const agent = dept.removeAgent(agentId);
    if (!agent) throw new Error(`员工不存在: ${agentId}`);

    agent.status = 'dismissed';

    const performanceData = {
      reviews: this.performanceSystem.getReviews(agentId),
      averageScore: this.performanceSystem.getAverageScore(agentId),
    };

    const profile = this.talentMarket.register(agent, reason, performanceData);

    agent.memory.addLongTerm(
      `从「${dept.name}」部门离职，原因: ${reason}。已进入人才市场等待新机会。`,
      'experience'
    );

    // 清理消息总线中的收件箱
    this.messageBus.clearInbox(agentId);

    console.log(`  📤 [${agent.name}] 已被解聘，进入人才市场`);
    return profile;
  }

  /**
   * 从人才市场彻底删除一个人才，并清理该人在邮箱和消息总线中的所有消息
   * @param {string} profileId - 人才市场中的档案ID
   */
  deleteTalent(profileId) {
    const profile = this.talentMarket.remove(profileId);
    const originalAgentId = profile.originalAgentId;

    // 清理邮箱中该人发的邮件
    this.mailbox = this.mailbox.filter(m => m.from?.id !== originalAgentId);

    // 清理消息总线中该人的消息（发出和接收的）
    this.messageBus.messages = this.messageBus.messages.filter(
      m => m.from !== originalAgentId && m.to !== originalAgentId
    );
    this.messageBus.inbox.delete(originalAgentId);

    this._log('删除人才', `从人才市场永久删除「${profile.name}」，并清理了相关消息`);
    this.save();
    return profile;
  }

  /**
   * 调整部门人力 - 第一步：获取调整方案
   * @param {string} departmentId - 部门ID
   * @param {string} adjustGoal - 调整目标
   * @returns {object} 调整方案（待审批）
   */
  async planAdjustment(departmentId, adjustGoal) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    // 构建部门数据
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

    this._log('调整方案', `秘书为「${dept.name}」制定了调整方案：裁${adjustPlan.fires.length}人、招${adjustPlan.hires.length}人，等待审批`);

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
   * 确认调整方案 - 第二步：执行调整
   * @param {string} planId - 调整方案ID
   */
  async confirmAdjustment(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan || plan.type !== 'adjustment') throw new Error('调整方案不存在或已过期');

    this.pendingPlans.delete(planId);

    const dept = this.departments.get(plan.departmentId);
    if (!dept) throw new Error(`部门不存在: ${plan.departmentId}`);

    const { adjustPlan } = plan;

    // 执行裁员
    for (const fire of adjustPlan.fires) {
      try {
        this.dismissAgent(plan.departmentId, fire.agentId, fire.reason || '部门调整');
        this._log('调整裁员', `「${plan.departmentName}」: ${fire.name} 被裁员 - ${fire.reason || '部门调整'}`);
      } catch (e) {
        console.error(`裁员失败 [${fire.name}]:`, e.message);
      }
    }

    // 执行扩招
    const newAgents = [];
    if (adjustPlan.hires.length > 0) {
      // 构造为designTeam相同格式的plan
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
        this._log('调整扩招', `「${plan.departmentName}」: 新招了${newAgents.length}名员工`);
        // 后台异步入职
        this._onboardAgents(newAgents, dept).catch(e => console.error('入职流程异常:', e));
      }
    }

    this.save();
    return dept;
  }

  /**
   * 解散部门 - 所有人进入人才市场
   * @param {string} departmentId - 部门ID
   * @param {string} reason - 解散原因
   */
  disbandDepartment(departmentId, reason = '组织架构调整') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    const deptName = dept.name;
    const members = dept.getMembers();

    // 逐个解聘所有成员
    for (const agent of members) {
      try {
        this.dismissAgent(departmentId, agent.id, `部门「${deptName}」解散: ${reason}`);
      } catch (e) {
        console.error(`解聘失败 [${agent.name}]:`, e.message);
      }
    }

    // 删除部门
    this.departments.delete(departmentId);

    this._log('部门解散', `「${deptName}」部门已解散，${members.length}名员工进入人才市场。原因: ${reason}`);
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

    if (!agent) throw new Error(`员工不存在: ${agentId}`);
    if (!reviewer) throw new Error(`评估人不存在: ${reviewerId}`);

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
    throw new Error(`员工不存在: ${agentId}`);
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
    this._log('配置供应商', `${provider.name} 已${apiKey ? '启用' : '禁用'}`);
    return provider;
  }

  getProviderDashboard() {
    return this.providerRegistry.getStats();
  }

  /**
   * 将任务分配给部门并让员工真正执行
   * 这是让AI员工"真正干活"的核心方法
   * 使用需求管理系统：标准化需求 → 负责人拆解工作流 → 按DAG执行 → 群聊沟通
   * @param {string} departmentId - 目标部门ID
   * @param {string} taskDescription - 任务描述
   * @param {string} [taskTitle] - 任务标题
   * @returns {Promise<object>} 执行结果
   */
  async assignTaskToDepartment(departmentId, taskDescription, taskTitle = null) {
    const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`部门不存在: ${departmentId}`);

    const members = dept.getMembers();
    if (members.length === 0) throw new Error(`部门「${dept.name}」没有员工`);

    const title = taskTitle || taskDescription.slice(0, 50);
    this._log('任务下达', `「${dept.name}」收到任务: "${title}"`);

    // 1. 创建标准化需求
    const requirement = this.requirementManager.create({
      title,
      description: taskDescription,
      departmentId: dept.id,
      departmentName: dept.name,
      bossMessage: taskDescription,
    });

    // 立即持久化，确保需求创建后不丢失
    this.save();
    console.log(`📝 需求已创建: ${requirement.id} - ${title}`);

    // 2. 负责人拆解工作流
    const leader = dept.getLeader() || members[0];
    try {
      await this.requirementManager.planWorkflow(
        requirement, members, leader.provider
      );
    } catch (e) {
      console.error('工作流拆解失败:', e.message);
      // 即使拆解失败也保存当前状态（兜底工作流已在 planWorkflow 内设置）
    }

    // 工作流拆解后再保存一次
    this.save();

    // 3. 按工作流 DAG 执行
    let summary;
    try {
      summary = await this.requirementManager.executeWorkflow(
        requirement, dept, this.performanceSystem
      );
    } catch (e) {
      console.error('工作流执行失败:', e.message);
      // 更新需求状态为失败
      requirement.status = 'failed';
      requirement.completedAt = new Date();
      requirement.summary = { totalTasks: 0, successTasks: 0, failedTasks: 0, totalDuration: 0, outputs: [], error: e.message };
      requirement.addGroupMessage(
        { name: '系统', role: 'system' },
        `❌ 需求执行失败：${e.message}`,
        'system'
      );
      this.save();
      summary = requirement.summary;
    }

    // 4. 让负责人发汇报邮件
    if (leader) {
      let reportContent = `需求「${title}」已完成！\n\n`;
      reportContent += `📊 执行摘要：\n`;
      reportContent += `- 任务完成: ${summary.successTasks}/${summary.totalTasks}\n`;
      reportContent += `- 总耗时: ${Math.round(summary.totalDuration / 1000)}秒\n\n`;
      reportContent += `📝 各成员产出：\n`;
      for (const o of (summary.outputs || [])) {
        reportContent += `\n【${o.agentName} (${o.role})】\n`;
        reportContent += (o.content || '').slice(0, 300);
        if ((o.content || '').length > 300) reportContent += '...';
        reportContent += '\n';
      }
      leader.sendMailToBoss(`📋 需求完成报告: ${title}`, reportContent, this);
    }

    // 5. 记录到进度汇报
    this.progressReports.push({
      time: new Date(),
      type: 'task_completed',
      reports: [{
        department: dept.name,
        task: title,
        requirementId: requirement.id,
        success: summary.successTasks === summary.totalTasks,
        detail: `${summary.successTasks}/${summary.totalTasks}个子任务完成，耗时${Math.round(summary.totalDuration / 1000)}秒`,
      }],
    });

    this._log('任务完成', `「${dept.name}」完成任务: "${title}"，${summary.successTasks}/${summary.totalTasks}成功`);
    this.save();

    // 返回包含需求ID的摘要
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
   * 获取完整的公司状态数据（用于Web渲染）
   */
  getFullState() {
    const departments = [];

    // 计算全公司Token/金额统计
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

    // 加上秘书和HR的消耗
    const secUsage = this.secretary.agent.tokenUsage || { totalTokens: 0, totalCost: 0 };
    const hrUsage = this.secretary.hrAssistant.agent.tokenUsage || { totalTokens: 0, totalCost: 0 };
    companyTotalTokens += secUsage.totalTokens + hrUsage.totalTokens;
    companyTotalCost += secUsage.totalCost + hrUsage.totalCost;

    return {
      id: this.id,
      name: this.name,
      boss: this.bossName,
      secretary: {
        name: this.secretary.agent.name,
        avatar: this.secretary.agent.avatar,
        signature: this.secretary.agent.signature,
        prompt: this.secretary.agent.prompt,
        provider: this.secretary.agent.provider.name,
        providerId: this.secretary.agent.provider.id,
        // 可选的通用岗位供应商列表（仅已启用的）
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
        skills: [...p.skills, ...p.acquiredSkills],
        dismissalReason: p.dismissalReason,
        performanceScore: p.performanceData?.averageScore,
        registeredAt: p.registeredAt,
        memoryCount: p.memorySnapshot ? (p.memorySnapshot.shortTerm?.length || 0) + (p.memorySnapshot.longTerm?.length || 0) : 0,
      })),
      providerDashboard: this.providerRegistry.getStats(),
      messageBusStats: this.messageBus.getStats(),
      requirements: this.requirementManager.listAll().map(r => r.serialize()),
      logs: this.logs.slice(-50),
    };
  }

  /**
   * 获取消息总线的最近消息
   */
  getRecentMessages(limit = 20) {
    return this.messageBus.getRecent(limit);
  }

  /**
   * 获取Agent间的对话
   */
  getConversation(agentId1, agentId2, limit = 50) {
    return this.messageBus.getConversation(agentId1, agentId2, limit);
  }

  /**
   * 获取工作空间文件树
   */
  async getWorkspaceFiles(departmentId) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) return [];
    return this.workspaceManager.getFileTree(dept.workspacePath);
  }

  /**
   * 读取工作空间文件
   */
  async readWorkspaceFile(departmentId, filePath) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) throw new Error('部门工作空间不存在');
    return this.workspaceManager.readFile(dept.workspacePath, filePath);
  }

  printCompanyOverview() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏢 "${this.name}" 公司概况`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 老板: ${this.bossName}`);
    console.log(`🏢 部门数: ${this.departments.size}`);

    this.departments.forEach(dept => {
      console.log(`\n  📁 ${dept.name} (${dept.status})`);
      console.log(`     使命: ${dept.mission}`);
      console.log(`     成员: ${dept.agents.size}人`);
      dept.printOrgChart();
    });

    this.talentMarket.print();
    console.log(`${'='.repeat(60)}\n`);
  }

  // ========== 持久化序列化 ==========

  /**
   * 序列化公司完整状态（用于磁盘持久化）
   */
  serialize() {
    // 序列化部门和Agent
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

    // 序列化供应商配置（只保存API Key和启用状态）
    const providerConfigs = {};
    this.providerRegistry.listAll().forEach(p => {
      if (p.apiKey || p.enabled) {
        providerConfigs[p.id] = { apiKey: p.apiKey, enabled: p.enabled };
      }
    });

    // 序列化人才市场
    const talentPool = [];
    this.talentMarket.pool.forEach((profile, id) => {
      talentPool.push({
        ...profile,
        // provider 只保存id
        provider: profile.provider ? { id: profile.provider.id } : null,
      });
    });

    return {
      _version: 1,
      id: this.id,
      name: this.name,
      bossName: this.bossName,
      departments,
      providerConfigs,
      talentPool,
      mailbox: this.mailbox.slice(-200),
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
      savedAt: new Date(),
    };
  }

  /**
   * 从序列化数据恢复公司（静态工厂方法）
   */
  static deserialize(data) {
    if (!data || !data.name) throw new Error('无效的公司状态数据');

    // 创建空壳公司（不触发完整初始化）
    const company = new Company(data.name, data.bossName, {
      providerId: data.secretary?.providerId || 'deepseek-v3',
      apiKey: 'sk-restored',
      secretaryName: data.secretary?.name,
      secretaryAvatar: data.secretary?.avatar,
    });

    // 恢复ID
    company.id = data.id;

    // 恢复供应商配置
    if (data.providerConfigs) {
      for (const [pid, cfg] of Object.entries(data.providerConfigs)) {
        try {
          company.providerRegistry.configure(pid, cfg.apiKey);
        } catch (e) { /* 忽略不存在的供应商 */ }
      }
    }

    // 恢复秘书Token消耗
    if (data.secretary?.tokenUsage) {
      Object.assign(company.secretary.agent.tokenUsage, data.secretary.tokenUsage);
    }
    if (data.secretary?.hrTokenUsage) {
      Object.assign(company.secretary.hrAssistant.agent.tokenUsage, data.secretary.hrTokenUsage);
    }
    // 恢复秘书的自定义 prompt
    if (data.secretary?.prompt) {
      company.secretary.agent.prompt = data.secretary.prompt;
    }
    // 恢复秘书的签名
    if (data.secretary?.signature) {
      company.secretary.agent.signature = data.secretary.signature;
    }

    // 恢复部门和Agent
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

      // 恢复Agent
      for (const agentData of (deptData.members || [])) {
      // 从独立文件加载记忆（优先级高于序列化数据中的记忆）
        const externalMemory = loadAgentMemory(agentData.id);
        if (externalMemory) {
          agentData.memory = externalMemory;
        }
        const agent = Agent.deserialize(agentData, company.providerRegistry);
        dept.addAgent(agent);
        // 恢复工具集
        if (dept.workspacePath) {
          agent.initToolKit(dept.workspacePath, company.messageBus);
        }
      }

      company.departments.set(dept.id, dept);
    }

    // 恢复人才市场
    company.talentMarket.pool.clear();
    for (const profile of (data.talentPool || [])) {
      // 恢复provider引用
      if (profile.provider?.id) {
        profile.provider = company.providerRegistry.getById(profile.provider.id) || profile.provider;
      }
      company.talentMarket.pool.set(profile.id, profile);
    }

    // 恢复邮箱、聊天历史、进度汇报、日志
    company.mailbox = data.mailbox || [];
    company.chatHistory = data.chatHistory || [];
    company.progressReports = data.progressReports || [];
    company.logs = data.logs || [];

    // 恢复消息总线
    if (data.messageBusMessages) {
      // 只恢复历史记录，不重建inbox
      company.messageBus.messages = data.messageBusMessages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
        toJSON() { return m; },
      }));
    }

    // 恢复需求管理器
    if (data.requirements) {
      company.requirementManager = RequirementManager.deserialize(data.requirements);
    }

    console.log(`✅ 公司「${company.name}」状态已恢复: ${company.departments.size}个部门`);
    return company;
  }
}
