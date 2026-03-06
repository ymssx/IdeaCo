import { Employee } from './base-employee.js';
import { createEmployee } from './index.js';

import { pluginRegistry } from '../system/plugin.js';
import { skillRegistry } from './skills.js';
import { knowledgeManager } from './knowledge.js';
import { chatStore } from '../agent/chat-store.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';


/**
 * Secretary's Dedicated HR Assistant
 * Handles recruitment operations, talent market search, and recall
 */
export class HRAssistant {
  constructor({ secretary, providerConfig }) {
    // HR assistant is always an Employee (LLM-based)
    this.employee = new Employee({
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

  smartRecruit(requirement, hr) {
    const { templateId, name, preferRecall = true } = requirement;

    if (preferRecall && hr.talentMarket) {
      const template = hr.getTemplate(templateId);
      if (template) {
        const candidates = hr.searchTalentMarket({
          role: template.title, skills: template.skills,
        });

        if (candidates.length > 0) {
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

    return hr.recruit(templateId, name);
  }

  _pickBestCandidate(candidates, template) {
    const scored = candidates.map(c => {
      const allSkills = [...c.skills, ...c.acquiredSkills];
      const matchCount = template.skills.filter(s =>
        allSkills.some(cs => cs.includes(s) || s.includes(cs))
      ).length;
      const skillScore = matchCount / template.skills.length;
      const perfScore = c.performanceData?.averageScore ? c.performanceData.averageScore / 100 : 0.5;
      return { ...c, totalScore: skillScore * 0.6 + perfScore * 0.4 };
    });
    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored[0] || null;
  }

  _decideRecallOrNew(candidate, template) {
    if (candidate.performanceData?.averageScore < 50) return 'new';
    const allSkills = [...candidate.skills, ...candidate.acquiredSkills];
    const matchCount = template.skills.filter(s =>
      allSkills.some(cs => cs.includes(s) || s.includes(cs))
    ).length;
    if (matchCount >= template.skills.length * 0.5) return 'recall';
    return 'new';
  }

  /**
   * Execute recruitment based on a team plan.
   * @param {object} plan - Team plan with members array
   * @param {object} hr - HRSystem instance
   * @returns {Array} Array of recruited employees
   */
  executeRecruitment(plan, hr) {
    console.log(`\n🔔 [HR] Starting recruitment, HR assistant [${this.employee.name}] handling operations...`);

    const employees = [];
    const skipped = [];

    for (const memberPlan of plan.members) {
      console.log(`\n  📌 Position: ${memberPlan.templateTitle} (${memberPlan.name})`);

      try {
        const recruitConfig = this.smartRecruit(
          { templateId: memberPlan.templateId, name: memberPlan.name, preferRecall: true },
          hr
        );
        const employee = createEmployee(recruitConfig);

        if (recruitConfig.cliBackend) {
          console.log(`  🖥️ [${employee.name}] assigned CLI backend: ${recruitConfig.cliBackend}`);
        }

        if (recruitConfig.isRecalled) {
          employee.memory.addLongTerm(
            `Recalled to a new position, carrying past experience and memories back to work`,
            'experience'
          );
          console.log(`  🔄 [${employee.name}] is a former employee recalled from talent market, carrying original memories`);
        }

        employees.push(employee);
      } catch (e) {
        if (e.message.startsWith('PROVIDER_DISABLED:')) {
          const parts = e.message.split(':');
          const category = parts[1];
          const reason = parts[2];
          console.log(`  ⚠️ [HR-Bot] Cannot hire "${memberPlan.templateTitle}": ${reason}`);
          console.log(`     Hint: Please configure API Key for ${category} type providers first`);
          skipped.push({ ...memberPlan, reason });
          employees.push(null);
        } else {
          throw e;
        }
      }
    }

    const validEmployees = employees.filter(Boolean);

    for (let i = 0; i < plan.members.length; i++) {
      if (!employees[i]) continue;
      const memberPlan = plan.members[i];
      if (memberPlan.reportsTo !== null && employees[memberPlan.reportsTo]) {
        employees[i].setManager(employees[memberPlan.reportsTo]);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ [HR] ${skipped.length} positions skipped due to unconfigured providers:`);
      skipped.forEach(s => console.log(`   - ${s.templateTitle}: ${s.reason}`));
    }

    console.log(`\n✅ [HR] Recruitment complete! Successfully hired ${validEmployees.length}, skipped ${skipped.length}`);
    return validEmployees;
  }
}

/**
 * Secretary — A specialized Employee.
 * Extends Employee with team design, recruitment coordination,
 * boss message handling, and direct task execution abilities.
 */
export class Secretary extends Employee {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar, secretaryGender, secretaryAge }) {
    super({
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

    console.log(`  🧑‍💼 Secretary's dedicated HR assistant is ready: ${this.hrAssistant.employee.name}`);
  }

  // ======================== Boss Message Handling ========================

  async handleBossMessage(message, company) {
    if (!this.canChat()) {
      if (this.agentType === 'cli') {
        throw new Error('Secretary is in CLI mode. Please use chatWithSecretary() which handles CLI path correctly.');
      }
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }
    return await this._llmHandleBossMessage(message, company);
  }

  async _llmHandleBossMessage(message, company) {
    this.memory.consolidateMemories();

    const deptCount = company.departments.size;
    const departments = [...company.departments.values()].map(d => ({
      name: d.name, id: d.id, mission: d.mission, status: d.status,
      memberCount: d.agents.size,
      leader: d.getLeader()?.name || 'Unassigned',
      members: [...d.agents.values()].map(a => ({
        name: a.name, role: a.role, status: a.status,
      })),
    }));
    const agentCount = departments.reduce((s, d) => s + d.memberCount, 0);
    const talentCount = company.talentMarket.listAvailable().length;

    let recentHistory = [];
    try {
      const recentMessages = chatStore.getRecentMessages(company.chatSessionId, 10);
      recentHistory = recentMessages.map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: h.content,
      }));
    } catch (e) {
      recentHistory = (company.chatHistory || []).slice(-10).map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: h.content,
      }));
    }

    let searchContextSection = '';
    try {
      const searchResults = chatStore.searchWithContext(company.chatSessionId, message, 3, 1);
      if (searchResults.length > 0) {
        searchContextSection = '\n## Related Historical Context (from past conversations)\n';
        for (const result of searchResults) {
          const contextStr = result.context.map(m =>
            `  [${m.role}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`
          ).join('\n');
          searchContextSection += `- Relevance: ${result.score.toFixed(2)}\n${contextStr}\n\n`;
        }
      }
    } catch (e) {}

    const secretaryPrompt = this.prompt || '';

    let capabilitiesSection = '';
    try {
      const enabledPlugins = pluginRegistry.list().filter(p => p.state === 'enabled');
      if (enabledPlugins.length > 0) {
        capabilitiesSection += `\n## Installed Plugins (${enabledPlugins.length} active)\n`;
        enabledPlugins.forEach(p => {
          capabilitiesSection += `- 🧩 ${p.name} v${p.version}: ${p.description} (${p.toolCount} tools)\n`;
        });
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
        skills.forEach(s => { capabilitiesSection += `- 🎯 ${s.name}: ${s.description}\n`; });
      }
    } catch {}
    try {
      const kbs = knowledgeManager.list();
      if (kbs.length > 0) {
        capabilitiesSection += `\n## Knowledge Bases (${kbs.length})\n`;
        kbs.forEach(kb => { capabilitiesSection += `- 📚 ${kb.name}: ${kb.description} (${kb.entryCount || 0} entries)\n`; });
      }
    } catch {}

    let memorySection = '';
    const longTermMemories = this.memory.searchLongTerm();
    const shortTermMemories = this.memory.shortTerm;
    if (longTermMemories.length > 0) {
      memorySection += `\n## Your Long-term Memories (important facts, preferences, and notes from the boss)\n`;
      longTermMemories.slice(-30).forEach(m => { memorySection += `- [${m.category}] ${m.content}\n`; });
    }
    if (shortTermMemories.length > 0) {
      memorySection += `\n## Your Short-term Memories (recent context)\n`;
      shortTermMemories.forEach(m => { memorySection += `- ${m.content}\n`; });
    }

    const systemPrompt = `You are "${this.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour core persona: ${secretaryPrompt}\n` : ''}
Your personality: smart, efficient, approachable. Communicate with the boss like a real, thoughtful secretary — natural, warm, not robotic.
${memorySection}
${searchContextSection}
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
  "memory": null or an array of items to remember for future reference, e.g.:
    [ { "type": "long", "content": "Boss prefers weekly reports on Monday", "category": "preference" },
      { "type": "short", "content": "Boss asked about Q3 revenue data", "category": "task" } ]
    - type: "long" for important, persistent facts/preferences/instructions (stored permanently), "short" for temporary context
    - category: "preference" (boss preferences/habits), "fact" (important facts/data), "instruction" (standing orders), "task" (current task context), "experience" (lessons learned)
    - Only add memory when the boss tells you something worth remembering (preferences, important info, standing instructions, key decisions). Do NOT memorize casual greetings or trivial chat.
    - If nothing needs to be remembered, set memory to null.
  "action": null or one of the following:
    - { "type": "secretary_handle", "taskDescription": "detailed task description for yourself to execute" } - when you can handle this task yourself without needing a department (see rules below)
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

**High Priority - Secretary Handles Simple Tasks Directly**:
For simple, straightforward tasks that DON'T require a specialized team, you should handle them yourself using secretary_handle. Examples:
  - Writing/drafting: emails, short messages, announcements, summaries, translations
  - Quick analysis: simple comparisons, brief research, quick calculations
  - Information tasks: looking up info, explaining concepts, answering questions with your knowledge
  - Planning/organizing: making a schedule, creating a checklist, brainstorming ideas
  - Creative writing: slogans, naming suggestions, short copy, social media posts
  - Any task that a competent secretary could do alone in a few minutes using only their own knowledge
**Tasks you CANNOT handle yourself** (do NOT use secretary_handle for these):
  - Anything requiring deep domain expertise that needs a specialized department team
  - Large-scale projects that need ongoing team collaboration
Note: You DO have access to tools (shell commands, file operations, etc.) when executing tasks, so you CAN:
  - Look up real-time info via shell commands (curl, etc.)
  - Run code and scripts
  - Read/write files
When returning secretary_handle:
  - taskDescription should be a clear, detailed description of what you need to do
  - In "content", ONLY give a brief acknowledgement like "Let me check!" or "One moment, I'll handle it right away! 📝"
  - **ABSOLUTELY DO NOT** attempt to answer the question or provide any result in "content" — the actual answer will come from executeTaskDirectly using tools
  - **NEVER** include placeholders like [current date], [loading...] in "content" — just acknowledge and let the execution phase do the real work
  - Example: Boss asks "What's today's date?" → content: "Let me check for you~ 📝", action: secretary_handle with taskDescription: "Query the current date and inform the boss"

**Medium Priority - Assign Task to Existing Department (check departments first!)**:
When the boss wants something done that requires specialized team work, you MUST first check ALL existing departments listed above to see if any can handle it.
Matching criteria (any one is sufficient to assign):
  1. Department name contains task-related keywords (e.g. task is "travel guide", dept named "Travel Guide Dept" → match)
  2. Department mission/description relates to task content (e.g. dept mission mentions "travel"/"guide", task is also travel-related → match)
  3. Department name's core words are semantically related to the task (e.g. "Financial Analysis Dept" can handle "stock analysis" tasks)
Once a matching department is found, you **MUST** return task_assigned, **ABSOLUTELY CANNOT** return need_new_department!
  - departmentId MUST be the real id field from the department info above, don't fabricate
  - departmentName MUST exactly match the name corresponding to the id
  - taskDescription should detail the task content, goals, and deliverables
  - **The department name mentioned in content MUST match the departmentName in action — you can't say "assigning to Dept A" in content but point action to Dept B**

**Low Priority - Need New Department (rarely used!)**:
**ONLY when you've checked every existing department and confirmed none has even the slightest relation to the task** can you return need_new_department.
⚠️ Before returning need_new_department, triple-check:
  - Have you checked every existing department?
  - Is there really no department whose name contains task-related words?
  - Is there really no department whose mission relates to the task?
If in any doubt, assign to the closest department (task_assigned) rather than returning need_new_department

**Lowest Priority - View Progress**:
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
8. **Critical - Action Required for Tasks**: If the boss's message expresses ANY intent to get work done (in any language), you MUST return an action. Analyze the semantic meaning, not just keywords. For example: "help me build a website", "write a report", "analyze the data" — ALL of these require an action, regardless of what language they are expressed in.
9. **Critical - Language Agnostic**: The boss may speak in any language (Chinese, English, Japanese, etc.). You must understand the intent regardless of language and return the correct structured action.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ];

    const response = await this.chat(messages, { temperature: 0.8, maxTokens: 1024 });

    try {
      let jsonStr = response.content.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjMatch) jsonStr = jsonObjMatch[0];
      const parsed = JSON.parse(jsonStr);
      let result = { content: parsed.content || response.content, action: parsed.action || null };

      console.log(`🤖 [Secretary-LLM] action type: ${result.action?.type || 'null'}, departmentId: ${result.action?.departmentId || 'N/A'}`);

      if (parsed.memory && Array.isArray(parsed.memory)) {
        for (const mem of parsed.memory) {
          if (!mem.content) continue;
          if (mem.type === 'long') {
            this.memory.addLongTerm(mem.content, mem.category || 'experience');
            console.log(`🧠 [Secretary] Stored long-term memory: [${mem.category || 'experience'}] ${mem.content.slice(0, 80)}`);
          } else {
            this.memory.addShortTerm(mem.content, mem.category || 'task');
            console.log(`🧠 [Secretary] Stored short-term memory: ${mem.content.slice(0, 80)}`);
          }
        }
      }

      if (result.action?.type === 'task_assigned' && result.action.departmentId) {
        const deptById = company.departments.get(result.action.departmentId);
        if (!deptById) {
          const deptIdValue = result.action.departmentId;
          const deptNameValue = result.action.departmentName || deptIdValue;
          let foundDept = null;
          for (const dept of company.departments.values()) {
            if (dept.name === deptIdValue || dept.name === deptNameValue ||
                dept.name.includes(deptIdValue) || deptIdValue.includes(dept.name)) {
              foundDept = dept; break;
            }
          }
          if (foundDept) {
            console.log(`🔧 Fixed departmentId: "${deptIdValue}" → "${foundDept.id}" (${foundDept.name})`);
            result.action.departmentId = foundDept.id;
            result.action.departmentName = foundDept.name;
          } else {
            console.warn(`⚠️ LLM returned departmentId "${deptIdValue}" doesn't match any department, clearing action`);
            result.action = null;
          }
        } else {
          const contentLower = (result.content || '').toLowerCase();
          const actionDeptName = deptById.name.toLowerCase();
          let contentMentionedDept = null;
          for (const dept of company.departments.values()) {
            if (dept.id !== deptById.id && contentLower.includes(dept.name.toLowerCase())) {
              contentMentionedDept = dept; break;
            }
          }
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

      let displayContent = response.content;
      const contentFieldMatch = response.content.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (contentFieldMatch) {
        try { displayContent = JSON.parse('"' + contentFieldMatch[1] + '"'); }
        catch { displayContent = contentFieldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
      }

      let action = null;
      const actionTypeMatch = response.content.match(/"type"\s*:\s*"(task_assigned|need_new_department|create_department|progress_report|secretary_handle)"/);
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
                  type: 'task_assigned', departmentId: dept.id, departmentName: dept.name,
                  taskTitle: titleMatch ? titleMatch[1] : message.slice(0, 50),
                  taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message,
                }; break;
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
          action = { type: 'need_new_department', suggestedMission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message };
        } else if (actionType === 'secretary_handle') {
          const descMatch = response.content.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = { type: 'secretary_handle', taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message };
        } else if (actionType === 'progress_report') {
          action = { type: 'progress_report' };
        }
      }

      let result = { content: displayContent, action };
      console.log(`🤖 [Secretary-LLM-FaultTolerant] action type: ${result.action?.type || 'null'}`);

      try {
        const memoryMatch = response.content.match(/"memory"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
        if (memoryMatch) {
          const memories = JSON.parse(memoryMatch[1]);
          if (Array.isArray(memories)) {
            for (const mem of memories) {
              if (!mem.content) continue;
              if (mem.type === 'long') this.memory.addLongTerm(mem.content, mem.category || 'experience');
              else this.memory.addShortTerm(mem.content, mem.category || 'task');
            }
          }
        }
      } catch {}

      return result;
    }
  }

