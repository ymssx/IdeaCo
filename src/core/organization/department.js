import { v4 as uuidv4 } from 'uuid';
import { JobTemplates } from './workforce/hr.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';
import { chatStore } from '../agent/chat-store.js';
// Agent instances are passed in from outside; no direct import needed

/**
 * Department - A collaborative unit composed of multiple Agents
 * Supports performance evaluation process and member dismissal
 */
export class Department {
  constructor({ name, mission, company }) {
    this.id = uuidv4();
    this.name = name;             // Department name
    this.mission = mission;       // Department mission / goal
    this.company = company;       // Parent company
    this.agents = new Map();      // Department members (agentId => Agent)
    this.leader = null;           // Department leader
    this.orgStructure = null;     // Org structure description
    this.tasks = [];              // Department task list
    this.status = 'preparing';    // preparing | active | completed | disbanded
    this.createdAt = new Date();
    this.groupChat = [];          // Department group chat message list
  }

  /**
   * Add department group chat message
   * @param {object} from - Sender { id, name, avatar, role }
   * @param {string} content - Message content
   * @param {string} type - Message type: message | system
   * @param {string} visibility - Visibility: 'group' (broadcast) | 'flow' (worklog only)
   */
  addGroupMessage(from, content, type = 'message', visibility = 'group') {
    const msg = {
      id: uuidv4(),
      from: {
        id: from.id || 'system',
        name: from.name || 'System',
        avatar: from.avatar || null,
        role: from.role || null,
      },
      content,
      type,
      visibility,
      time: new Date(),
    };
    this.groupChat.push(msg);
    // Persist to file storage
    try { chatStore.appendGroupMessage(`dept-${this.id}`, msg); } catch {}
  }

  /**
   * Load group chat from file storage (called during deserialization).
   * Also handles one-time migration of legacy inline groupChat data.
   * @param {Array} [legacyGroupChat] - Legacy inline data to migrate
   */
  loadGroupChatFromStore(legacyGroupChat = null) {
    const groupId = `dept-${this.id}`;
    if (legacyGroupChat && legacyGroupChat.length > 0) {
      chatStore.migrateGroupChat(groupId, legacyGroupChat);
    }
    this.groupChat = chatStore.getGroupMessages(groupId, 500);
  }

  /** Add an Agent to the department */
  addAgent(agent) {
    agent.department = this.id;
    this.agents.set(agent.id, agent);
    console.log(`  ✅ [${agent.name}] (${agent.role}) joined department "${this.name}"`);
    const providerInfo = agent.getProviderDisplayInfo?.() || {};
    console.log(`     Model provider: ${providerInfo.name || 'Unknown'} (${providerInfo.provider || 'Unknown'})`);
    return agent;
  }

  /**
   * Remove an Agent (department-level operation before dismissal)
   * @param {string} agentId - The Agent ID to remove
   * @returns {Agent|null} The removed Agent
   */
  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // If this is the leader, clear the leader reference
    if (this.leader === agentId) {
      this.leader = null;
    }

    // Clean up reporting lines: transfer subordinates to their manager's superior
    const managerId = agent.reportsTo;
    const manager = managerId ? this.agents.get(managerId) : null;

    // Reassign subordinates to the superior
    for (const subId of agent.subordinates) {
      const sub = this.agents.get(subId);
      if (sub) {
        if (manager) {
          sub.setManager(manager);
          console.log(`  🔄 [${sub.name}] reporting line transferred to [${manager.name}]`);
        } else {
          sub.reportsTo = null;
        }
      }
    }

    // Clean up superior's subordinate list
    if (manager) {
      manager.subordinates = manager.subordinates.filter(id => id !== agentId);
    }

    // Remove from department
    this.agents.delete(agentId);
    agent.department = null;
    agent.reportsTo = null;
    agent.subordinates = [];

