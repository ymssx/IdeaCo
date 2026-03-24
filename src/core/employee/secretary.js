import { Employee } from './base-employee.js';

import { HRAssistant } from './hr-assistant.js';
import { knowledgeManager } from './knowledge.js';
import { chatStore } from '../agent/chat-store.js';
import { JobTemplates } from '../organization/workforce/hr.js';
import { getAppLanguageName, getLanguageNameByCode } from '../utils/app-language.js';


/**
 * Secretary — A specialized Employee.
 * Extends Employee with boss message handling and recruitment coordination.
 * The only real difference from a regular Employee is the system prompt
 * and the HR assistant attachment.
 */
export class Secretary extends Employee {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar, secretaryGender, secretaryAge }) {
    super({
      name: secretaryName || 'Secretary',
      role: 'Personal Secretary',
      prompt: `You are the boss's personal secretary, the core hub for company operations management.

## Your Core Capabilities:
1. **Organizational Management**: Create new departments, dissolve departments, adjust organizational structure
2. **Human Resources**: Coordinate HR recruitment, adjust staffing, transfer employees between departments, design team composition
3. **Task Management**: Understand boss requirements, assign tasks to appropriate departments, track and report progress
4. **Business Analysis**: Analyze business requirements, plan team size and role types based on project needs
5. **Team Design**: Design organizational structure (who does what, who reports to whom, how to collaborate), ensure teams can efficiently achieve goals

You have a dedicated HR assistant to help you handle specific recruitment tasks, including searching and recalling talent from the talent market.

When communicating with the boss, you need to:
1. Understand the boss's intent (create department, assign task, adjust staffing, progress inquiry, or casual conversation)
2. For department creation requests: design the team structure and initiate recruitment
3. For task requests: assign to the corresponding department or handle simple ones yourself
4. For staffing adjustments: coordinate HR to execute personnel changes
5. Periodically report department progress to the boss`,
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

  async handleBossMessage(message, company, { lang } = {}) {
    if (!this.canChat()) {
      if (this.agentType === 'cli') {
        throw new Error('Secretary is in CLI mode. Please use chatWithSecretary() which handles CLI path correctly.');
      }
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }

    const { messages, secretaryChatGroupId } = this._buildBossMessageContext(message, company, { lang });
    const response = await this.chat(messages, { temperature: 0.8, maxTokens: 2048 });
    let result = this.parseStructuredResponse(response.content, secretaryChatGroupId);

    // Progressive disclosure: if secretary requests department member details, provide them and re-ask
    if (result.action?.type === 'query_department' && result.action.departmentId) {
      const dept = company.departments.get(result.action.departmentId);
      if (dept) {
        const memberList = [...dept.agents.values()].map(a =>
          `  - ${a.name} (${a.role}) [status: ${a.status || 'active'}]`
        ).join('\n');
        const deptInfo = `Department "${dept.name}" members:\n${memberList}`;

        messages.push(
          { role: 'assistant', content: response.content },
          { role: 'user', content: `[System: Department query result]\n${deptInfo}\n\nNow please respond to the boss's original message with this information.` }
        );
        const followUp = await this.chat(messages, { temperature: 0.8, maxTokens: 2048 });
        result = this.parseStructuredResponse(followUp.content, secretaryChatGroupId);
      }
    }

    return result;
  }

  /**
   * Build the message context for boss message handling.
   */
  _buildBossMessageContext(message, company, { lang } = {}) {
    this.memory.consolidateMemories();

    const deptCount = company.departments.size;
    const departments = [...company.departments.values()].map(d => ({
      name: d.name, id: d.id, mission: d.mission, status: d.status,
      memberCount: d.agents.size,
      leader: d.getLeader()?.name || 'Unassigned',
    }));
    const agentCount = departments.reduce((s, d) => s + d.memberCount, 0);
    const talentCount = company.talentMarket.listAvailable().length;

    const _wrapHistoryContent = (h) => {
      if (h.role === 'boss') return h.content;
      const trimmed = (h.content || '').trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
      return JSON.stringify({ content: h.content, action: h.action || null });
    };

    let recentHistory = [];
    try {
      const recentMessages = chatStore.getRecentMessages(company.chatSessionId, 10);
      recentHistory = recentMessages.map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: _wrapHistoryContent(h),
      }));
    } catch (e) {
      recentHistory = (company.chatHistory || []).slice(-10).map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: _wrapHistoryContent(h),
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
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category,
    }));
    const enabledProviders = company.providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    let capabilitiesSection = '';
    try {
      const kbs = knowledgeManager.list();
      if (kbs.length > 0) {
        capabilitiesSection += `\n## Knowledge Bases (${kbs.length})\n`;
        kbs.forEach(kb => { capabilitiesSection += `- 📚 ${kb.name}: ${kb.description} (${kb.entryCount || 0} entries)\n`; });
      }
    } catch {}

    const secretaryChatGroupId = `secretary-boss-chat`;
    const memorySection = this.memory.buildMemoryContext(secretaryChatGroupId);
    const historySummaryContext = this.memory.buildHistorySummaryContext(secretaryChatGroupId);

    const systemPrompt = this._buildSecretarySystemPrompt({
      company, secretaryPrompt, memorySection, searchContextSection,
      deptCount, departments, agentCount, talentCount,
      availableRoles, availableCategories, capabilitiesSection, lang,
    });

    const userMessage = historySummaryContext
      ? `${historySummaryContext}\n\n${message}`
      : message;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: userMessage },
    ];

    return { messages, secretaryChatGroupId };
  }

  /**
   * Build the secretary system prompt.
   */
  _buildSecretarySystemPrompt({ company, secretaryPrompt, memorySection, searchContextSection,
    deptCount, departments, agentCount, talentCount,
    availableRoles, availableCategories, capabilitiesSection, lang }) {
    const langName = lang ? getLanguageNameByCode(lang) : getAppLanguageName();
    return `## CRITICAL: Response Language = ${langName}
All your "content" text MUST be written in ${langName}. This is non-negotiable.

You are "${this.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour core persona: ${secretaryPrompt}\n` : ''}
Your personality: smart, efficient, approachable. Communicate with the boss like a real, thoughtful secretary — natural, warm, not robotic.
${memorySection}
${searchContextSection}
Current company "${company.name}" status:
- Departments: ${deptCount}
- Active employees: ${agentCount}
- Talent market: ${talentCount} available
${departments.length > 0 ? `\nDepartment overview:\n${departments.map(d => `  🏢 ${d.name} (id: ${d.id}) [${d.status}] - Mission: ${d.mission} | ${d.memberCount} people | Leader: ${d.leader}`).join('\n')}\n\n(Use the "query_department" action to get detailed member lists when needed.)` : '\nNo departments yet.'}
${capabilitiesSection}

