import { v4 as uuidv4 } from 'uuid';
import { Agent } from './agent.js';
import { JobCategory } from './providers.js';
import { llmClient } from './llm-client.js';
import { JobTemplates } from './hr.js';
import { pluginRegistry } from './plugin.js';
import { skillRegistry } from './skills.js';
import { knowledgeManager } from './knowledge.js';

/**
 * Secretary's Dedicated HR Assistant
 * Handles recruitment operations, talent market search, and recall
 */
export class HRAssistant {
  constructor({ secretary, providerConfig }) {
    this.agent = new Agent({
      name: 'HR-Bot',
      role: 'HR Recruiter',
      prompt: `You are the secretary's dedicated HR assistant, responsible for executing recruitment operations.
Your duties include: searching for suitable candidates in the talent market, evaluating candidates' historical performance and skill match,
executing the recruitment process, and coordinating new employee onboarding. You need to make optimal decisions between "recalling former employees" and "hiring new ones" based on position requirements.`,
      skills: ['talent-search', 'resume-screening', 'performance-evaluation', 'recruitment-process', 'onboarding'],
      provider: providerConfig,
    });
    this.secretary = secretary;
  }

  /**
   * Smart recruitment decision: check talent market first, then decide recall vs new hire
   * @param {object} requirement - Job requirement { templateId, name, role, skills }
   * @param {HRSystem} hr - HR system
   * @returns {object} Recruitment result config
   */
  smartRecruit(requirement, hr) {
    const { templateId, name, preferRecall = true } = requirement;

    // If recall is preferred, check talent market first
    if (preferRecall && hr.talentMarket) {
      const template = hr.getTemplate(templateId);
      if (template) {
        // Search for matching talent in the talent market
        const candidates = hr.searchTalentMarket({
          role: template.title,
          skills: template.skills,
        });

        if (candidates.length > 0) {
          // Found matching talent, evaluate whether to recall
          const best = this._pickBestCandidate(candidates, template);
          if (best) {
            console.log(`  🔍 [HR-Bot] Found matching candidate in talent market: ${best.name} (${best.role})`);
            const decision = this._decideRecallOrNew(best, template);
            if (decision === 'recall') {
              console.log(`  ✅ [HR-Bot] Decided to recall former employee: ${best.name}`);
              return hr.recallFromMarket(best.id);
            } else {
              console.log(`  🆕 [HR-Bot] Decided to hire new (former employee not a good match)`);
            }
          }
        } else {
          console.log(`  🔍 [HR-Bot] No matching candidates in talent market, will hire new`);
        }
      }
    }

    // Normal new hire
    return hr.recruit(templateId, name);
  }