    console.log(`  🚪 [${agent.name}] (${agent.role}) left department "${this.name}"`);
    return agent;
  }

  /** Set the department leader */
  setLeader(agent) {
    this.leader = agent.id;
    console.log(`  👔 [${agent.name}] appointed as leader of department "${this.name}"`);
  }

  /** Establish reporting line */
  setReportingLine(subordinate, manager) {
    subordinate.setManager(manager);
    console.log(`  📋 Reporting line: [${subordinate.name}] → [${manager.name}]`);
  }

  /** Get all department members */
  getMembers() {
    return [...this.agents.values()];
  }

  /** Get the department leader (fallback: promote first member if leader is missing) */
  getLeader() {
    const leader = this.agents.get(this.leader);
    if (leader) return leader;
    // Fallback: if leader is null or removed, promote the first member
    if (this.agents.size > 0) {
      const first = this.agents.values().next().value;
      this.leader = first.id;
      console.log(`  ⚠️ Department "${this.name}" had no leader, auto-promoted [${first.name}] as leader`);
      return first;
    }
    return null;
  }

  /** Get subordinates of a member */
  getSubordinates(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    return agent.subordinates
      .map(subId => this.agents.get(subId))
      .filter(Boolean);
  }

  /**
   * Execute a project collaboratively, with automatic performance review upon completion
   * @param {object} project - The project
   * @param {PerformanceSystem} [performanceSystem] - Performance system (optional)
   */
  async executeProject(project, performanceSystem = null) {
    console.log(`\n🏢 Department "${this.name}" starts executing project: "${project.name}"`);
    console.log(`   Description: ${project.description}`);
    console.log(`   Members: ${this.agents.size}\n`);

    this.status = 'active';
    const results = [];
    // Collect completed tasks per agent for subsequent performance review
    const agentTaskMap = new Map();

    // Execute by task phases
    for (const phase of project.phases) {
      console.log(`\n📌 Phase: ${phase.name}`);
      console.log(`   ${phase.description}`);

      // Execute tasks within the same phase in parallel
      const phasePromises = phase.tasks.map(async (task) => {
        const assignee = this.agents.get(task.assigneeId);
        if (!assignee) {
          console.log(`  ⚠️ Task assignee not found: ${task.assigneeId}`);
          return null;
        }
        const result = await assignee.executeTask(task);

        // Record tasks completed by the agent
        if (!agentTaskMap.has(task.assigneeId)) {
          agentTaskMap.set(task.assigneeId, []);
        }
        agentTaskMap.get(task.assigneeId).push({
          task,
          result,
        });

        return result;
      });

      const phaseResults = await Promise.all(phasePromises);
      results.push({
        phase: phase.name,
        results: phaseResults.filter(Boolean),
      });

      // Report after phase completion
      const leader = this.getLeader();
      if (leader) {
        console.log(`\n  📊 [${leader.name}] summarizing phase "${phase.name}" results...`);
      }
    }

    this.status = 'completed';
    console.log(`\n✅ Department "${this.name}" completed project "${project.name}"!`);

    // Run performance review after project completion
    if (performanceSystem) {
      console.log(`\n📋 Starting project performance review...`);
      await this._runPerformanceReview(performanceSystem, agentTaskMap);
    }

    return results;
  }

  /**
   * Run performance review: superiors rate subordinates, employees provide self-reflection
   */
  async _runPerformanceReview(performanceSystem, agentTaskMap) {
    const leader = this.getLeader();

    for (const [agentId, taskResults] of agentTaskMap) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      // Find the agent's direct supervisor as the reviewer
      let reviewer = null;
      if (agent.reportsTo) {
        reviewer = this.agents.get(agent.reportsTo);
      }
      // If no supervisor, the department leader reviews
      if (!reviewer && leader && leader.id !== agentId) {
        reviewer = leader;
      }
      // Leader self-review (or skip)
      if (!reviewer) continue;

      // Evaluate each task
      for (const { task } of taskResults) {
        const review = performanceSystem.autoEvaluate({
          agent,
          reviewer,
          taskTitle: task.title,
        });

        // Employee receives feedback and self-reflects
        agent.receiveFeedback(review);
      }
    }

    console.log(`\n✅ Performance review completed!`);
  }

  /** Get the department org chart tree */
  getOrgTree() {
    const leader = this.getLeader();
    if (!leader) return null;

    const buildTree = (agent) => ({
      name: agent.name,
      role: agent.role,
      provider: agent.getProviderDisplayInfo().name,
      subordinates: this.getSubordinates(agent.id).map(sub => buildTree(sub)),
    });

    return buildTree(leader);
  }

  /** Print org chart */
  printOrgChart(node = null, indent = '  ') {
    if (!node) {
      node = this.getOrgTree();
      if (!node) {
        console.log('  (No org structure yet)');
        return;
      }
      console.log(`\n📊 Department "${this.name}" org chart:`);
    }

    console.log(`${indent}├── 👤 ${node.name} (${node.role}) [${node.provider}]`);
    node.subordinates.forEach(sub => {
      this.printOrgChart(sub, indent + '│   ');
    });
  }

  // ======================== Team Design ========================

  /**
   * AI-analyze requirements and design team architecture for this department.
   * @param {string} requirement - The mission/requirement description
   * @param {import('../employee/base-employee.js').Employee} analyst - An LLM-capable employee (e.g. secretary) to perform the analysis
   * @param {import('./workforce/providers.js').ProviderRegistry} providerRegistry - Provider registry for hiring constraints
   * @returns {Promise<object>} Team plan
   */
  async designTeam(requirement, analyst, providerRegistry) {
    console.log(`\n🗂️ [${this.name}] AI-analyzing requirements and designing team architecture...`);
    console.log(`   Requirement: "${requirement}"\n`);

    const isCLI = analyst.agentType === 'cli';
    const canChat = analyst.canChat();
    if (!canChat && !isCLI) {
      throw new Error('Analyst AI is not configured. Please configure a valid API Key or CLI backend for the analyst provider first.');
    }

    const plan = isCLI && !canChat
      ? await this._cliAnalyzeRequirement(requirement, analyst, providerRegistry)
      : await this._aiAnalyzeRequirement(requirement, analyst, providerRegistry);

    console.log(`📋 [${this.name}] Team plan:`);
    console.log(`   Department: ${plan.departmentName}`);
    console.log(`   Mission: ${plan.mission}`);
    console.log(`   Team size: ${plan.members.length} people`);
    plan.members.forEach((m, i) => {
      const indent = m.reportsTo !== null ? '      ' : '    ';
      const prefix = m.isLeader ? '👔' : '👤';
      console.log(`${indent}${prefix} ${m.name} - ${m.templateTitle} ${m.reportsTo !== null ? `(reports to: ${plan.members[m.reportsTo].name})` : '(leader)'}`);
    });

    return plan;
  }

  async _aiAnalyzeRequirement(requirement, analyst, providerRegistry) {
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));
    const enabledProviders = providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category, rating: p.rating,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    const systemPrompt = `You are an experienced corporate secretary skilled at team planning and talent matching.

Here are the available job templates (you can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

## Currently enabled providers (IMPORTANT - only templates whose category has an enabled provider can be hired!):
${JSON.stringify(enabledProviders, null, 2)}

Available categories: ${availableCategories.join(', ')}

⚠️ CRITICAL RULES for provider-aware hiring:
- You can ONLY use templates whose category has at least one enabled provider above.
- If the boss mentions a specific provider name (e.g. "CodeBuddy", "Claude Code", "Codex"), you MUST use a CLI template (category: "cli") for that position.
- CLI templates (cli-software-engineer, cli-fullstack-developer, cli-code-reviewer) use local CLI tools as execution engines. They are powerful coding assistants.
- When CLI providers are available and the task is coding-related, PREFER CLI templates over general templates — they can directly execute code on the local machine.
- If the boss says something like "hire a CodeBuddy employee" or "add a CodeBuddy developer", choose a cli-* template.

Based on the boss's requirements, output a team plan in JSON format as follows:
{
  "departmentName": "Department name",
  "mission": "Department mission (concise description)",
  "reasoning": "Your analysis rationale (why this configuration)",
  "members": [
    {
      "templateId": "Job template ID",
      "name": "Employee nickname (use creative, fun names)",
      "isLeader": true/false,
      "reportsTo": null or numeric index,
      "reason": "Why this position is needed"
    }
  ]
}

Requirements:
1. The first member must be project-leader with isLeader=true
2. Other members' reportsTo should be the index of their direct supervisor (0 = project leader)
3. Team size should be reasonable, typically 2-6 people, don't pad the roster
4. Employee names should be distinctive and fun
5. Return JSON only, no other content`;

    const response = await analyst.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Boss's requirement: ${requirement}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse AI response format');
    }

    if (!aiPlan.members || aiPlan.members.length === 0) {
      throw new Error('AI did not plan any members');
    }

    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.members = aiPlan.members.filter(m => validTemplateIds.has(m.templateId));
    if (aiPlan.members.length === 0) throw new Error('AI planned invalid job templates');

    console.log(`  🧠 AI analysis rationale: ${aiPlan.reasoning || 'N/A'}`);

    return {
      departmentName: aiPlan.departmentName || 'New Project Dept',
      mission: aiPlan.mission || requirement,
      reasoning: aiPlan.reasoning,
      members: aiPlan.members.map((m, i) => {
        const template = Object.values(JobTemplates).find(t => t.id === m.templateId);
        return {
          templateId: m.templateId,
          templateTitle: template?.title || m.templateId,
          name: m.name || `Employee${i + 1}`,
          isLeader: m.isLeader || false,
          reportsTo: m.reportsTo ?? (i === 0 ? null : 0),
          reason: m.reason,
        };
      }),
      collaborationRules: Department._designCollaboration(aiPlan.members),
    };
  }

  async _cliAnalyzeRequirement(requirement, analyst, providerRegistry) {
    console.log(`  🖥️ [${this.name}] Using CLI backend for team design: ${analyst.cliBackend}`);

    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));
    const enabledProviders = providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category, rating: p.rating,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    const prompt = `You are an experienced corporate secretary skilled at team planning and talent matching.

Here are the available job templates (you can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

## Currently enabled providers (IMPORTANT - only templates whose category has an enabled provider can be hired!):
${JSON.stringify(enabledProviders, null, 2)}

Available categories: ${availableCategories.join(', ')}

⚠️ CRITICAL RULES for provider-aware hiring:
- You can ONLY use templates whose category has at least one enabled provider above.
- If the boss mentions a specific provider name (e.g. "CodeBuddy", "Claude Code", "Codex"), you MUST use a CLI template (category: "cli") for that position.
- CLI templates (cli-software-engineer, cli-fullstack-developer, cli-code-reviewer) use local CLI tools as execution engines.
- When CLI providers are available and the task is coding-related, PREFER CLI templates over general templates.

Based on the boss's requirements, output a team plan in JSON format as follows:
{
  "departmentName": "Department name",
  "mission": "Department mission (concise description)",
  "reasoning": "Your analysis rationale",
  "members": [
    {
      "templateId": "Job template ID",
      "name": "Employee nickname",
      "isLeader": true/false,
      "reportsTo": null or numeric index,
      "reason": "Why this position is needed"
    }
  ]
}

Requirements:
1. The first member must be project-leader with isLeader=true
2. Other members' reportsTo should be the index of their direct supervisor (0 = project leader)
3. Team size should be reasonable, typically 2-6 people
4. Employee names should be distinctive and fun
5. Return JSON only, no other content

Boss's requirement: ${requirement}`;

    const cliResult = await cliBackendRegistry.executeTask(
      analyst.cliBackend, analyst, { title: 'Team design analysis', description: prompt },
      analyst.toolKit?.workspaceDir || process.cwd(), {}, { timeout: 120000 }
    );

    const rawOutput = cliResult.output || cliResult.errorOutput || '';
    let aiPlan;
    try { aiPlan = Department._extractJSON(rawOutput); }
    catch (e) { throw new Error(`Failed to parse CLI response for team design: ${e.message}`); }

    if (!aiPlan.members || aiPlan.members.length === 0) throw new Error('CLI did not plan any members');

    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.members = aiPlan.members.filter(m => validTemplateIds.has(m.templateId));
    if (aiPlan.members.length === 0) throw new Error('CLI planned invalid job templates');

    console.log(`  🧠 CLI analysis rationale: ${aiPlan.reasoning || 'N/A'}`);

    return {
      departmentName: aiPlan.departmentName || 'New Project Dept',
      mission: aiPlan.mission || requirement,
      reasoning: aiPlan.reasoning,
      members: aiPlan.members.map((m, i) => {
        const template = Object.values(JobTemplates).find(t => t.id === m.templateId);
        return {
          templateId: m.templateId,
          templateTitle: template?.title || m.templateId,
          name: m.name || `Employee${i + 1}`,
          isLeader: m.isLeader || false,
          reportsTo: m.reportsTo ?? (i === 0 ? null : 0),
          reason: m.reason,
        };
      }),
      collaborationRules: Department._designCollaboration(aiPlan.members),
    };
  }

  // ======================== Team Adjustment ========================

  /**
   * Analyze and plan team adjustment for this department.
   * @param {string} adjustGoal - Adjustment goal description
   * @param {import('../employee/base-employee.js').Employee} analyst - An LLM-capable employee to perform the analysis
   * @param {import('./workforce/providers.js').ProviderRegistry} providerRegistry - Provider registry
   * @returns {Promise<object>} Adjustment plan { reasoning, fires, hires }
   */
  async adjustTeam(adjustGoal, analyst, providerRegistry) {
    console.log(`\n🔧 [${this.name}] Analyzing adjustment plan...`);
    console.log(`   Adjustment goal: "${adjustGoal}"\n`);

    const currentMembers = this.getMembers().map(m => ({
      id: m.id, name: m.name, role: m.role, skills: m.skills,
      avgScore: m.avgScore || null, taskCount: m.taskCount || 0,
    }));
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));

    const isCLI = analyst.agentType === 'cli';
    const canChat = analyst.canChat();
    if (!canChat && !isCLI) {
      throw new Error('Analyst AI is not configured. Please configure a valid API Key or CLI backend for the analyst provider first.');
    }

    const plan = isCLI && !canChat
      ? await this._cliAnalyzeAdjustment(currentMembers, availableRoles, adjustGoal, analyst, providerRegistry)
      : await this._aiAnalyzeAdjustment(currentMembers, availableRoles, adjustGoal, analyst, providerRegistry);

    console.log(`📋 [${this.name}] Adjustment plan:`);
    console.log(`   Fires: ${plan.fires.length} people, Hires: ${plan.hires.length} people`);

    return plan;
  }

  async _aiAnalyzeAdjustment(currentMembers, availableRoles, adjustGoal, analyst, providerRegistry) {
    const enabledProviders = providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category, rating: p.rating,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    const systemPrompt = `You are an experienced corporate secretary skilled at organizational restructuring and HR planning.

Current department info:
- Name: ${this.name}
- Mission: ${this.mission}
- Current members: ${JSON.stringify(currentMembers, null, 2)}

Available job templates (hiring can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

## Currently enabled providers (IMPORTANT - only templates whose category has an enabled provider can be hired!):
${JSON.stringify(enabledProviders, null, 2)}

Available categories: ${availableCategories.join(', ')}

⚠️ CRITICAL RULES for provider-aware hiring:
- You can ONLY use templates whose category has at least one enabled provider above.
- If the boss mentions a specific provider/tool name (e.g. "CodeBuddy", "Claude Code", "Codex"), you MUST use a CLI template (category: "cli") for that position.
- CLI templates use local CLI tools as execution engines — they are powerful coding assistants that can directly execute code.
- When CLI providers are available and the task involves coding, PREFER CLI templates over general templates.

Based on the boss's adjustment goal, output an adjustment plan in JSON format as follows:
{
  "reasoning": "Your analysis rationale (why this adjustment)",
  "fires": [
    { "agentId": "Member ID to fire", "name": "Member name", "reason": "Firing reason" }
  ],
  "hires": [
    {
      "templateId": "Job template ID",
      "name": "New employee nickname (use creative, fun names)",
      "isLeader": false,
      "reportsTo": 0,
      "reason": "Why this position is needed"
    }
  ]
}

Requirements:
1. Make reasonable decisions based on boss's goal: could be pure layoff, pure hiring, or both
2. When firing, prioritize low performers and skill mismatches
3. When hiring, fill capability gaps with distinctive names
4. hires reportsTo is the index (0-based) in the current member list, or -1 for direct report to leader
5. If no firing needed, fires is an empty array; if no hiring needed, hires is an empty array
6. Return JSON only, no other content`;

    const response = await analyst.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Boss's adjustment goal: ${adjustGoal}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) { throw new Error('Failed to parse AI response format'); }

    const memberIds = new Set(currentMembers.map(m => m.id));
    aiPlan.fires = (aiPlan.fires || []).filter(f => memberIds.has(f.agentId));

    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.hires = (aiPlan.hires || []).filter(h => validTemplateIds.has(h.templateId));
    aiPlan.hires = aiPlan.hires.map((h, i) => {
      const template = Object.values(JobTemplates).find(t => t.id === h.templateId);
      return { ...h, templateTitle: template?.title || h.templateId, name: h.name || `NewHire${i + 1}` };
    });

    return { reasoning: aiPlan.reasoning || 'Adjusting based on goal', fires: aiPlan.fires || [], hires: aiPlan.hires || [] };
  }

  async _cliAnalyzeAdjustment(currentMembers, availableRoles, adjustGoal, analyst, providerRegistry) {
    console.log(`  🖥️ [${this.name}] Using CLI backend for adjustment analysis: ${analyst.cliBackend}`);

    const enabledProviders = providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category, rating: p.rating,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    const prompt = `You are an experienced corporate secretary skilled at organizational restructuring and HR planning.

Current department info:
- Name: ${this.name}
- Mission: ${this.mission}
- Current members: ${JSON.stringify(currentMembers, null, 2)}

Available job templates (hiring can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

## Currently enabled providers (IMPORTANT - only templates whose category has an enabled provider can be hired!):
${JSON.stringify(enabledProviders, null, 2)}

Available categories: ${availableCategories.join(', ')}

⚠️ CRITICAL RULES for provider-aware hiring:
- You can ONLY use templates whose category has at least one enabled provider above.
- CLI templates use local CLI tools as execution engines — they are powerful coding assistants.
- When CLI providers are available and the task involves coding, PREFER CLI templates over general templates.

Based on the boss's adjustment goal, output an adjustment plan in JSON format as follows:
{
  "reasoning": "Your analysis rationale",
  "fires": [
    { "agentId": "Member ID to fire", "name": "Member name", "reason": "Firing reason" }
  ],
  "hires": [
    {
      "templateId": "Job template ID",
      "name": "New employee nickname",
      "isLeader": false,
      "reportsTo": 0,
      "reason": "Why this position is needed"
    }
  ]
}

Requirements:
1. Make reasonable decisions based on boss's goal
2. When firing, prioritize low performers and skill mismatches
3. When hiring, fill capability gaps with distinctive names
4. hires reportsTo is the index (0-based) in the current member list, or -1 for direct report to leader
5. If no firing needed, fires is an empty array; if no hiring needed, hires is an empty array
6. Return JSON only, no other content

Boss's adjustment goal: ${adjustGoal}`;

    const cliResult = await cliBackendRegistry.executeTask(
      analyst.cliBackend, analyst,
      { title: 'Department adjustment analysis', description: prompt },
      analyst.toolKit?.workspaceDir || process.cwd(), {}, { timeout: 120000 }
    );

    const rawOutput = cliResult.output || cliResult.errorOutput || '';
    let aiPlan;
    try { aiPlan = Department._extractJSON(rawOutput); }
    catch (e) { throw new Error(`Failed to parse CLI response for adjustment: ${e.message}`); }

    const memberIds = new Set(currentMembers.map(m => m.id));
    aiPlan.fires = (aiPlan.fires || []).filter(f => memberIds.has(f.agentId));

    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.hires = (aiPlan.hires || []).filter(h => validTemplateIds.has(h.templateId));
    aiPlan.hires = aiPlan.hires.map((h, i) => {
      const template = Object.values(JobTemplates).find(t => t.id === h.templateId);
      return { ...h, templateTitle: template?.title || h.templateId, name: h.name || `NewHire${i + 1}` };
    });

    return { reasoning: aiPlan.reasoning || 'Adjusting based on goal', fires: aiPlan.fires || [], hires: aiPlan.hires || [] };
  }

  // ======================== Static Helpers ========================

  static _extractJSON(rawOutput) {
    try { return JSON.parse(rawOutput.trim()); } catch {}
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    const start = rawOutput.indexOf('{');
    const end = rawOutput.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(rawOutput.slice(start, end + 1));
    throw new Error('Cannot extract JSON from output');
  }

  static _designCollaboration(members) {
    return [
      '1. Project leader coordinates overall operations, assigns tasks and tracks progress',
      '2. Members report to their direct supervisor upon task completion',
      '3. Peers at the same level can collaborate horizontally',
      '4. Project progresses in phases, each with clear deliverables',
    ];
  }

  /** Get department summary */
  getSummary() {
    return {
      id: this.id,
      name: this.name,
      mission: this.mission,
      status: this.status,
      memberCount: this.agents.size,
      leader: this.getLeader()?.name,
      members: this.getMembers().map(a => a.getSummary()),
    };
  }
}