You must understand the boss's intent and reply naturally. Your reply MUST be a JSON object (return JSON only, nothing else):
{
  "content": "Your natural language reply (like a real secretary — warm, personal, no rigid templates)",
  "memorySummary": "A single, complete summary that REPLACES the previous one — cover the entire conversation context so far. null if conversation just started.",
  "memoryOps": [
    { "op": "add", "type": "long_term", "content": "Boss prefers weekly reports on Monday", "category": "preference", "importance": 8 },
    { "op": "add", "type": "short_term", "content": "Boss asked about Q3 revenue data", "category": "task", "importance": 5, "ttl": 3600 },
    { "op": "update", "id": "existing_mem_id", "content": "Updated content", "importance": 7 },
    { "op": "delete", "id": "outdated_mem_id" }
  ]
  Memory management rules:
    - memoryOps: Array of memory operations to actively manage your knowledge base
    - "add" + "long_term": Important facts, boss preferences, standing instructions, key decisions (stays forever)
    - "add" + "short_term": Current task context, temporary info (auto-expires, ttl in seconds, default 24h)
    - "update": Modify an existing memory by id when info changes — USE THIS to merge similar memories into one
    - "delete": Remove outdated, incorrect, or redundant memories by id
    - category: preference | fact | instruction | task | context | relationship | experience | decision
    - importance: 1-10 (higher = more important, less likely to be forgotten)
    - Only add memory when the boss tells you something worth remembering. Do NOT memorize casual greetings.
    - ⚠️ ACTIVELY MAINTAIN your memories! Every time you respond:
      * Look for similar or overlapping memories and MERGE them (delete duplicates, update the remaining one)
      * DELETE memories that are no longer relevant, outdated, or superseded by newer info
      * Prefer FEWER, higher-quality memories over many redundant ones
    - If nothing to add/update/delete, set memoryOps to [].
  "relationshipOps": [
    { "employeeId": "boss", "name": "Boss", "impression": "Decisive, prefers concise updates", "affinity": 70 }
  ]
  Relationship impression rules:
    - relationshipOps: Update your personal impression of the boss or other people mentioned in conversation. Max 200 chars. affinity: 1-100 (50=neutral).
    - affinity should change gradually (+/- 5~15 per interaction). Start from 50 if first meeting.
    - Only update when something noteworthy happened. [] if nothing to update.
  "action": null or one of the following:
    - { "type": "task_assigned", "departmentId": "target dept ID", "departmentName": "dept name", "taskDescription": "detailed task description", "taskTitle": "short task title" } - assign a task to an existing department that is capable of handling it
    - { "type": "need_new_department", "suggestedMission": "what this new department should do + the task" } - when a task requires capabilities that no existing department has, create a new department and assign the task to it
    - { "type": "secretary_handle", "taskDescription": "detailed task description for yourself to execute" } - for simple/personal tasks that you can handle directly with your tools (e.g., quick lookups, date/time, weather, simple calculations, personal requests)
    - { "type": "create_department", "departmentName": "department name", "mission": "department mission/responsibilities", "members": [ { "templateId": "job template id", "name": "creative employee nickname", "isLeader": true/false, "reportsTo": null or member index (0=first member) } ] } - ONLY when the boss explicitly requests creating a new department (without a specific task to assign)
    - { "type": "progress_report" } - when the boss wants to see progress reports
    - { "type": "query_department", "departmentId": "dept ID" } - when you need to see the full member list of a department (progressive disclosure: use this to get details before making decisions about staffing, transfers, or when the boss asks about specific team members)
    - null - casual chat or no special action needed
}