  /**
   * Pick best candidate from the list
   */
  _pickBestCandidate(candidates, template) {
    // Sort by skill match score
    const scored = candidates.map(c => {
      const allSkills = [...c.skills, ...c.acquiredSkills];
      const matchCount = template.skills.filter(s =>
        allSkills.some(cs => cs.includes(s) || s.includes(cs))
      ).length;
      const skillScore = matchCount / template.skills.length;

      // Performance bonus
      const perfScore = c.performanceData?.averageScore
        ? c.performanceData.averageScore / 100
        : 0.5;

      return {
        ...c,
        totalScore: skillScore * 0.6 + perfScore * 0.4,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored[0] || null;
  }

  /**
   * Decision: recall or hire new
   * If former employee's composite score > 0.5, recall; otherwise hire new
   */
  _decideRecallOrNew(candidate, template) {
    // If performance data exists and avg score below 50, don't recall
    if (candidate.performanceData?.averageScore < 50) {
      return 'new';
    }
    // If skill match is high, recall
    const allSkills = [...candidate.skills, ...candidate.acquiredSkills];
    const matchCount = template.skills.filter(s =>
      allSkills.some(cs => cs.includes(s) || s.includes(cs))
    ).length;
    if (matchCount >= template.skills.length * 0.5) {
      return 'recall';
    }
    return 'new';
  }
}

/**
 * Secretary Agent - The boss's personal secretary
 * Responsible for analyzing requirements, designing team architecture, coordinating recruitment
 * Now has a dedicated HR assistant to handle recruitment operations
 */
export class Secretary {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar, secretaryGender, secretaryAge }) {
    this.agent = new Agent({
      name: secretaryName || 'Secretary',
      role: 'Personal Secretary',
      prompt: `You are the boss's personal secretary, responsible for understanding business requirements, analyzing required team composition,
designing organizational structure (who does what, who reports to whom, how to collaborate), and coordinating HR for talent recruitment.
You need to plan the number and types of positions based on project requirements to ensure the team can efficiently achieve its goals.
You have a dedicated HR assistant to help you handle specific recruitment tasks, including searching and recalling talent from the talent market.

When communicating with the boss, you need to:
1. Understand the boss's intent (task assignment, progress inquiry, or casual conversation)
2. If it's a task, assign it to the corresponding department
3. Periodically report department progress to the boss`,
      skills: ['requirements-analysis', 'team-planning', 'org-design', 'hr-coordination', 'project-management', 'task-assignment', 'progress-reporting'],
      provider: providerConfig,
      avatar: secretaryAvatar,
      gender: secretaryGender || 'female',
      age: secretaryAge || 18,
    });
    this.company = company;

    // Initialize dedicated HR assistant
    this.hrAssistant = new HRAssistant({
      secretary: this,
      providerConfig,
    });

    console.log(`  🧑‍💼 Secretary's dedicated HR assistant is ready: ${this.hrAssistant.agent.name}`);
  }

  /**
   * Analyze requirements and design team architecture — using AI analysis
   */
  async designTeam(requirement) {
    console.log(`\n🗂️ [Secretary] AI-analyzing requirements and designing team architecture...`);
    console.log(`   Requirement: "${requirement}"\n`);

    if (!this.agent.provider || !this.agent.provider.enabled || !this.agent.provider.apiKey) {
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }

    const plan = await this._aiAnalyzeRequirement(requirement);

    console.log(`📋 [Secretary] Team plan:`);
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

  /**
   * AI-analyze requirements, generate team plan
   */
  async _aiAnalyzeRequirement(requirement) {
    // Build available role list
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));

    const systemPrompt = `You are an experienced corporate secretary skilled at team planning and talent matching.

Here are the available job templates (you can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

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

    const response = await llmClient.chat(this.agent.provider, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Boss's requirement: ${requirement}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    // Track secretary's token consumption
    this.agent._trackUsage(response.usage);

    // Parse JSON
    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse AI response format');
    }

    // Validate and organize
    if (!aiPlan.members || aiPlan.members.length === 0) {
      throw new Error('AI did not plan any members');
    }

    // Ensure template IDs are valid
    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.members = aiPlan.members.filter(m => validTemplateIds.has(m.templateId));

    if (aiPlan.members.length === 0) {
      throw new Error('AI planned invalid job templates');
    }

    console.log(`  🧠 AI analysis rationale: ${aiPlan.reasoning || 'N/A'}`);

    // Convert to standard format
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
      collaborationRules: this._designCollaboration(aiPlan.members),
    };
  }

  _designCollaboration(members) {
    const rules = [];
    rules.push('1. Project leader coordinates overall operations, assigns tasks and tracks progress');
    rules.push('2. Members report to their direct supervisor upon task completion');
    rules.push('3. Peers at the same level can collaborate horizontally');
    rules.push('4. Project progresses in phases, each with clear deliverables');
    return rules;
  }

  /**
   * AI-analyze department adjustment plan: based on boss's goal and current staff, decide hiring/firing
   * @param {object} department - Department data { name, mission, members }
   * @param {string} adjustGoal - Boss's adjustment goal
   * @returns {object} Adjustment plan { reasoning, hires, fires }
   */
  async adjustTeam(department, adjustGoal) {
    console.log(`\n🔧 [Secretary] Analyzing adjustment plan for "${department.name}" department...`);
    console.log(`   Adjustment goal: "${adjustGoal}"\n`);

    // Build current member info
    const currentMembers = department.members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
      avgScore: m.avgScore || null,
      taskCount: m.taskCount || 0,
    }));

    // Available job templates
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));

    if (!this.agent.provider || !this.agent.provider.enabled || !this.agent.provider.apiKey) {
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }

    const plan = await this._aiAnalyzeAdjustment(department, currentMembers, availableRoles, adjustGoal);

    console.log(`📋 [Secretary] Adjustment plan:`);
    console.log(`   Fires: ${plan.fires.length} people, Hires: ${plan.hires.length} people`);

    return plan;
  }

  /**
   * AI-analyze department adjustment
   */
  async _aiAnalyzeAdjustment(department, currentMembers, availableRoles, adjustGoal) {
    const systemPrompt = `You are an experienced corporate secretary skilled at organizational restructuring and HR planning.

Current department info:
- Name: ${department.name}
- Mission: ${department.mission}
- Current members: ${JSON.stringify(currentMembers, null, 2)}

Available job templates (hiring can only choose from these):
${JSON.stringify(availableRoles, null, 2)}

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

    const response = await llmClient.chat(this.agent.provider, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Boss's adjustment goal: ${adjustGoal}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    this.agent._trackUsage(response.usage);

    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse AI response format');
    }

    // Validate fires agentId existence
    const memberIds = new Set(currentMembers.map(m => m.id));
    aiPlan.fires = (aiPlan.fires || []).filter(f => memberIds.has(f.agentId));

    // Validate hires template IDs
    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.hires = (aiPlan.hires || []).filter(h => validTemplateIds.has(h.templateId));

    // Append template titles
    aiPlan.hires = aiPlan.hires.map((h, i) => {
      const template = Object.values(JobTemplates).find(t => t.id === h.templateId);
      return {
        ...h,
        templateTitle: template?.title || h.templateId,
        name: h.name || `NewHire${i + 1}`,
      };
    });

    return {
      reasoning: aiPlan.reasoning || 'Adjusting based on goal',
      fires: aiPlan.fires || [],
      hires: aiPlan.hires || [],
    };
  }