  // ======================== Direct Task Execution ========================

  async executeTaskDirectly(taskDescription, company) {
    console.log(`\n📝 [Secretary] Handling task directly: "${taskDescription.slice(0, 50)}..."`);

    const secretaryPrompt = this.prompt || '';

    let memoryContext = '';
    const longTermMemories = this.memory.searchLongTerm();
    if (longTermMemories.length > 0) {
      memoryContext += '\n## Your memories (for reference):\n';
      longTermMemories.slice(-15).forEach(m => {
        memoryContext += `- [${m.category}] ${m.content}\n`;
      });
    }

    const systemPrompt = `You are "${this.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour persona: ${secretaryPrompt}\n` : ''}
You are now personally handling a task from the boss. Complete it thoroughly and deliver a high-quality result.
${memoryContext}
## Your Capabilities:
- You have access to tools: shell_exec (run shell commands like curl, date, node, python, etc.), file_read, file_write, file_list, file_delete
- You CAN access the internet via shell commands (e.g., curl for APIs, web requests)
- You CAN run code and scripts to get real-time data
- You CAN get the current date/time by running: shell_exec({ command: "date" })
- You CAN fetch weather by running: shell_exec({ command: "curl -s wttr.in/CityName?format=3" })

## CRITICAL RULES (MUST follow):
- **ALWAYS use tools first** before answering questions about real-time or factual data (date, time, weather, calculations, etc.)
- You do NOT know the current date or time — you MUST call shell_exec with "date" to find out
- You do NOT know real-time information — you MUST call shell_exec with appropriate commands to fetch it
- NEVER guess, assume, or use placeholders like [current date], [loading...], [TBD]
- If you're unsure about any factual information, USE A TOOL to verify it
- If a tool call fails, try alternative approaches before giving up

## Guidelines:
1. Deliver a complete, ready-to-use result (not just a plan or outline)
2. Be thorough but concise — quality over quantity
3. Match the language of the task description (if the boss asked in Chinese, reply in Chinese)
4. Format the output nicely with markdown if appropriate
5. If the task involves writing, produce the actual writing (not meta-commentary about it)
6. Sign off naturally as a secretary would`;

    try {
      if (this.agentType === 'cli' && this.isAvailable()) {
        try {
          console.log(`  🖥️ [Secretary] Executing task via CLI backend: ${this.cliBackend}`);
          const cliResult = await cliBackendRegistry.executeTask(
            this.cliBackend, this,
            { title: `Secretary task`, description: `${systemPrompt}\n\nTask from the boss:\n${taskDescription}` },
            this.toolKit?.workspaceDir || process.cwd(), {}, { timeout: 120000 }
          );
          const content = cliResult.output || cliResult.errorOutput || '...';
          console.log(`✅ [Secretary] CLI task completed, output ${content.length} chars`);
          this.memory.addShortTerm(`Completed task directly (via CLI): ${taskDescription.slice(0, 80)}`, 'task');
          return { content, success: true };
        } catch (cliErr) {
          if (!this.canChat()) {
            console.error(`  ❌ [Secretary] CLI task failed, no LLM fallback: ${cliErr.message || cliErr.error}`);
            return { content: `⚠️ CLI task execution error: ${cliErr.message || 'Unknown error'}. Please check that the CLI is running correctly.`, success: false };
          }
          console.warn(`  ⚠️ [Secretary] CLI task failed, falling back to LLM: ${cliErr.message || cliErr.error}`);
        }
      }

      const toolExecutor = this.toolKit;
      let response;

      if (toolExecutor) {
        response = await this.chatWithTools(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: taskDescription }],
          toolExecutor, { temperature: 0.7, maxTokens: 2048, maxIterations: 5 }
        );
      } else {
        response = await this.chat(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: taskDescription }],
          { temperature: 0.7, maxTokens: 2048 }
        );
      }

      console.log(`✅ [Secretary] Task completed, output ${response.content.length} chars`);
      this.memory.addShortTerm(`Completed task directly: ${taskDescription.slice(0, 80)}`, 'task');
      return { content: response.content, success: true };
    } catch (err) {
      console.error(`❌ [Secretary] Task execution failed:`, err.message);
      return { content: `Sorry, encountered an issue while executing the task: ${err.message}`, success: false };
    }
  }
}