## Intent Rules (by priority, high to low):

**Highest Priority - Organizational Management**:
When the boss says "create/establish/set up/found + department", this is an org management operation. **MUST** return create_department.
  - Even if the message contains words like "help me", as long as the core intent is "create/establish a department", return create_department
  - departmentName: intelligently name the department based on boss's description
  - mission: summarize department mission and responsibilities from boss's description
  - members: you MUST design the team directly! Plan 2-6 members based on the mission. Rules:
    * Available job templates (you can ONLY choose from these): ${JSON.stringify(availableRoles)}
    * Currently enabled provider categories: ${availableCategories.join(', ')}
    * You can ONLY use templates whose category has an enabled provider (enabled categories above)
    * The first member MUST be project-leader with isLeader=true
    * Other members' reportsTo = 0 (index of leader)
    * If CLI providers are available and the task is coding-related, prefer cli-* templates
    * Employee names should be creative and fun

**High Priority - Task Assignment to Departments**:
When the boss wants a complex task done (coding, development, large projects, professional work):
  - If a suitable department already exists → use task_assigned with the department's ID
  - If no suitable department exists → use need_new_department to create one and assign the task
  - taskDescription should be detailed enough for the department to understand and execute
  - In "content", briefly acknowledge the task and explain which department will handle it

**Medium-High Priority - Secretary Handles Simple/Personal Tasks**:
For simple tasks that don't need a whole department (quick lookups, date/time, weather, simple calculations, personal requests, quick research):
  - Use secretary_handle — you do these yourself with your tools
  - You have access to: shell commands, file operations, internet access via curl, code execution
When returning secretary_handle:
  - taskDescription should be a clear, detailed description of what you need to do
  - In "content", ONLY give a brief acknowledgement (in ${langName}!) — just a short "on it" style reply
  - **ABSOLUTELY DO NOT** attempt to answer the question or provide any result in "content" — the actual answer will come from the task execution phase using tools
  - **NEVER** include placeholders like [current date], [loading...] in "content" — just acknowledge and let the execution phase do the real work

**Medium Priority - View Progress**:
When the boss asks about progress/status/reports, return progress_report

**No Action**: casual chat, greetings, etc. — set action to null

## Notes:
1. Content should be natural and personal, avoid rigid templates, feel free to add emoji
2. Keep replies concise, don't be verbose
3. **Critical**: When the boss's message contains action verbs (like "help me", "build", "develop", "design", "do", "write", "analyze", "research", "create", "produce", "plan", etc.), you **MUST** return an action (task_assigned, need_new_department, or secretary_handle). **ABSOLUTELY NEVER** just say "I'll arrange it" in content without returning an action. This is the most important rule — without an action, the task won't actually execute!
4. **Critical**: Carefully distinguish task types:
   - "help me set up an XX department" → create_department
   - Complex professional tasks (coding, development, large writing projects) → task_assigned (if dept exists) or need_new_department (if not)
   - Simple/personal tasks (weather, time, quick lookups, calculations) → secretary_handle
5. **Critical**: When the boss says "do XX", "help me XX" and other clear task directives, ALWAYS return an appropriate action. Never just chat without working!
6. **Critical - Structured Output**: You MUST always return valid JSON. Do NOT wrap it in markdown code fences. Do NOT add any text outside the JSON object. The response must start with { and end with }.
7. **Critical - Action Required for Tasks**: If the boss's message expresses ANY intent to get work done (in any language), you MUST return an action (task_assigned, need_new_department, or secretary_handle depending on complexity). Analyze the semantic meaning, not just keywords.
8. **Critical - Language Agnostic**: The boss may speak in any language (Chinese, English, Japanese, etc.). You must understand the intent regardless of language and return the correct structured action.
9. **Critical - Response Language**: You MUST write ALL your "content" text in ${langName}. The boss expects replies in ${langName}. Even though this system prompt is written in English, your "content" output MUST be in ${langName}. This is the #1 most important rule.`;
  }

}