  /**
   * Execute recruitment - Smart decision via HR assistant: prefer talent market recall, otherwise new hire
   * @param {object} plan - Output from designTeam
   * @param {HRSystem} hr - HR system
   * @returns {Array<Agent>} List of recruited Agents
   */
  executeRecruitment(plan, hr) {
    console.log(`\n🔔 [Secretary] Starting recruitment, HR assistant [${this.hrAssistant.agent.name}] handling operations...`);

    const agents = [];
    const skipped = []; // Skipped positions

    for (const memberPlan of plan.members) {
      console.log(`\n  📌 Position: ${memberPlan.templateTitle} (${memberPlan.name})`);

      try {
        // Smart recruitment via HR assistant
        const recruitConfig = this.hrAssistant.smartRecruit(
          {
            templateId: memberPlan.templateId,
            name: memberPlan.name,
            preferRecall: true, // Prefer recalling from talent market
          },
          hr
        );
        const agent = new Agent(recruitConfig);

        // If recalled, add comeback memory
        if (recruitConfig.isRecalled) {
          agent.memory.addLongTerm(
            `Recalled to a new position, carrying past experience and memories back to work`,
            'experience'
          );
          console.log(`  🔄 [${agent.name}] is a former employee recalled from talent market, carrying original memories`);
        }

        agents.push(agent);
      } catch (e) {
        // If caused by provider unavailability, skip this position
        if (e.message.startsWith('PROVIDER_DISABLED:')) {
          const parts = e.message.split(':');
          const category = parts[1];
          const reason = parts[2];
          console.log(`  ⚠️ [HR-Bot] Cannot hire "${memberPlan.templateTitle}": ${reason}`);
          console.log(`     Hint: Please configure API Key for ${category} type providers first`);
          skipped.push({ ...memberPlan, reason });
          // Push null placeholder to maintain index consistency
          agents.push(null);
        } else {
          throw e;
        }
      }
    }

    // Filter out skipped nulls
    const validAgents = agents.filter(Boolean);

    // Establish reporting relationships (handle nulls)
    for (let i = 0; i < plan.members.length; i++) {
      if (!agents[i]) continue;
      const memberPlan = plan.members[i];
      if (memberPlan.reportsTo !== null && agents[memberPlan.reportsTo]) {
        agents[i].setManager(agents[memberPlan.reportsTo]);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ [Secretary] ${skipped.length} positions skipped due to unconfigured providers:`);
      skipped.forEach(s => console.log(`   - ${s.templateTitle}: ${s.reason}`));
    }

    console.log(`\n✅ [Secretary] Recruitment complete! Successfully hired ${validAgents.length}, skipped ${skipped.length}`);
    return validAgents;
  }

  /**
   * Design project execution plan
   */
  designProjectPlan(projectName, description, agents) {
    console.log(`\n📝 [Secretary] Designing project execution plan...`);

    const phases = [];

    const planners = agents.filter(a =>
      ['Product Manager', 'Project Leader'].includes(a.role)
    );
    if (planners.length > 0) {
      phases.push({
        name: 'Requirements Analysis & Planning',
        description: 'Define project goals, scope, and key milestones',
        tasks: planners.map(a => ({
          title: `${a.role}: Analyze requirements and create plan`,
          assigneeId: a.id,
        })),
      });
    }

    const creators = agents.filter(a =>
      !['Product Manager', 'Project Leader'].includes(a.role)
    );
    if (creators.length > 0) {
      phases.push({
        name: 'Core Creation & Development',
        description: 'All roles execute core work in parallel',
        tasks: creators.map(a => ({
          title: `${a.role}: Execute core work`,
          assigneeId: a.id,
        })),
      });
    }

    const leader = agents.find(a => a.role === 'Project Leader');
    if (leader) {
      phases.push({
        name: 'Integration & Delivery',
        description: 'Consolidate all member outputs and deliver final result',
        tasks: [{
          title: 'Project Leader: Integrate results and deliver final output',
          assigneeId: leader.id,
        }],
      });
    }

    const project = {
      id: uuidv4(),
      name: projectName,
      description,
      phases,
      createdAt: new Date(),
    };

    console.log(`   Project plan: ${phases.length} phases`);
    phases.forEach((p, i) => {
      console.log(`   Phase${i + 1}: ${p.name} (${p.tasks.length} tasks)`);
    });

    return project;
  }

  /**
   * Handle boss's message
   * Analyze whether it's task assignment, progress inquiry, or casual conversation
   */
  async handleBossMessage(message, company) {
    if (!this.agent.provider || !this.agent.provider.enabled || !this.agent.provider.apiKey) {
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }

    return await this._llmHandleBossMessage(message, company);
  }

  /**
   * LLM-driven boss message handling
   */
  async _llmHandleBossMessage(message, company) {
    // Build company context
    const deptCount = company.departments.size;
    const departments = [...company.departments.values()].map(d => ({
      name: d.name,
      id: d.id,
      mission: d.mission,
      status: d.status,
      memberCount: d.agents.size,
      leader: d.getLeader()?.name || 'Unassigned',
      members: [...d.agents.values()].map(a => ({
        name: a.name, role: a.role, status: a.status,
      })),
    }));
    const agentCount = departments.reduce((s, d) => s + d.memberCount, 0);
    const talentCount = company.talentMarket.listAvailable().length;

    // Get recent chat history (as multi-turn context)
    const recentHistory = (company.chatHistory || []).slice(-20).map(h => ({
      role: h.role === 'boss' ? 'user' : 'assistant',
      content: h.content,
    }));

    const secretaryPrompt = this.agent.prompt || '';

    // 动态获取插件、技能、知识库信息
    let capabilitiesSection = '';
    try {
      const enabledPlugins = pluginRegistry.list().filter(p => p.state === 'enabled');
      if (enabledPlugins.length > 0) {
        capabilitiesSection += `\n## Installed Plugins (${enabledPlugins.length} active)\n`;
        enabledPlugins.forEach(p => {
          capabilitiesSection += `- 🧩 ${p.name} v${p.version}: ${p.description} (${p.toolCount} tools)\n`;
        });
        // 列出插件提供的具体工具
        const pluginTools = pluginRegistry.getPluginTools();
        if (pluginTools.length > 0) {
          capabilitiesSection += `\nAvailable plugin tools:\n`;
          pluginTools.forEach(t => {
            const fn = t.function || t;
            capabilitiesSection += `  • ${fn.name}: ${fn.description}\n`;
          });
        }
      }
    } catch {}
    try {
      const skills = skillRegistry.list();
      if (skills.length > 0) {
        capabilitiesSection += `\n## Available Skills (${skills.length})\n`;
        skills.forEach(s => {
          capabilitiesSection += `- 🎯 ${s.name}: ${s.description}\n`;
        });
      }
    } catch {}
    try {
      const kbs = knowledgeManager.list();
      if (kbs.length > 0) {
        capabilitiesSection += `\n## Knowledge Bases (${kbs.length})\n`;
        kbs.forEach(kb => {
          capabilitiesSection += `- 📚 ${kb.name}: ${kb.description} (${kb.entryCount || 0} entries)\n`;
        });
      }
    } catch {}

    const systemPrompt = `You are "${this.agent.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour core persona: ${secretaryPrompt}\n` : ''}
Your personality: smart, efficient, approachable. Communicate with the boss like a real, thoughtful secretary — natural, warm, not robotic.

Current company "${company.name}" status:
- Departments: ${deptCount}
- Active employees: ${agentCount}
- Talent market: ${talentCount} available
${departments.length > 0 ? `\nDepartment details:\n${departments.map(d => `  🏢 ${d.name} [${d.status}] - Mission: ${d.mission} | ${d.memberCount} people | Leader: ${d.leader}\n     Members: ${d.members.map(m => m.name + '(' + m.role + ')').join(', ')}`).join('\n')}` : '\nNo departments yet.'}
${capabilitiesSection}
When the boss asks about your capabilities, plugins, tools, skills, or what you can do, you MUST accurately list ALL installed plugins, available tools, skills, and knowledge bases shown above. NEVER say you don't have plugin support.

You must understand the boss's intent and reply naturally. Your reply MUST be a JSON object (return JSON only, nothing else):
{
  "content": "Your natural language reply (like a real secretary — warm, personal, no rigid templates)",
  "action": null or one of the following:
    - { "type": "task_assigned", "departmentId": "dept ID", "departmentName": "dept name", "taskTitle": "short task title (under 10 words)", "taskDescription": "detailed task description including what to do and what to deliver" } - when the boss wants to assign a task to an existing department
    - { "type": "create_department", "departmentName": "department name", "mission": "department mission/responsibilities" } - when the boss explicitly requests creating a new department (no task assignment, just creating the dept)
    - { "type": "need_new_department", "suggestedMission": "task description" } - when the boss wants to assign a task but no existing department can handle it (need to create dept first then assign)
    - { "type": "progress_report" } - when the boss wants to see progress reports
    - null - casual chat or no special action needed
}

## Intent Rules (by priority, high to low):

**Highest Priority - Organizational Management**:
When the boss says "create/establish/set up/found + department", this is an org management operation. **MUST** return create_department, **NEVER** return task_assigned.
  - Even if the message contains words like "help me", as long as the core intent is "create/establish a department", return create_department
  - departmentName: intelligently name the department based on boss's description
  - mission: summarize department mission and responsibilities from boss's description

**High Priority - Assign Task to Existing Department (use this first!)**:
When the boss wants something done, you MUST first check ALL existing departments listed above to see if any can handle it.
Matching criteria (any one is sufficient to assign):
  1. Department name contains task-related keywords (e.g. task is "travel guide", dept named "Travel Guide Dept" → match)
  2. Department mission/description relates to task content (e.g. dept mission mentions "travel"/"guide", task is also travel-related → match)
  3. Department name's core words are semantically related to the task (e.g. "Financial Analysis Dept" can handle "stock analysis" tasks)
Once a matching department is found, you **MUST** return task_assigned, **ABSOLUTELY CANNOT** return need_new_department!
  - departmentId MUST be the real id field from the department info above, don't fabricate
  - departmentName MUST exactly match the name corresponding to the id
  - taskDescription should detail the task content, goals, and deliverables
  - **The department name mentioned in content MUST match the departmentName in action — you can't say "assigning to Dept A" in content but point action to Dept B**

**Lowest Priority - Need New Department (rarely used!)**:
**ONLY when you've checked every existing department and confirmed none has even the slightest relation to the task** can you return need_new_department.
⚠️ Before returning need_new_department, triple-check:
  - Have you checked every existing department?
  - Is there really no department whose name contains task-related words?
  - Is there really no department whose mission relates to the task?
If in any doubt, assign to the closest department (task_assigned) rather than returning need_new_department

**Low Priority - View Progress**:
When the boss asks about progress/status/reports, return progress_report

**No Action**: casual chat, greetings, etc. — set action to null

## Notes:
1. Content should be natural and personal, avoid rigid templates, feel free to add emoji
2. Keep replies concise, don't be verbose
3. **Critical**: When the boss's message contains action verbs (like "help me", "build", "develop", "design", "do", "write", "analyze", "research", "create", "produce", "plan", etc.), you **MUST** return an action. **ABSOLUTELY NEVER** just say "I'll arrange it" in content without returning an action. This is the most important rule — without an action, the task won't actually execute!
4. **Critical**: Carefully distinguish "creating a department" from "assigning a task" — "help me set up an XX department" is create_department, while "help me write an analysis report" is task assignment (task_assigned/need_new_department)
5. **Critical**: When the boss says "do XX", "help me XX" and other clear task directives, return task_assigned if there's a suitable existing department, otherwise return need_new_department. Never just chat without working!
6. **Critical - Consistency Principle**: Your content and action MUST be consistent! If content says "assigning to XX department", then action's departmentId/departmentName must point to that same department. If content mentions one department but action is need_new_department, that's a serious error!
7. **Critical - Structured Output**: You MUST always return valid JSON. Do NOT wrap it in markdown code fences. Do NOT add any text outside the JSON object. The response must start with { and end with }.
8. **Critical - Action Required for Tasks**: If the boss's message expresses ANY intent to get work done (in any language), you MUST return an action. Analyze the semantic meaning, not just keywords. For example: "帮我做个网站" (help me build a website), "写一份报告" (write a report), "分析一下数据" (analyze the data) — ALL of these require an action.
9. **Critical - Language Agnostic**: The boss may speak in any language (Chinese, English, Japanese, etc.). You must understand the intent regardless of language and return the correct structured action.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ];

    const response = await llmClient.chat(this.agent.provider, messages, {
      temperature: 0.8,
      maxTokens: 1024,
    });

    this.agent._trackUsage(response.usage);

    // Parse JSON reply
    try {
      let jsonStr = response.content.trim();
      // Remove markdown code block wrapping (supports multiple formats)
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      // Try to extract the first JSON object
      const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjMatch) {
        jsonStr = jsonObjMatch[0];
      }
      const parsed = JSON.parse(jsonStr);
      let result = {
        content: parsed.content || response.content,
        action: parsed.action || null,
      };

      console.log(`🤖 [Secretary-LLM] action type: ${result.action?.type || 'null'}, departmentId: ${result.action?.departmentId || 'N/A'}`);

      // Validate task_assigned departmentId (LLM may return dept name instead of UUID)
      if (result.action?.type === 'task_assigned' && result.action.departmentId) {
        const deptById = company.departments.get(result.action.departmentId);
        if (!deptById) {
          // departmentId invalid, try matching by name
          const deptIdValue = result.action.departmentId;
          const deptNameValue = result.action.departmentName || deptIdValue;
          let foundDept = null;
          for (const dept of company.departments.values()) {
            if (dept.name === deptIdValue || dept.name === deptNameValue ||
                dept.name.includes(deptIdValue) || deptIdValue.includes(dept.name)) {
              foundDept = dept;
              break;
            }
          }
          if (foundDept) {
            console.log(`🔧 Fixed departmentId: "${deptIdValue}" → "${foundDept.id}" (${foundDept.name})`);
            result.action.departmentId = foundDept.id;
            result.action.departmentName = foundDept.name;
          } else {
            // Cannot find at all, clear action for fallback logic
            console.warn(`⚠️ LLM returned departmentId "${deptIdValue}" doesn't match any department, clearing action`);            result.action = null;
          }
        } else {
          // departmentId valid, but need to verify content/action consistency
          // Prevent LLM from saying "assigning to Dept A" but action points to Dept B
          const contentLower = (result.content || '').toLowerCase();
          const actionDeptName = deptById.name.toLowerCase();
          let contentMentionedDept = null;
          for (const dept of company.departments.values()) {
            if (dept.id !== deptById.id && contentLower.includes(dept.name.toLowerCase())) {
              contentMentionedDept = dept;
              break;
            }
          }
          // If content explicitly mentions another department while action's department isn't mentioned in content
          if (contentMentionedDept && !contentLower.includes(actionDeptName)) {
            console.log(`🔧 Consistency fix: content mentions "${contentMentionedDept.name}" but action points to "${deptById.name}", using content as source of truth`);
            result.action.departmentId = contentMentionedDept.id;
            result.action.departmentName = contentMentionedDept.name;
          }
        }
      }

      return result;
    } catch (parseError) {
      console.warn('⚠️ Secretary JSON parse failed:', parseError.message, '\nRaw reply:', response.content.slice(0, 200));
      
      // Try to extract content field from raw reply (even if overall JSON parse failed)
      let displayContent = response.content;
      const contentFieldMatch = response.content.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (contentFieldMatch) {
        try {
          displayContent = JSON.parse('"' + contentFieldMatch[1] + '"');
        } catch {
          displayContent = contentFieldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }
      
      // Try to extract action field from raw reply (overall JSON failed, but action field may be extractable)
      let action = null;
      const actionTypeMatch = response.content.match(/"type"\s*:\s*"(task_assigned|need_new_department|create_department|progress_report)"/);
      
      if (actionTypeMatch) {
        const actionType = actionTypeMatch[1];
        if (actionType === 'task_assigned') {
          const deptNameMatch = response.content.match(/"departmentName"\s*:\s*"([^"]+)"/);
          if (deptNameMatch) {
            const targetName = deptNameMatch[1];
            for (const dept of company.departments.values()) {
              if (dept.name === targetName || dept.name.includes(targetName) || targetName.includes(dept.name)) {
                const titleMatch = response.content.match(/"taskTitle"\s*:\s*"([^"]+)"/);
                const descMatch = response.content.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                action = {
                  type: 'task_assigned',
                  departmentId: dept.id,
                  departmentName: dept.name,
                  taskTitle: titleMatch ? titleMatch[1] : message.slice(0, 50),
                  taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message,
                };
                break;
              }
            }
          }
        } else if (actionType === 'create_department') {
          const deptNameMatch = response.content.match(/"departmentName"\s*:\s*"([^"]+)"/);
          const missionMatch = response.content.match(/"mission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = {
            type: 'create_department',
            departmentName: deptNameMatch ? deptNameMatch[1] : '',
            mission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message,
          };
        } else if (actionType === 'need_new_department') {
          const missionMatch = response.content.match(/"suggestedMission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = {
            type: 'need_new_department',
            suggestedMission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message,
          };
        } else if (actionType === 'progress_report') {
          action = { type: 'progress_report' };
        }
      }

      let result = {
        content: displayContent,
        action,
      };

      console.log(`🤖 [Secretary-LLM-FaultTolerant] action type: ${result.action?.type || 'null'}`);

      return result;
    }
  }

}
