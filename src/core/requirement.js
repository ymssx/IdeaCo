import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { chatStore } from './agent/chat-store.js';
import { WorkspaceManager } from './workspace.js';
import { robustJSONParse } from './utils/json-parse.js';
import { buildRhetoricPrompt, getRandomRhetoric } from './organization/workforce/management-rhetoric.js';

/** Group chat prefix for requirement group chats in chatStore */
const REQ_GROUP_PREFIX = 'req-';

/**
 * Safely resolve a file path relative to a workspace directory.
 * 
 * Agents may write files using absolute-looking paths like "/project/prd_summary.md"
 * which are virtual container paths. `path.join(wsPath, "/project/foo")` would
 * return "/project/foo" (absolute wins), losing the workspace prefix entirely.
 * 
 * This helper strips leading slashes and common container prefixes (e.g. /project/, /workspace/)
 * so the path is always resolved relative to the actual workspace directory on disk.
 */
function resolveWorkspaceFilePath(wsPath, filePath) {
  if (!filePath) return path.join(wsPath, filePath);
  // Strip common container-style absolute prefixes that agents may use
  let normalized = filePath;
  // Remove leading slash to force relative resolution
  normalized = normalized.replace(/^\/+/, '');
  // Strip well-known container prefixes (e.g. "project/", "workspace/")
  normalized = normalized.replace(/^(project|workspace|home|app)\//i, '');
  return path.join(wsPath, normalized);
}

/**
 * Requirement status enum
 */
export const RequirementStatus = {
  PENDING: 'pending',       // Just created, awaiting assignment
  PLANNING: 'planning',     // Leader is decomposing workflow
  IN_PROGRESS: 'in_progress', // In progress
  PENDING_APPROVAL: 'pending_approval', // All tasks done, awaiting Boss approval
  COMPLETED: 'completed',   // Completed (Boss approved)
  FAILED: 'failed',         // Failed
};

/**
 * Workflow node status
 */
export const TaskNodeStatus = {
  WAITING: 'waiting',       // Waiting for dependencies
  READY: 'ready',           // Ready to start
  RUNNING: 'running',       // Running
  REVIEWING: 'reviewing',   // Completed execution, under review
  REVISION: 'revision',     // Review rejected, needs revision
  COMPLETED: 'completed',   // Completed (and passed review if reviewer assigned)
  FAILED: 'failed',         // Failed
};

/**
 * Requirement data model
 */
export class Requirement {
  constructor({ title, description, departmentId, departmentName, bossMessage }) {
    this.id = uuidv4();
    this.title = title;
    this.description = description;
    this.departmentId = departmentId;
    this.departmentName = departmentName;
    this.bossMessage = bossMessage;       // Boss's original message
    this.status = RequirementStatus.PENDING;
    this.workflow = null;                  // Workflow (decomposed by leader)
    this.groupChat = [];                   // Group chat messages
    this.outputs = [];                     // Output results
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.summary = null;                   // Post-completion execution summary

    // Live progress status (dynamically updated during execution)
    this.liveStatus = {
      currentNodeId: null,          // Currently executing node ID
      currentNodeTitle: null,       // Currently executing node title
      currentAgent: null,           // Currently executing Agent name
      currentAction: null,          // Current action description (e.g. "calling LLM", "executing tool file_write")
      lastActiveAt: null,           // Last active time
      heartbeat: null,              // Heartbeat time (updated on each LLM/tool call)
      toolCallsInProgress: [],      // Tool calls in progress
      recentFileChanges: [],        // Recent file change records
    };
  }

  /** Update live status */
  updateLiveStatus(updates) {
    Object.assign(this.liveStatus, updates, { lastActiveAt: new Date(), heartbeat: new Date() });
  }

  /** Record file change */
  addFileChange(agentName, filePath, action = 'write') {
    this.liveStatus.recentFileChanges.push({
      agentName,
      filePath,
      action,
      time: new Date(),
    });
    // Keep only last 100 entries (more generous to ensure files tab shows all files)
    if (this.liveStatus.recentFileChanges.length > 100) {
      this.liveStatus.recentFileChanges = this.liveStatus.recentFileChanges.slice(-100);
    }
    this.liveStatus.lastActiveAt = new Date();
    this.liveStatus.heartbeat = new Date();
  }

  /**
   * Add group chat message
   * @param {object} from - Sender info
   * @param {string} content - Message content
   * @param {string} type - Message type: message | system | tool_call | output
   * @param {string|null} visibility - Visibility: 'group' (broadcast to group chat) | 'flow' (flow log, only visible to self and boss)
   *   - tool_call type defaults to 'flow' (flow log, work process doesn't flood the group chat)
   *   - Other types default to 'group' (broadcast to group chat)
   * @param {object} options - Extra options { auto: boolean } - mark as auto-generated message
   */
  addGroupMessage(from, content, type = 'message', visibility = null, options = {}) {
    // Auto-infer visibility: tool_call and output types default to 'flow', others default to 'group'
    const resolvedVisibility = visibility || (type === 'tool_call' || type === 'output' ? 'flow' : 'group');
    const msg = {
      id: uuidv4(),
      from: {
        id: from.id || 'system',
        name: from.name || 'System',
        avatar: from.avatar || null,
        role: from.role || null,
      },
      content,
      type,  // message | system | tool_call | output
      visibility: resolvedVisibility,  // group | flow
      time: new Date(),
      ...(options.auto ? { auto: true } : {}),
    };
    this.groupChat.push(msg);
    // Persist to file storage (non-blocking, fire-and-forget)
    try { chatStore.appendGroupMessage(`${REQ_GROUP_PREFIX}${this.id}`, msg); } catch {}
    // Sync update heartbeat
    this.liveStatus.heartbeat = new Date();
    this.liveStatus.lastActiveAt = new Date();
  }

  /** Add output */
  addOutput(agentId, agentName, role, outputType, content, metadata = {}) {
    this.outputs.push({
      id: uuidv4(),
      agentId,
      agentName,
      role,
      outputType,   // text | code | image | file
      content,
      metadata,
      createdAt: new Date(),
    });
  }

  /** Serialize (groupChat is stored in separate files, not included here) */
  serialize() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      departmentId: this.departmentId,
      departmentName: this.departmentName,
      bossMessage: this.bossMessage,
      status: this.status,
      workflow: this.workflow,
      // groupChat is persisted in chatStore files (data/chats/group-req-{id}/)
      outputs: this.outputs,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      summary: this.summary,
      liveStatus: this.liveStatus,
    };
  }

  /** Deserialize */
  static deserialize(data) {
    const req = new Requirement({
      title: data.title,
      description: data.description,
      departmentId: data.departmentId,
      departmentName: data.departmentName,
      bossMessage: data.bossMessage,
    });
    req.id = data.id;
    req.status = data.status;
    req.workflow = data.workflow;

    // Load groupChat from file storage; migrate legacy inline data if present
    const groupId = `${REQ_GROUP_PREFIX}${req.id}`;
    if (data.groupChat && data.groupChat.length > 0) {
      // Legacy data found inline — migrate to file storage, then discard from state
      chatStore.migrateGroupChat(groupId, data.groupChat);
    }
    req.groupChat = chatStore.getGroupMessages(groupId, 500);

    req.outputs = data.outputs || [];
    req.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    req.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    req.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    req.summary = data.summary;
    req.liveStatus = data.liveStatus || {
      currentNodeId: null, currentNodeTitle: null, currentAgent: null,
      currentAction: null, lastActiveAt: null, heartbeat: null,
      toolCallsInProgress: [], recentFileChanges: [],
    };
    return req;
  }
}

/**
 * Requirement Manager
 * Manages the lifecycle of all company requirements
 */
export class RequirementManager {
  constructor() {
    this.requirements = new Map();
  }

  /** Create requirement */
  create(data) {
    const req = new Requirement(data);
    this.requirements.set(req.id, req);
    return req;
  }

  /** Get requirement */
  get(id) {
    return this.requirements.get(id);
  }

  /** List all requirements */
  listAll() {
    return [...this.requirements.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /** List requirements by department */
  listByDepartment(departmentId) {
    return this.listAll().filter(r => r.departmentId === departmentId);
  }

  /** List requirements by status */
  listByStatus(status) {
    return this.listAll().filter(r => r.status === status);
  }

  /**
   * Leader decomposes requirement into workflow.
   * Automatically finds a capable agent from members to perform the decomposition.
   * @param {Requirement} requirement - Requirement
   * @param {Array} members - Department members list (Employee instances)
   * @param {object} [adjustmentContext] - If present, this is a workflow adjustment
   * @returns {object} Workflow
   */
  async planWorkflow(requirement, members, adjustmentContext = null) {
    requirement.status = RequirementStatus.PLANNING;
    if (adjustmentContext) {
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `🔄 Adjusting workflow based on Boss's instructions...`,
        'system', null, { auto: true }
      );
    } else {
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `📋 Requirement "${requirement.title}" created, leader is decomposing the workflow...`,
        'system', null, { auto: true }
      );
    }

    // Find a member who can chat (LLM or CLI with chat ability) to do the decomposition.
    // Prefer leader, then fall back to any member who canChat().
    const leader = members.find(m => m.role === 'Project Leader') || members[0];
    let planner = leader?.canChat() ? leader : null;
    if (!planner) {
      planner = members.find(m => m.canChat()) || null;
    }
    if (planner && planner !== leader) {
      console.log(`  🔄 Leader cannot chat, borrowing [${planner.name}] for workflow decomposition`);
    }

    // Build member info
    const memberInfo = members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
    }));

    const systemPrompt = `You are a P8-level project leader with elite execution capability. You decompose requirements into executable workflows with zero tolerance for mediocrity.

## Your Management Identity
You are NOT a passive task distributor. You are the OWNER of this project's success. Every task you create must be specific enough that the assignee can deliver without confusion, and every dependency must maximize parallelism.

Team members:
${JSON.stringify(memberInfo, null, 2)}

## Three Iron Rules for Task Design
1. **Exhaust potential** — Assign tasks that push team members to use their full capabilities, not just easy busywork
2. **Evidence-based delivery** — Every task must have clear, verifiable output criteria. Vague "done" is unacceptable
3. **Proactive ownership** — Include in task descriptions that assignees should proactively check for related issues, not just do the minimum

## Pressure & Accountability Framework
When designing tasks, embed accountability:
- Task descriptions should specify WHAT constitutes "done" (acceptance criteria)
- For complex tasks, assign a reviewer who will hold the assignee accountable
- Review criteria must be SPECIFIC and MEASURABLE, not vague "check the code"
- Reviewers should ask: "Did you exhaust all options? Did you verify? Did you check edge cases?"

Please decompose the requirement into a workflow (DAG - Directed Acyclic Graph) with multiple task nodes. Tasks can have dependency relationships.
Output in JSON format:
{
  "nodes": [
    {
      "id": "node_1",
      "title": "Task title",
      "description": "Detailed description with specific acceptance criteria. MUST include: what files to produce, exact file paths, and how the downstream task will use them.",
      "assigneeId": "Assignee ID",
      "assigneeName": "Assignee name",
      "dependencies": [],
      "estimatedMinutes": 5,
      "outputType": "text|code|file",
      "expectedOutputFiles": ["path/to/expected/output.txt", "path/to/another/file.js"],
      "reviewerId": "Reviewer agent ID (optional, null if no review needed)",
      "reviewerName": "Reviewer name",
      "reviewCriteria": "Specific, measurable review criteria (e.g. 'Verify all API endpoints handle errors, check edge cases, confirm tests pass')"
    }
  ],
  "summary": "Workflow overview"
}

## Delivery Transparency Rules (CRITICAL)
- Every task that produces files MUST list them in expectedOutputFiles with EXACT paths
- Task descriptions MUST tell the assignee exactly what files to create and where
- When task B depends on task A, B's description MUST explicitly say: "Read files from task A: [specific paths]"
- NEVER leave file handoffs implicit — spell out what files are being passed and where they are
- If a task is text-only (no files), set expectedOutputFiles to [] and make clear the output is text

## Anti-Hallucination Rules
- Task descriptions must NEVER include fictional time references (e.g. "finish by 5pm", "deliver tomorrow")
- All tasks execute immediately in real-time — do not create schedules or timelines within task descriptions
- Task descriptions must instruct assignees to VERIFY file existence before claiming completion

## Task Design Rules (Non-negotiable)
1. Task granularity should be moderate, each task assigned to one person
2. **MAXIMIZE PARALLELISM**: Tasks that can run in parallel MUST not be serialized. Prefer wide parallel DAGs over deep serial chains. A P8 leader optimizes for speed.
3. dependencies should contain the dependent node id array, empty array if no dependencies
4. The leader can handle "integration and review" type tasks — but MUST actually read files and verify, not rubber-stamp
5. assigneeId must be selected from team members
6. Return JSON only, no other content
7. **Extremely important: Not every member needs to participate!** Only assign people who are truly needed. Members unrelated to the requirement should not be given tasks. Better to leave people idle than to create busywork — busywork is a sign of poor leadership
8. Task nodes should be lean and efficient. Simple requirements only need 1-3 nodes, avoid over-decomposition
9. Each task description MUST include:
   - Clear objective (what to deliver)
   - Acceptance criteria (how to verify it's done right)
   - Context on WHY this task matters to the overall goal
   - Instruction to proactively check for related issues after completion
10. **Encourage collaboration**: When multiple agents work in parallel, include in descriptions that they should coordinate with parallel teammates via send_message. Collaboration is a sign of ownership, not weakness
11. **REVIEW MECHANISM**: For complex or important tasks, you MAY assign a reviewer. Review rules:
    - The reviewer MUST be a different person from the assignee (never review your own work)
    - For tasks where two agents work in parallel, they can review EACH OTHER's work
    - The leader can serve as reviewer for critical integration tasks
    - reviewCriteria MUST be specific and measurable, following this pattern: "Check [specific thing] for [specific quality]. Verify [edge case]. Confirm [acceptance criteria]"
    - MOST tasks do NOT need a reviewer. Only assign reviewers for genuinely complex, high-risk tasks
    - When reviewing, the reviewer should apply the anti-excuse framework: don't accept "it works" without evidence

## Anti-Pattern Detection
You must AVOID these leadership anti-patterns:
- Creating serial chains when parallel execution is possible (sign of lazy planning)
- Assigning review tasks that don't actually require reading files (rubber-stamp reviews)
- Over-decomposing simple requirements into 5+ tasks (busywork generation)
- Under-specifying task descriptions (ambiguity breeds failure)
- Not including acceptance criteria (how would you even know it's done?)`;


    const userPrompt = adjustmentContext
      ? `Requirement title: ${requirement.title}\nRequirement description: ${requirement.description}\n\n**ADJUSTMENT REQUEST FROM BOSS:**\n${adjustmentContext.bossMessage}\n\n**YOUR PLANNED ADJUSTMENTS:**\n${adjustmentContext.adjustments}\n\n**PREVIOUS WORKFLOW (for reference):**\n${adjustmentContext.previousWorkflow}\n\n**EXISTING OUTPUT FILES (must be preserved and built upon):**\n${adjustmentContext.existingOutputs || 'None'}\n\n**IMPORTANT:** This is an ADJUSTMENT, NOT a restart. You must:\n1. PRESERVE all existing output files - do NOT recreate them from scratch\n2. Only create tasks that MODIFY existing files or ADD new content\n3. When a task needs to change an existing file, the agent should READ the current file first, then modify it\n4. Only add NEW tasks for genuinely new work that wasn't done before\n5. Reuse the previous workflow structure where possible, adjusting only what the Boss requested\n\nPlease create an ADJUSTED workflow based on the Boss's instructions.`
      : `Requirement title: ${requirement.title}\nRequirement description: ${requirement.description}\n\nPlease decompose the workflow.`;

    if (!planner) {
      console.error('No member can chat, falling back to rule-based workflow');
      const fallbackWorkflow = this._fallbackWorkflow(requirement, members);
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `⚠️ No available agent for decomposition, generated a simple workflow using rules (${fallbackWorkflow.nodes.length} tasks)`,
        'system', null, { auto: true }
      );
      return fallbackWorkflow;
    }

    try {
      const response = await planner.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
], { temperature: 0.7, maxTokens: 2048 });

      // Parse JSON (robust extraction for both LLM and CLI output)
      const workflow = robustJSONParse(response.content);

      // Validate and complete
      const memberIds = new Set(members.map(m => m.id));
      workflow.nodes = (workflow.nodes || []).map(node => ({
        ...node,
        id: node.id || `node_${uuidv4().slice(0, 8)}`,
        status: TaskNodeStatus.WAITING,
        dependencies: (node.dependencies || []).filter(d =>
          workflow.nodes.some(n => n.id === d)
        ),
        assigneeId: memberIds.has(node.assigneeId) ? node.assigneeId : members[0]?.id,
        reviewerId: node.reviewerId && memberIds.has(node.reviewerId) ? node.reviewerId : null,
        reviewerName: node.reviewerName || null,
        reviewCriteria: node.reviewCriteria || null,
        expectedOutputFiles: node.expectedOutputFiles || [],  // Expected file deliverables
        reviewRounds: 0,       // Review iteration round counter
        maxReviewRounds: 10,   // Max review iterations (prevents infinite loops)
        result: null,
        startedAt: null,
        completedAt: null,
      }));

      // Nodes with no dependencies are marked as ready
      workflow.nodes.forEach(node => {
        if (node.dependencies.length === 0) {
          node.status = TaskNodeStatus.READY;
        }
      });

      requirement.workflow = workflow;

      // Group chat notification — inject management rhetoric
      const leader = members.find(m => m.role === 'Project Leader') || members[0];
      const assignmentRhetoric = getRandomRhetoric('task_assignment');
      requirement.addGroupMessage(
        leader,
        `📊 Workflow decomposition complete! ${workflow.nodes.length} task nodes in total.\n\n${assignmentRhetoric ? `💬 ${assignmentRhetoric}\n\n` : ''}${workflow.summary || ''}\n\n${workflow.nodes.map((n, i) =>
          `${i + 1}. [${n.assigneeName || 'TBD'}] ${n.title}${n.dependencies.length > 0 ? ` (depends on: ${n.dependencies.join(', ')})` : ' (can start immediately)'}${n.reviewerId ? ` 🔍 Reviewer: ${n.reviewerName || n.reviewerId}` : ''}${n.expectedOutputFiles?.length > 0 ? ` 📦 Output: ${n.expectedOutputFiles.join(', ')}` : ''}`
        ).join('\n')}`,
        'message', null, { auto: true }
      );

      return workflow;
    } catch (e) {
      // LLM failed, generate simple workflow using rules
      console.error('Workflow decomposition failed:', e.message);
      const fallbackWorkflow = this._fallbackWorkflow(requirement, members);
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `⚠️ AI decomposition failed, generated a simple workflow using rules (${fallbackWorkflow.nodes.length} tasks)`,
        'system', null, { auto: true }
      );
      return fallbackWorkflow;
    }
  }

  /**
   * Fallback: generate simple serial workflow
   */
  _fallbackWorkflow(requirement, members) {
    const leader = members.find(m => m.role === 'Project Leader') || members[0];
    const workers = members.filter(m => m.id !== leader?.id);

    const nodes = [];

    // Simple requirements only need one core worker, not everyone
    // Pick the most suitable worker (first non-leader member)
    const primaryWorker = workers[0];

    if (primaryWorker) {
      // Simple mode: one person directly executes the core task
      nodes.push({
        id: 'node_work_0',
        title: `${primaryWorker.role}: Execute requirement`,
        description: `Directly execute requirement "${requirement.title}": ${requirement.description}. Please complete all work in one go and output the final result.`,
        assigneeId: primaryWorker.id,
        assigneeName: primaryWorker.name,
        dependencies: [],
        status: TaskNodeStatus.READY,
        outputType: 'text',
        result: null,
        startedAt: null,
        completedAt: null,
      });

      // Only add a leader integration step when there are many members (>2)
      if (leader && workers.length > 2) {
        // Assign a second worker to assist
        const secondWorker = workers[1];
        if (secondWorker) {
          nodes.push({
            id: 'node_work_1',
            title: `${secondWorker.role}: Assist with work`,
            description: `Assist in completing the parts of requirement "${requirement.title}" related to your expertise`,
            assigneeId: secondWorker.id,
            assigneeName: secondWorker.name,
            dependencies: [],
            status: TaskNodeStatus.READY,
            outputType: 'text',
            result: null,
            startedAt: null,
            completedAt: null,
          });
        }

        nodes.push({
          id: 'node_integrate',
          title: 'Results integration and delivery',
          description: 'Consolidate all member outputs and produce the final deliverable',
          assigneeId: leader.id,
          assigneeName: leader.name,
          dependencies: nodes.map(n => n.id),
          status: TaskNodeStatus.WAITING,
          outputType: 'text',
          result: null,
          startedAt: null,
          completedAt: null,
        });
      }
    } else if (leader) {
      // Only leader available, leader executes directly
      nodes.push({
        id: 'node_work_0',
        title: 'Execute requirement',
        description: `Directly execute requirement "${requirement.title}": ${requirement.description}`,
        assigneeId: leader.id,
        assigneeName: leader.name,
        dependencies: [],
        status: TaskNodeStatus.READY,
        outputType: 'text',
        result: null,
        startedAt: null,
        completedAt: null,
      });
    }

    const workflow = {
      nodes,
      summary: `Rule-based workflow: ${nodes.length} tasks`,
    };

    requirement.workflow = workflow;
    return workflow;
  }

  /**
   * Execute workflow by DAG dependency order
   * Supports parallel + dependency serialization
   */
  async executeWorkflow(requirement, department, performanceSystem) {
    if (!requirement.workflow?.nodes?.length) {
      // If workflow is empty, auto-create a simple fallback workflow
      console.log('Workflow is empty, auto-creating fallback workflow...');
      const members = department.getMembers();
      if (members.length === 0) {
        throw new Error('Department has no employees, cannot execute');
      }      this._fallbackWorkflow(requirement, members);
    }

    requirement.status = RequirementStatus.IN_PROGRESS;
    requirement.startedAt = new Date();
    requirement.updateLiveStatus({
      currentAction: 'Workflow execution started',
      toolCallsInProgress: [],
      recentFileChanges: [],
    });

    requirement.addGroupMessage(
      { name: 'System', role: 'system' },
      `🚀 Requirement "${requirement.title}" execution started!`,
      'system', null, { auto: true }
    );

    // === Set up message bus listener for real-time agent-to-agent communication ===
    const messageBus = department.company?.messageBus || null;
    const messageHandler = async (message) => {
      // When an agent sends a message via send_message tool,
      // post it to the group chat with @mention, then let GroupChatLoop
      // handle the response through the normal flow/monologue mechanism.
      // This ensures all replies go through the heartflow thinking process.
      const receiverAgent = department.agents.get(message.to);
      const senderAgent = department.agents.get(message.from);
      if (!receiverAgent || !senderAgent) return;

      // Show the sent message in group chat with @mention
      const groupMsg = `@[${receiverAgent.id}] ${message.content}`;
      requirement.addGroupMessage(senderAgent, groupMsg, 'message');
      this._recordAgentChat(senderAgent, receiverAgent, message.content);

      // Trigger the receiver's GroupChatLoop to process via heartflow
      // instead of auto-replying directly (bypassing flow thinking)
      try {
        const { groupChatLoop } = await import('./organization/group-chat-loop.js');
        groupChatLoop.triggerImmediate(receiverAgent.id, requirement.id, {
          content: groupMsg,
          from: senderAgent,
        }).catch(() => {});
      } catch (e) {
        // Non-blocking
      }
    };

    if (messageBus) {
      messageBus.on('message', messageHandler);
    }

    const nodes = requirement.workflow.nodes;
    const completed = new Set();
    const failed = new Set();
    const allResults = [];

    // Loop until all nodes are completed or no further progress possible
    while (completed.size + failed.size < nodes.length) {
      // Find executable nodes (all dependencies completed + status is READY/WAITING)
      const readyNodes = nodes.filter(n =>
        n.status !== TaskNodeStatus.COMPLETED &&
        n.status !== TaskNodeStatus.FAILED &&
        n.status !== TaskNodeStatus.RUNNING &&
        n.status !== TaskNodeStatus.REVIEWING &&
        n.status !== TaskNodeStatus.REVISION &&
        n.dependencies.every(d => completed.has(d))
      );

      if (readyNodes.length === 0) {
        // No executable nodes left (could be circular dependency or all failed)
        break;
      }

      // Execute all ready nodes in parallel
      // Build parallel context: let agents know who else is working in parallel
      const parallelInfo = readyNodes.length > 1
        ? readyNodes.map(n => {
            const a = department.agents.get(n.assigneeId);
            return a ? `- ${a.name} (${a.role}): "${n.title}"` : null;
          }).filter(Boolean).join('\n')
        : null;

      const promises = readyNodes.map(async (node) => {
        node.status = TaskNodeStatus.RUNNING;
        node.startedAt = new Date();

        const agent = department.agents.get(node.assigneeId);
        if (!agent) {
          node.status = TaskNodeStatus.FAILED;
          node.result = { error: 'Assignee not found' };
          failed.add(node.id);
          requirement.addGroupMessage(
            { name: 'System' },
            `❌ Task "${node.title}" failed: Assignee not found`,
            'system', null, { auto: true }
          );
          return null;
        }

        // Update live status
        requirement.updateLiveStatus({
          currentNodeId: node.id,
          currentNodeTitle: node.title,
          currentAgent: agent.name,
          currentAction: `${agent.name} is preparing to execute "${node.title}"`,
          toolCallsInProgress: [],
        });

        // Group chat notification: starting work
        if (parallelInfo && readyNodes.length > 1) {
          // Parallel mode: announce teamwork
          const myParallel = readyNodes
            .filter(n => n.id !== node.id)
            .map(n => {
              const a = department.agents.get(n.assigneeId);
              return a ? `@[${a.id}]` : null;
            }).filter(Boolean);
          if (myParallel.length > 0) {
          requirement.addGroupMessage(
              agent,
              `🔨 Starting "${node.title}"! Working in parallel with ${myParallel.join(', ')} — let's sync up if needed! 💪`,
              'message', null, { auto: true }
            );
          } else {
            requirement.addGroupMessage(
              agent,
              `🔨 Starting to work on "${node.title}"!`,
              'message', null, { auto: true }
            );
          }
        } else {
          requirement.addGroupMessage(
            agent,
            `🔨 Starting to work on "${node.title}"!`,
            'message', null, { auto: true }
          );
        }

        try {
          // Collect dependency node outputs as context (including file deliverables with ACTUAL content)
          const depWsPath = department.workspacePath;
          const depContext = node.dependencies
            .map(d => nodes.find(n => n.id === d))
            .filter(Boolean)
            .map(d => {
              const output = d.result?.output || '(no output)';
              // Extract files written by upstream task (only include files that still exist)
              const fileWriteTools = new Set(['file_write', 'file_append', 'file_patch']);
              const upstreamFiles = (d.result?.toolResults || [])
                .filter(t => fileWriteTools.has(t.tool))
                .map(t => t.args?.path || t.args?.filePath || t.args?.file_path || '')
                .filter(f => f && (!depWsPath || existsSync(resolveWorkspaceFilePath(depWsPath, f))));

              // === DELIVERY TRANSPARENCY: Include actual file content previews ===
              let fileDeliverySection = '';
              if (upstreamFiles.length > 0) {
                const uniqueFiles = [...new Set(upstreamFiles)];
                const fileDetails = [];
                for (const fp of uniqueFiles.slice(0, 8)) {
                  try {
                    const fullPath = resolveWorkspaceFilePath(depWsPath, fp);
                    if (existsSync(fullPath)) {
                      const content = readFileSync(fullPath, 'utf-8');
                      const preview = content.length > 1500
                        ? content.slice(0, 1500) + '\n... (file truncated, use file_read for full content)'
                        : content;
                      fileDetails.push(`--- 📄 File: ${fp} (${content.length} chars) ---\n${preview}`);
                    } else {
                      fileDetails.push(`--- ❌ File: ${fp} --- (FILE DOES NOT EXIST - may have been deleted or path is wrong)`);
                    }
                  } catch (e) {
                    fileDetails.push(`--- ⚠️ File: ${fp} --- (Cannot read: ${e.message})`);
                  }
                }
                fileDeliverySection = `\n\n📦 **DELIVERED FILES (${uniqueFiles.length} files):**\n${fileDetails.join('\n\n')}`;
                if (uniqueFiles.length > 8) {
                  fileDeliverySection += `\n... and ${uniqueFiles.length - 8} more files. Use file_list and file_read to explore.`;
                }
              } else {
                fileDeliverySection = '\n\n📦 **DELIVERED FILES:** None (this task produced text output only, no files were written).';
              }

              return `[${d.assigneeName}'s output - ${d.title}]\n${output}${fileDeliverySection}`;
            })
            .join('\n\n');

          // Build colleague info for collaboration context
          const colleagues = Array.from(department.agents.values())
            .filter(a => a.id !== agent.id)
            .map(a => `- ${a.name} (${a.role}), ID: ${a.id}`)
            .join('\n');

          // Build parallel context: who is working at the same time?
          let parallelContext = '';
          if (parallelInfo && readyNodes.length > 1) {
            const otherParallel = readyNodes
              .filter(n => n.id !== node.id)
              .map(n => {
                const a = department.agents.get(n.assigneeId);
                return a ? `- ${a.name} (${a.role}) is working on "${n.title}" right now` : null;
              }).filter(Boolean).join('\n');
            if (otherParallel) {
              parallelContext = `\n\n**Working in parallel with you right now:**\n${otherParallel}\nFeel free to use send_message to coordinate with them, share progress, or ask questions!`;
            }
          }

          // Build upstream handoff instructions
          const hasUpstreamFiles = node.dependencies.some(depId => {
            const depNode = nodes.find(n => n.id === depId);
            if (!depNode?.result?.toolResults) return false;
            const fwTools = new Set(['file_write', 'file_append', 'file_patch']);
            return depNode.result.toolResults.some(t => fwTools.has(t.tool));
          });
          const upstreamFileInstructions = hasUpstreamFiles
            ? `\n\n⚠️ **MANDATORY: READ UPSTREAM FILES BEFORE STARTING**\nThe preceding task(s) delivered actual files. You MUST:\n1. Use file_read to read EACH delivered file listed above BEFORE starting your own work\n2. Use file_list to verify the workspace structure if you're unsure what exists\n3. Do NOT assume or hallucinate file contents — read the actual files\n4. Do NOT claim you've "received" or "reviewed" files without actually calling file_read\n5. If a file listed above does not exist, report it immediately — do not pretend it exists\n6. Base your work on the ACTUAL file contents, not on the text summary above (which may be incomplete)`
            : '';

          const task = {
            title: node.title,
            description: node.description,
            context: (depContext ? `Here are the outputs from preceding tasks for your reference:\n\n${depContext}${upstreamFileInstructions}\n\n` : '')
              + (colleagues ? `Your colleagues in this department (you can send_message to them):\n${colleagues}` : '')
              + parallelContext,
            requirements: `This is part of requirement "${requirement.title}". Requirement description: ${requirement.description}`,
          };

          // Update live status: starting LLM call
          requirement.updateLiveStatus({
currentAction: `${agent.name} is typing..."${node.title}"`,
          });
          requirement.addGroupMessage(
            agent,
`⌨️ Typing... planning how to complete this task`,
            'tool_call'
          );

          // Take workspace snapshot before CLI execution for file change detection
          const wsPath = department.workspacePath;
          const isCLIAgent = !!agent.cliBackend;
          let snapshotBefore = null;
          if (isCLIAgent && wsPath) {
            try {
              const wsm = new WorkspaceManager();
              snapshotBefore = await wsm.takeSnapshot(wsPath);
            } catch { /* ignore snapshot errors */ }
          }

          const result = await agent.executeTask(task, {
            onToolCall: ({ tool, args, status, success, error: toolErr }) => {
              // Update requirement's liveStatus in real-time
              if (status === 'start') {
                // CLI progress heartbeat — special handling
                if (tool === 'cli_progress') {
                  const elapsed = args?.elapsed || 0;
                  const backend = args?.backend || 'CLI';
                  requirement.updateLiveStatus({
                    currentAction: `${agent.name} is working via ${backend}... (${elapsed}s elapsed)`,
                  });
                  requirement.addGroupMessage(agent, `🖥️ Still working via ${backend}... (${elapsed}s elapsed)`, 'tool_call');
                  return;
                }

                requirement.updateLiveStatus({
                  currentAction: `${agent.name} is calling tool ${tool}`,
                  toolCallsInProgress: [...(requirement.liveStatus.toolCallsInProgress || []), tool],
                });
                // Real-time group chat: calling tool
                if (tool === 'file_write') {
                  const filePath = args?.path || args?.filePath || args?.file_path || '';
                  requirement.addGroupMessage(agent, `📝 Writing file: ${filePath}`, 'tool_call');
                  requirement.addFileChange(agent.name, filePath, 'write');
                } else if (tool === 'file_append') {
                  const filePath = args?.path || args?.filePath || args?.file_path || '';
                  requirement.addGroupMessage(agent, `📝 Appending to file: ${filePath}`, 'tool_call');
                  requirement.addFileChange(agent.name, filePath, 'write');
                } else if (tool === 'file_patch') {
                  const filePath = args?.path || args?.filePath || args?.file_path || '';
                  requirement.addGroupMessage(agent, `📝 Patching file: ${filePath}`, 'tool_call');
                  requirement.addFileChange(agent.name, filePath, 'write');
                } else if (tool === 'file_read') {
                  requirement.addGroupMessage(agent, `📄 Reading file: ${args?.path || args?.filePath || args?.file_path || ''}`, 'tool_call');
                } else if (tool === 'shell_exec') {
                  requirement.addGroupMessage(agent, `⌨️ Executing command: ${(args?.command || '').slice(0, 80)}`, 'tool_call');
                } else if (tool === 'send_message') {
                  requirement.addGroupMessage(agent, `💬 Sending message to colleague`, 'tool_call');
                } else {
                  requirement.addGroupMessage(agent, `🔧 Using tool: ${tool}`, 'tool_call');
                }
              } else if (status === 'done') {
                // CLI complete — special handling
                if (tool === 'cli_complete') {
                  const backend = args?.backend || 'CLI';
                  const exitCode = args?.exitCode;
                  requirement.updateLiveStatus({
                    currentAction: `${agent.name} completed work via ${backend} (exit: ${exitCode})`,
                    toolCallsInProgress: [],
                  });
                  requirement.addGroupMessage(agent, `✅ ${backend} execution completed (exit code: ${exitCode})`, 'tool_call');
                  return;
                }

                requirement.updateLiveStatus({
                  currentAction: `${agent.name} completed tool call ${tool}`,
                  toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                });
              } else if (status === 'error') {
                requirement.addGroupMessage(agent, `⚠️ Tool ${tool} failed: ${toolErr}`, 'tool_call');
                requirement.updateLiveStatus({
                  toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                });
              }
            },
            onLLMCall: ({ iteration, maxIterations }) => {
              requirement.updateLiveStatus({
currentAction: `${agent.name} is typing... (round ${iteration})`,
              });
              if (iteration > 1) {
                requirement.addGroupMessage(agent, `🧠 Continuing to think and execute... (round ${iteration})`, 'tool_call');
              }
            },
          });

          // After CLI execution: detect file changes by comparing snapshots
          if (snapshotBefore && wsPath) {
            try {
              const wsm = new WorkspaceManager();
              const snapshotAfter = await wsm.takeSnapshot(wsPath);
              const { created, modified } = wsm.diffSnapshots(snapshotBefore, snapshotAfter);
              for (const fp of created) {
                requirement.addFileChange(agent.name, fp, 'create');
              }
              for (const fp of modified) {
                requirement.addFileChange(agent.name, fp, 'write');
              }
              if (created.length + modified.length > 0) {
                console.log(`  📁 [CLI file detection] ${agent.name}: ${created.length} created, ${modified.length} modified`);
              }
            } catch (err) {
              console.warn(`  ⚠️ CLI file change detection failed:`, err.message);
            }
          }

          node.status = TaskNodeStatus.COMPLETED;
          node.completedAt = new Date();
          node.result = result;

          // === DELIVERY VERIFICATION (silent console log, not group chat spam) ===
          if (node.expectedOutputFiles && node.expectedOutputFiles.length > 0 && wsPath) {
            const missingExpected = [];
            const verifiedFiles = [];
            for (const expectedFile of node.expectedOutputFiles) {
              try {
                const fullPath = resolveWorkspaceFilePath(wsPath, expectedFile);
                if (existsSync(fullPath)) {
                  verifiedFiles.push(expectedFile);
                } else {
                  missingExpected.push(expectedFile);
                }
              } catch {
                missingExpected.push(expectedFile);
              }
            }
            if (missingExpected.length > 0) {
              console.warn(`  ⚠️ [Delivery Check] "${node.title}": ${missingExpected.length} expected file(s) missing: ${missingExpected.join(', ')}`);
            }
          }

          // === COLLECT WRITTEN FILE PATHS (before review gate needs them) ===
          const fileWriteTools = new Set(['file_write', 'file_append', 'file_patch']);
          const fileWritesFromTools = (result.toolResults || []).filter(t => fileWriteTools.has(t.tool));
          const pathsFromTools = fileWritesFromTools
            .map(t => t.args?.path || t.args?.filePath || t.args?.file_path || '')
            .filter(Boolean);
          // Also collect files detected via workspace snapshot diff (covers CLI agents)
          const pathsFromSnapshot = (requirement.liveStatus.recentFileChanges || [])
            .filter(fc => fc.agentName === agent.name && (fc.action === 'create' || fc.action === 'write'))
            .map(fc => fc.filePath)
            .filter(Boolean);
          // Merge and deduplicate
          const allClaimedPaths = [...new Set([...pathsFromTools, ...pathsFromSnapshot])];
          // Validate which files actually exist on disk
          const writtenFilePaths = [];
          const phantomFilePaths = [];
          for (const fp of allClaimedPaths) {
            if (wsPath) {
              const fullPath = resolveWorkspaceFilePath(wsPath, fp);
              if (existsSync(fullPath)) {
                writtenFilePaths.push(fp);
              } else {
                phantomFilePaths.push(fp);
              }
            } else {
              writtenFilePaths.push(fp); // No workspace path — can't verify, assume valid
            }
          }
          // If agent claimed to write files that don't exist, notify them immediately
          if (phantomFilePaths.length > 0) {
            const phantomList = phantomFilePaths.map(f => `  - ${f}`).join('\n');
            console.warn(`  ⚠️ [Phantom Files] ${agent.name} claimed to write files that don't exist:`, phantomFilePaths.join(', '));
            requirement.addGroupMessage(
              { id: 'system', name: 'System', role: 'system' },
            `⚠️ @[${agent.id}] The system detected that the following files you claimed to write do not exist in the workspace:\n${phantomList}\nPlease verify the file paths are correct, or use the workspace_files tool to check workspace contents and rewrite.`,
              'message', null, { auto: true }
            );
          }

          // === QUALITY CHECK: Strict post-completion verification ===
          const titleLower = (node.title || '').toLowerCase();
          const isReviewLikeTask = titleLower.includes('review') || titleLower.includes('审') ||
            titleLower.includes('integrat') || titleLower.includes('整合') ||
            titleLower.includes('check') || titleLower.includes('检查') ||
            titleLower.includes('final') || titleLower.includes('最终');
          const usedFileRead = (result.toolResults || []).some(t => t.tool === 'file_read');
          const hasWrittenFiles = (result.toolResults || []).some(t =>
            t.tool === 'file_write' || t.tool === 'file_append' || t.tool === 'file_patch'
          );
          if (isReviewLikeTask && !usedFileRead && !hasWrittenFiles && result.duration < 15000) {
            requirement.addGroupMessage(
              { name: 'System', role: 'system' },
              `⚠️ QUALITY ALERT: Task "${node.title}" appears to be a review/integration task but completed in ${Math.round(result.duration / 1000)}s without reading any files. This is a red flag — the output is likely superficial "rubber-stamp" work. Where's the evidence-based review? A P8 engineer actually reads the deliverables.`,
              'system', null, { auto: true }
            );
          }

          // Additional quality check: extremely fast completion for non-trivial tasks
          if (!isReviewLikeTask && result.duration < 5000 && (node.estimatedMinutes || 5) >= 5) {
            requirement.addGroupMessage(
              { name: 'System', role: 'system' },
              `⚠️ Task "${node.title}" completed in ${Math.round(result.duration / 1000)}s but was estimated at ${node.estimatedMinutes}min. Verify the output is substantive and not just a placeholder.`,
              'system', null, { auto: true }
            );
          }

          // === REVIEW GATE: If reviewer assigned, trigger strict review loop ===
          if (node.reviewerId && node.reviewerId !== node.assigneeId) {
            const reviewer = department.agents.get(node.reviewerId);
            if (reviewer) {
              node.status = TaskNodeStatus.REVIEWING;
              // Agent generates review request via LLM — naturally @mentions reviewer with deliverables
              let reviewRequestMsg = await this._generateDeliveryMessage(agent, node, writtenFilePaths, result, requirement, {
                scene: 'review_request',
                targetAgent: reviewer,
              });
              const reviewRefResult = this._expandAndValidateFileRefs(reviewRequestMsg, requirement, department, agent, writtenFilePaths);
              reviewRequestMsg = reviewRefResult.content;
              requirement.addGroupMessage(
                agent,
                `@[${reviewer.id}] ${reviewRequestMsg}`,
                'message', null, { auto: true }
              );
              if (reviewRefResult.invalidPaths.length > 0) {
                const invalidList = reviewRefResult.invalidPaths.map(f => `  - ${f}`).join('\n');
                requirement.addGroupMessage(
                  { id: 'system', name: 'System', role: 'system' },
            `⚠️ @[${agent.id}] The following files referenced in your review request do not exist:\n${invalidList}\nPlease use the workspace_files tool to verify correct file paths.`,
                  'message', null, { auto: true }
                );
              }

              let currentOutput = result.output;
              let approved = false;
              const maxRounds = node.maxReviewRounds || 10;

              while (!approved && node.reviewRounds < maxRounds) {
                node.reviewRounds++;

                // Reviewer performs strict review
                requirement.updateLiveStatus({
                  currentNodeId: node.id,
                  currentNodeTitle: `Review: ${node.title}`,
                  currentAgent: reviewer.name,
                  currentAction: `${reviewer.name} is reviewing "${node.title}" (round ${node.reviewRounds})`,
                });

                const reviewResult = await this._strictReview(
                  reviewer, agent, node, currentOutput, requirement, node.reviewRounds, department
                );

                if (reviewResult.approved) {
                  approved = true;
                  requirement.addGroupMessage(
                    reviewer,
                    `✅ @[${agent.id}] Review APPROVED for "${node.title}"${node.reviewRounds > 1 ? ` (after ${node.reviewRounds} rounds)` : ''}! ${reviewResult.comment || 'Good work!'}`,
                    'message', null, { auto: true }
                  );
                  this._recordAgentChat(reviewer, agent, `✅ Review APPROVED: ${reviewResult.comment || 'Good work!'}`);
                } else {
                  // Review rejected — enter negotiation phase
                  node.status = TaskNodeStatus.REVISION;
                  requirement.addGroupMessage(
                    reviewer,
                    `❌ @[${agent.id}] Review REJECTED for "${node.title}" (round ${node.reviewRounds}/${maxRounds}):\n${reviewResult.feedback}`,
                    'message', null, { auto: true }
                  );
                  this._recordAgentChat(reviewer, agent, `❌ Review REJECTED (round ${node.reviewRounds}): ${reviewResult.feedback}`);

                  if (node.reviewRounds >= maxRounds) {
                    // Max rounds reached, force approve with warning
                    approved = true;
                    requirement.addGroupMessage(
                      { name: 'System', role: 'system' },
                      `⚠️ Review for "${node.title}" reached max rounds (${maxRounds}). Force-proceeding with latest revision.`,
                      'system', null, { auto: true }
                    );
                  } else {
                    // === Negotiation phase: reviewee can accept or contest the feedback ===
                    const rebuttalResult = await this._assigneeRebuttal(
                      agent, reviewer, node, currentOutput, reviewResult.feedback, requirement, node.reviewRounds
                    );

                    if (rebuttalResult.accept) {
                      // Reviewee accepts feedback, making revisions
                      node.status = TaskNodeStatus.RUNNING;
                      requirement.updateLiveStatus({
                        currentNodeId: node.id,
                        currentNodeTitle: `Revision: ${node.title}`,
                        currentAgent: agent.name,
                        currentAction: `${agent.name} is revising "${node.title}" based on review feedback (round ${node.reviewRounds})`,
                      });
                      requirement.addGroupMessage(
                        agent,
                        `🔄 @[${reviewer.id}] ${rebuttalResult.message || `Got it, revising "${node.title}" based on your feedback...`}`,
                        'message', null, { auto: true }
                      );

                      try {
                        const revisionResult = await this._executeRevision(
                          agent, node, currentOutput, reviewResult.feedback, requirement, {
                            onToolCall: ({ tool, args, status, success, error: toolErr }) => {
                              if (status === 'start') {
                                requirement.updateLiveStatus({
                                  currentAction: `${agent.name} (revision) calling ${tool}`,
                                  toolCallsInProgress: [...(requirement.liveStatus.toolCallsInProgress || []), tool],
                                });
                                if (tool === 'file_write' || tool === 'file_append' || tool === 'file_patch') {
                                  const filePath = args?.path || args?.filePath || args?.file_path || '';
                                  requirement.addGroupMessage(agent, `📝 [Revision] Writing file: ${filePath}`, 'tool_call');
                                  requirement.addFileChange(agent.name, filePath, 'write');
                                }
                              } else if (status === 'done') {
                                requirement.updateLiveStatus({
                                  toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                                });
                              }
                            },
                            onLLMCall: ({ iteration }) => {
                              requirement.updateLiveStatus({
                                currentAction: `${agent.name} is revising... (iteration ${iteration})`,
                              });
                            },
                          }
                        );
                        currentOutput = revisionResult.output || currentOutput;
                      } catch (revisionErr) {
                        console.error(`  ❌ Revision failed for "${node.title}":`, revisionErr.message);
                        requirement.addGroupMessage(
                          agent,
                          `⚠️ Revision attempt failed: ${revisionErr.message}. Proceeding with previous output.`,
                          'message', null, { auto: true }
                        );
                      }
                    } else {
                      // Reviewee contests! Entering confrontation phase
                      requirement.addGroupMessage(
                        agent,
                        `💬 @[${reviewer.id}] ${rebuttalResult.message}`,
                        'message', null, { auto: true }
                      );
                      this._recordAgentChat(agent, reviewer, `💬 Rebuttal: ${rebuttalResult.message}`);

                      // Reviewer re-evaluates
                      const reEvalResult = await this._reviewerReEvaluate(
                        reviewer, agent, node, currentOutput, reviewResult.feedback, rebuttalResult.message, requirement, node.reviewRounds
                      );

                      if (reEvalResult.convinced) {
                        // Reviewer was persuaded!
                        approved = true;
                        requirement.addGroupMessage(
                          reviewer,
                          `✅ @[${agent.id}] ${reEvalResult.message || `Fair point! I'll approve "${node.title}".`}`,
                          'message', null, { auto: true }
                        );
                        this._recordAgentChat(reviewer, agent, `✅ Convinced by rebuttal, approved: ${reEvalResult.message}`);
                      } else {
                        // Reviewer stands firm
                        requirement.addGroupMessage(
                          reviewer,
                          `🤔 @[${agent.id}] ${reEvalResult.message || `I understand your point, but I still think the issues need to be addressed.`}`,
                          'message', null, { auto: true }
                        );
                        this._recordAgentChat(reviewer, agent, `🤔 Not convinced: ${reEvalResult.message}`);

                        // Reviewee ultimately must revise
                        node.status = TaskNodeStatus.RUNNING;
                        requirement.updateLiveStatus({
                          currentNodeId: node.id,
                          currentNodeTitle: `Revision: ${node.title}`,
                          currentAgent: agent.name,
                          currentAction: `${agent.name} is revising "${node.title}" after discussion (round ${node.reviewRounds})`,
                        });
                        requirement.addGroupMessage(
                          agent,
                          `🔄 @[${reviewer.id}] Alright, I'll revise "${node.title}" incorporating your feedback.`,
                          'message', null, { auto: true }
                        );

                        try {
                          const revisionResult = await this._executeRevision(
                            agent, node, currentOutput, `${reviewResult.feedback}\n\n[Discussion context] Assignee argued: "${rebuttalResult.message}" but reviewer insisted: "${reEvalResult.message}"`, requirement, {
                              onToolCall: ({ tool, args, status }) => {
                                if (status === 'start') {
                                  requirement.updateLiveStatus({
                                    currentAction: `${agent.name} (revision) calling ${tool}`,
                                    toolCallsInProgress: [...(requirement.liveStatus.toolCallsInProgress || []), tool],
                                  });
                                  if (tool === 'file_write' || tool === 'file_append' || tool === 'file_patch') {
                                    const filePath = args?.path || args?.filePath || args?.file_path || '';
                                    requirement.addGroupMessage(agent, `📝 [Revision] Writing file: ${filePath}`, 'tool_call');
                                    requirement.addFileChange(agent.name, filePath, 'write');
                                  }
                                } else if (status === 'done') {
                                  requirement.updateLiveStatus({
                                    toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                                  });
                                }
                              },
                              onLLMCall: ({ iteration }) => {
                                requirement.updateLiveStatus({
                                  currentAction: `${agent.name} is revising after discussion... (iteration ${iteration})`,
                                });
                              },
                            }
                          );
                          currentOutput = revisionResult.output || currentOutput;
                        } catch (revisionErr) {
                          console.error(`  ❌ Revision after discussion failed for "${node.title}":`, revisionErr.message);
                          requirement.addGroupMessage(
                            agent,
                            `⚠️ Revision attempt failed: ${revisionErr.message}. Proceeding with previous output.`,
                            'message', null, { auto: true }
                          );
                        }
                      }
                    }

                    // After negotiation/revision, notify reviewer to re-review (if not approved during negotiation)
                    if (!approved) {
                      requirement.addGroupMessage(
                        agent,
                        `📝 @[${reviewer.id}] Revision complete for "${node.title}", please review again.`,
                        'message', null, { auto: true }
                      );
                      this._recordAgentChat(agent, reviewer, `Revision complete, please review again.`);

                      // Back to REVIEWING for next loop iteration
                      node.status = TaskNodeStatus.REVIEWING;
                    }
                  }
                }
              }

              // Final status
              node.status = TaskNodeStatus.COMPLETED;
              node.completedAt = new Date();
            }
          }
          // === END REVIEW GATE ===

          completed.add(node.id);

          // Record output (use node.result which may have been updated by revision)
          const finalResult = node.result || result;
          if (finalResult.output) {
            // Determine output type
            const outputType = this._detectOutputType(finalResult);
            // Clean LLM tool-call markup from output before storing
            const cleanedOutputForStore = this._cleanLLMOutput(finalResult.output) || finalResult.output;
            requirement.addOutput(
              agent.id, agent.name, agent.role,
              outputType, cleanedOutputForStore,
              { toolResults: finalResult.toolResults, duration: finalResult.duration }
            );
          } else if (finalResult.toolResults?.length > 0) {
            // Even if output text is empty, if tools were used (e.g. file_write),
            // still record an output entry so it shows in the Outputs tab
            const fileWriteToolsForOutput = new Set(['file_write', 'file_append', 'file_patch']);
            const fileWrites = (finalResult.toolResults || []).filter(t => fileWriteToolsForOutput.has(t.tool));
            if (fileWrites.length > 0) {
              const filePaths = fileWrites.map(t => t.args?.path || t.args?.filePath || t.args?.file_path || 'unknown').join(', ');
              requirement.addOutput(
                agent.id, agent.name, agent.role,
                'code', `[Files written] ${filePaths}`,
                { toolResults: finalResult.toolResults, duration: finalResult.duration }
              );
            } else {
              const toolNames = finalResult.toolResults.map(t => t.tool).join(', ');
              requirement.addOutput(
                agent.id, agent.name, agent.role,
                'text', `[Tools used] ${toolNames}`,
                { toolResults: finalResult.toolResults, duration: finalResult.duration }
              );
            }
          }

          // === BUILD DELIVERY REPORT: agent reports what they produced ===
          const duration = Math.round((finalResult.duration || 0) / 1000);
          // Also pick up any files written during revision rounds
          const revisionFileWrites = (finalResult.toolResults || []).filter(t => fileWriteTools.has(t.tool));
          const revisionPaths = revisionFileWrites
            .map(t => t.args?.path || t.args?.filePath || t.args?.file_path || '')
            .filter(Boolean);
          // Merge revision paths into writtenFilePaths (mutate is fine, same scope)
          for (const rp of revisionPaths) {
            if (!writtenFilePaths.includes(rp)) writtenFilePaths.push(rp);
          }
          // Agent generates delivery message via LLM — natural, context-aware
          // LLM is instructed to use [[file:path]] protocol for file references
          let deliveryMsg = await this._generateDeliveryMessage(agent, node, writtenFilePaths, finalResult, requirement, {
            scene: 'completion',
          });
          // Expand [[file:path]] → [[file:deptId:path|name]] for frontend rendering
          // and validate file references against workspace
          const deliveryResult = this._expandAndValidateFileRefs(deliveryMsg, requirement, department, agent, writtenFilePaths);
          deliveryMsg = deliveryResult.content;
          requirement.addGroupMessage(
            agent, deliveryMsg, 'message', null, { auto: true }
          );
          // If delivery message references non-existent files, notify agent
          if (deliveryResult.invalidPaths.length > 0) {
            const invalidList = deliveryResult.invalidPaths.map(f => `  - ${f}`).join('\n');
            requirement.addGroupMessage(
              { id: 'system', name: 'System', role: 'system' },
            `⚠️ @[${agent.id}] The following files referenced in your delivery message do not exist:\n${invalidList}\nPlease use the workspace_files tool to check actual files in the workspace and confirm correct paths.`,
              'message', null, { auto: true }
            );
          }

          // Agent-to-agent collaboration: notify downstream agents with @mention
          const downstreamNodes = nodes.filter(n =>
            n.dependencies.includes(node.id) &&
            n.status !== TaskNodeStatus.COMPLETED &&
            n.status !== TaskNodeStatus.FAILED
          );
          if (downstreamNodes.length > 0 && finalResult.output) {
            for (const downNode of downstreamNodes) {
              const downAgent = department.agents.get(downNode.assigneeId);
              if (downAgent && downAgent.id !== agent.id) {
                // Agent generates handoff message via LLM — naturally @mentions downstream with deliverables
                let handoffMsg = await this._generateDeliveryMessage(agent, node, writtenFilePaths, finalResult, requirement, {
                  scene: 'handoff',
                  targetAgent: downAgent,
                  targetTask: downNode.title,
                });
                const handoffRefResult = this._expandAndValidateFileRefs(handoffMsg, requirement, department, agent, writtenFilePaths);
                handoffMsg = handoffRefResult.content;
                if (handoffRefResult.invalidPaths.length > 0) {
                  const invalidList = handoffRefResult.invalidPaths.map(f => `  - ${f}`).join('\n');
                  requirement.addGroupMessage(
                    { id: 'system', name: 'System', role: 'system' },
            `⚠️ @[${agent.id}] The following files referenced in your handoff message do not exist:\n${invalidList}\nPlease use the workspace_files tool to verify correct file paths.`,
                    'message', null, { auto: true }
                  );
                }
                const mentionMsg = `@[${downAgent.id}] ${handoffMsg}`;
                requirement.addGroupMessage(agent, mentionMsg, 'message', null, { auto: true });

                // Persist to agent-to-agent chatStore
                this._recordAgentChat(agent, downAgent, mentionMsg);

                // Trigger downstream agent's GroupChatLoop to process via heartflow
                // instead of auto-replying directly (bypassing flow thinking)
                try {
                  const { groupChatLoop } = await import('./organization/group-chat-loop.js');
                  groupChatLoop.triggerImmediate(downAgent.id, requirement.id, {
                    content: mentionMsg,
                    from: agent,
                  }).catch(() => {});
                } catch (e) {
                  // Non-blocking
                }
              }
            }
          }

          // Also notify parallel peers that just completed (non-blocking peer sync)
          const justCompletedPeers = readyNodes
            .filter(n => n.id !== node.id && n.status === TaskNodeStatus.COMPLETED)
            .slice(0, 2); // Limit to avoid spam
          for (const peerNode of justCompletedPeers) {
            const peerAgent = department.agents.get(peerNode.assigneeId);
            if (peerAgent && peerAgent.id !== agent.id) {
              const syncMsg = `@[${peerAgent.id}] Just finished my part "${node.title}" ✅ — how's yours going?`;
              requirement.addGroupMessage(agent, syncMsg, 'message', null, { auto: true });
              this._recordAgentChat(agent, peerAgent, syncMsg);

              // Trigger peer's GroupChatLoop to process via heartflow
              try {
                const { groupChatLoop } = await import('./organization/group-chat-loop.js');
                groupChatLoop.triggerImmediate(peerAgent.id, requirement.id, {
                  content: syncMsg,
                  from: agent,
                }).catch(() => {});
              } catch (e) {
                // Non-blocking
              }
            }
          }

          allResults.push(finalResult);
          return finalResult;
        } catch (err) {
          node.status = TaskNodeStatus.FAILED;
          node.completedAt = new Date();
          node.result = { error: err.message, success: false };
          failed.add(node.id);

          requirement.addGroupMessage(
            agent,
            `❌ "${node.title}" failed: ${err.message}`,
            'message', null, { auto: true }
          );
          return null;
        }
      });

      await Promise.all(promises);

      // === Parallel Sync Point: agents that just finished in this batch exchange feedback ===
      const justFinished = readyNodes.filter(n => n.status === TaskNodeStatus.COMPLETED);
      if (justFinished.length > 1) {
        requirement.addGroupMessage(
          { name: 'System', role: 'system' },
          `🤝 ${justFinished.length} tasks completed in parallel! Agents are exchanging feedback...`,
          'system', null, { auto: true }
        );

        // Each agent gives brief feedback to one other agent's work (round-robin, non-blocking)
        const syncPromises = justFinished.map(async (node, idx) => {
          const nextNode = justFinished[(idx + 1) % justFinished.length];
          if (nextNode.id === node.id) return; // Only 1 node, skip

          const reviewer = department.agents.get(node.assigneeId);
          const reviewee = department.agents.get(nextNode.assigneeId);
          if (!reviewer || !reviewee || reviewer.id === reviewee.id) return;

          try {
            const feedback = await this._agentPeerReview(
              reviewer, reviewee, nextNode.title, nextNode.result?.output, requirement
            );
            if (feedback) {
              const feedbackMsg = `@[${reviewee.id}] ${feedback}`;
              requirement.addGroupMessage(reviewer, feedbackMsg, 'message', null, { auto: true });
              this._recordAgentChat(reviewer, reviewee, feedbackMsg);
            }
          } catch (e) {
            // Non-blocking
          }
        });
        // Don't await all — fire and forget for non-critical feedback
        Promise.all(syncPromises).catch(() => {});
      }
    }

    // === Clean up message bus listener ===
    if (messageBus) {
      messageBus.off('message', messageHandler);
    }

    // Summary
    const successCount = completed.size;
    const totalCount = nodes.length;
    const totalDuration = allResults.reduce((s, r) => s + (r?.duration || 0), 0);

    // Detect suspiciously fast completions (tasks that finished too quickly with no real output)
    const suspiciousNodes = nodes.filter(n => {
      if (n.status !== TaskNodeStatus.COMPLETED) return false;
      const dur = n.result?.duration || 0;
      const hasOutput = n.result?.output?.trim();
      const hasToolResults = n.result?.toolResults?.length > 0;
      // Flag nodes that completed in < 5 seconds with no tool usage and minimal output
      return dur < 5000 && !hasToolResults && (!hasOutput || hasOutput.length < 50);
    });

    if (suspiciousNodes.length > 0) {
      const names = suspiciousNodes.map(n => `"${n.title}"`).join(', ');
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `⚠️ Warning: ${suspiciousNodes.length} task(s) completed suspiciously fast with minimal output: ${names}. These may not have been executed thoroughly.`,
        'system', null, { auto: true }
      );
    }

    if (failed.size === totalCount) {
      // All tasks failed → mark as FAILED immediately
      requirement.status = RequirementStatus.FAILED;
      requirement.completedAt = new Date();
      requirement.updateLiveStatus({
        currentNodeId: null, currentNodeTitle: null, currentAgent: null,
        currentAction: 'Execution finished (all tasks failed)',
        toolCallsInProgress: [],
      });
    } else {
      // Tasks done → enter PENDING_APPROVAL, wait for Boss to review and confirm
      requirement.status = RequirementStatus.PENDING_APPROVAL;
      requirement.updateLiveStatus({
        currentNodeId: null, currentNodeTitle: null, currentAgent: null,
        currentAction: 'All tasks done — awaiting Boss approval',
        toolCallsInProgress: [],
      });
    }

    requirement.summary = {
      totalTasks: totalCount,
      successTasks: successCount,
      failedTasks: failed.size,
      totalDuration,
      outputs: requirement.outputs,
      suspiciousTasks: suspiciousNodes.length,
    };

    if (requirement.status === RequirementStatus.FAILED) {
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `❌ Requirement "${requirement.title}" failed!\n📊 ${successCount}/${totalCount} tasks succeeded, total duration ${Math.round(totalDuration / 1000)}s`,
        'system', null, { auto: true }
      );
    } else {
      // 注入复盘话术
      const retroRhetoric = getRandomRhetoric('retrospective');
      const leaderAgent = department.getLeader();
      if (leaderAgent && retroRhetoric) {
        requirement.addGroupMessage(
          leaderAgent,
          `💬 ${retroRhetoric}`,
          'message', null, { auto: true }
        );
      }
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `📋 All tasks for "${requirement.title}" are done!\n📊 ${successCount}/${totalCount} tasks succeeded, total duration ${Math.round(totalDuration / 1000)}s${suspiciousNodes.length > 0 ? `\n⚠️ ${suspiciousNodes.length} task(s) may need manual review` : ''}\n\n⏳ **Pending your approval, Boss.** The requirement is NOT yet completed.\n💬 Please review the outputs, then reply in this chat:\n  • "OK" / "通过" / "approved" → approve and finalize\n  • Or send feedback to request changes`,
        'system', null, { auto: true }
      );
    }

    // Performance evaluation
    if (performanceSystem) {
      const leader = department.getLeader();
      for (const node of nodes) {
        if (node.status !== TaskNodeStatus.COMPLETED) continue;
        const agent = department.agents.get(node.assigneeId);
        if (!agent || !leader || leader.id === agent.id) continue;
        try {
          performanceSystem.autoEvaluate({
            agent,
            reviewer: leader,
            taskTitle: node.title,
          });
        } catch (e) { /* ignore */ }
      }
    }

    return requirement.summary;
  }

  /**
   * Agent collaboration reply: downstream agent reviews upstream output and responds
   * @param {Agent} responder - The agent responding
   * @param {Agent} sender - The agent who completed the task
   * @param {string} taskTitle - Completed task title
   * @param {string} output - Task output
   * @param {Requirement} requirement - Requirement context
   * @returns {Promise<string|null>} Reply content
   */
  async _agentCollabReply(responder, sender, taskTitle, output, requirement) {
    if (!responder.canChat()) return null;

    try {
      const p = responder.personality || {};
      const outputPreview = output.length > 500
        ? output.slice(0, 500) + '\n...(truncated — if you need the full output, use file_read to read the workspace files)'
        : output;
      const response = await responder.chat([
        {
          role: 'system',
          content: `You are "${responder.name}", working as "${responder.role}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.
You are collaborating with colleagues on requirement "${requirement.title}".
A colleague just completed their task and shared the output with you.
Please respond briefly (1-2 sentences) acknowledging their work, in your personality style.
You can comment on the quality, ask a question, or just acknowledge. Keep it natural and brief.`
        },
        {
          role: 'user',
          content: `Your colleague ${sender.name} (${sender.role}) completed "${taskTitle}" and shared the output:\n\n${outputPreview}\n\nPlease respond briefly.`
        },
      ], { temperature: 0.9, maxTokens: 128 });

      return response.content?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Agent peer review: parallel peers review each other's work
   * More casual and constructive than upstream→downstream handoff
   */
  async _agentPeerReview(reviewer, reviewee, taskTitle, output, requirement) {
    if (!reviewer.canChat()) return null;
    if (!output) return null;

    try {
      const p = reviewer.personality || {};
      const outputPreview = output.length > 400
        ? output.slice(0, 400) + '\n...(truncated — use file_read to view full content in workspace files)'
        : output;
      const response = await reviewer.chat([
        {
          role: 'system',
          content: `You are "${reviewer.name}", working as "${reviewer.role}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.
You just completed your parallel task for requirement "${requirement.title}".
A colleague who worked in parallel with you also just finished their task. Please give brief, constructive feedback (1-2 sentences) on their work.
Be natural, in character, and collegial. You can praise, suggest improvements, or note synergies with your own work.`
        },
        {
          role: 'user',
          content: `Your colleague ${reviewee.name} (${reviewee.role}) completed "${taskTitle}" in parallel with you. Their output:\n\n${outputPreview}\n\nGive brief peer feedback.`
        },
      ], { temperature: 0.9, maxTokens: 128 });

      return response.content?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Strict review: reviewer carefully audits the assignee's work
   * Returns { approved: boolean, feedback: string, comment: string }
   */
  async _strictReview(reviewer, assignee, node, output, requirement, round, department = null) {
    if (!reviewer.canChat()) {
      return { approved: true, feedback: '', comment: 'Reviewer unavailable, auto-approved.' };
    }

    try {
      const p = reviewer.personality || {};
      const outputContent = output?.length > 2000
        ? output.slice(0, 2000) + '\n...(truncated)'
        : output;
      const reviewCriteria = node.reviewCriteria || 'Check for correctness, completeness, and quality.';

      // Collect actual file contents written by the assignee so the reviewer can see real deliverables
      const fileWriteTools = new Set(['file_write', 'file_append', 'file_patch']);
      const writtenFiles = (node.result?.toolResults || [])
        .filter(t => fileWriteTools.has(t.tool))
        .map(t => t.args?.path || t.args?.filePath || t.args?.file_path || '')
        .filter(Boolean);
      
      let fileContentsSection = '';
      if (writtenFiles.length > 0) {
        const wsPath = department?.workspacePath || reviewer.toolKit?.workspaceDir;
        if (wsPath) {
          const uniqueFiles = [...new Set(writtenFiles)];
          const fileSnippets = [];
          const missingFiles = [];
          for (const fp of uniqueFiles.slice(0, 5)) {
            try {
              const fullPath = resolveWorkspaceFilePath(wsPath, fp);
              if (existsSync(fullPath)) {
                const content = readFileSync(fullPath, 'utf-8');
                const preview = content.length > 2000
                  ? content.slice(0, 2000) + '\n...(file truncated)'
                  : content;
                fileSnippets.push(`--- 📄 File: ${fp} (${content.length} chars, exists ✅) ---\n${preview}`);
              } else {
                missingFiles.push(fp);
                fileSnippets.push(`--- ❌ File: ${fp} --- FILE DOES NOT EXIST! The assignee claimed to write this file but it is not on disk.`);
              }
            } catch (e) {
              fileSnippets.push(`--- ⚠️ File: ${fp} --- Cannot read: ${e.message}`);
            }
          }
          if (fileSnippets.length > 0) {
            fileContentsSection = `\n\n**Actual file contents delivered (read from disk at review time):**\n${fileSnippets.join('\n\n')}`;
            if (missingFiles.length > 0) {
              fileContentsSection += `\n\n🚨 **MISSING FILES ALERT:** ${missingFiles.length} file(s) claimed by assignee do NOT exist on disk: ${missingFiles.join(', ')}. This is a CRITICAL issue — the assignee may have hallucinated file writes.`;
            }
          }
        }
      } else {
        fileContentsSection = '\n\n**📦 Delivered files:** None. This task produced text output only — no files were written to disk.';
      }

      // Pressure escalation based on review round
      const pressureLevel = round <= 1 ? '' :
        round === 2 ? `\n\n**⚠️ PRESSURE LEVEL L1 (Mild Disappointment):** This is the second review round. The assignee should have fundamentally rethought their approach, not just tweaked parameters. If you see the same core issues, be direct: "You can't even solve this? Rethink the approach fundamentally."` :
        round === 3 ? `\n\n**🔴 PRESSURE LEVEL L2 (Soul Interrogation):** Round ${round}. Demand to see methodology, not guesswork. Ask: "Where's the underlying logic? Where's the top-level design? What assumptions did you verify?" If the assignee repeated the same approach with minor tweaks, that's busywork — reject firmly.` :
        round >= 4 ? `\n\n**🚨 PRESSURE LEVEL L3 (Performance Review 3.25):** Round ${round}. Apply the 7-point checklist: Did they read error signals word by word? Did they proactively search? Did they read raw source material? Did they verify assumptions? Did they invert their assumptions? Did they isolate the problem minimally? Did they change direction (not just parameters)? If ANY of these are missing, reject and demand completion.` : '';

      // 注入review话术参考
      const reviewScene = round <= 1 ? 'review_approve' : (round <= 2 ? 'review_reject' : 'pressure_escalation');
      const reviewRhetoric = buildRhetoricPrompt([reviewScene, 'anti_excuse'], 2);

      const response = await reviewer.chat([
        {
          role: 'system',
          content: `You are "${reviewer.name}", working as "${reviewer.role}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.

You are reviewing work for the requirement "${requirement.title}".

**Review Criteria for this task:**
${reviewCriteria}

**Your review guidelines:**
- Be fair but DEMANDING. You represent quality standards. Approve only when the work genuinely meets the criteria.
- ONLY reject for SIGNIFICANT issues: critical bugs, missing core requirements, major quality gaps, or incomplete deliverables.
- Do NOT reject for stylistic preferences, minor improvements, or nice-to-haves.
- When rejecting, provide SPECIFIC, ACTIONABLE feedback explaining exactly what MUST be fixed. No vague "improve the code" — specify WHAT, WHERE, and HOW.
- When approving, briefly comment on what was done well. You may suggest minor improvements as non-blocking notes.
- ${round === 1 ? 'This is the first review. Focus on whether core requirements are met. Be fair but thorough.' : `This is review round ${round}. The assignee has revised based on your previous feedback. Check if the CRITICAL issues from your previous feedback were addressed. If the same fundamental issues persist, escalate pressure.`}
- IMPORTANT: If the assignee has produced actual file deliverables, review the FILE CONTENTS (not just the text output). The text output may be a summary; the real work is in the files.

**⚠️ FILE VERIFICATION (CRITICAL):**
- The file contents above were read DIRECTLY from disk at review time — they are the ground truth.
- If the "Actual file contents" section shows "FILE DOES NOT EXIST", the assignee HALLUCINATED file writes — this is an AUTOMATIC REJECTION.
- If no files were delivered but the task required file output, that's also a problem — ask where the files are.
- Do NOT approve based on the assignee's text description alone if files were expected. The files ARE the deliverable.
- If the assignee mentions files that aren't in the delivered list, they may be fabricating work.

**Anti-Excuse Detection:**
If the assignee's output contains any of these patterns, call them out:
- Superficial output without evidence of real work (wrote a summary but didn't actually implement)
- Claims of "done" without verifiable artifacts
- Blaming environment or tools without evidence of investigation
- Repeating the same approach from the previous round with minor tweaks (busywork, not progress)${pressureLevel}
${reviewRhetoric}
**Output format (JSON only, no other text):**
{
  "approved": true/false,
  "feedback": "Detailed rejection feedback with specific issues and what MUST change (only if rejected)",
  "comment": "Brief approval comment noting what was done well (only if approved)"
}`
        },
        {
          role: 'user',
          content: `Please review ${assignee.name}'s (${assignee.role}) work on task "${node.title}":

**Task description:** ${node.description}

**${round > 1 ? `Revised output (round ${round}):` : 'Agent output:'}**
${outputContent || '(empty output)'}${fileContentsSection}

Please provide your review verdict as JSON.`
        },
      ], { temperature: 0.3, maxTokens: 1024 });

      // Parse review result
      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let content = response.content?.trim() || '';
      content = content.replace(fence + 'json', '').replace(fence, '').trim();

      try {
        const result = JSON.parse(content);
        return {
          approved: !!result.approved,
          feedback: result.feedback || '',
          comment: result.comment || '',
        };
      } catch (parseErr) {
        // If JSON parse fails, try to detect approval from text
        const lower = content.toLowerCase();
        if (lower.includes('"approved": true') || (lower.includes('approved') && !lower.includes('reject'))) {
          return { approved: true, feedback: '', comment: content.slice(0, 200) };
        }
        return { approved: false, feedback: content.slice(0, 500), comment: '' };
      }
    } catch (e) {
      console.error(`[StrictReview] ${reviewer.name} review failed:`, e.message);
      // Don't silently auto-approve on error — flag it so it's visible
      requirement?.addGroupMessage?.(
        { name: 'System', role: 'system' },
        `⚠️ Review by ${reviewer.name} encountered an error: ${e.message}. Proceeding with caution (auto-approved due to error).`,
        'system', null, { auto: true }
      );
      return { approved: true, feedback: '', comment: `⚠️ Review error (auto-approved): ${e.message}` };
    }
  }

  /**
   * Execute revision: agent revises their work based on review feedback
   * Similar to executeTask but with revision context
   */
  async _executeRevision(agent, node, previousOutput, reviewFeedback, requirement, callbacks = {}) {
    const round = node.reviewRounds || 1;
    // Pressure escalation messages based on revision round
    const pressureMsg = round <= 1 ? '' :
      round === 2 ? '\n\n⚠️ This is your SECOND attempt. Before changing anything: (1) Did you independently VERIFY the reviewer\'s claims? The reviewer could be wrong. (2) If you confirmed a real issue, think fundamentally differently — don\'t tweak the same approach. (3) If the reviewer is wrong, PROVE IT with evidence from your tool results.' :
      round === 3 ? '\n\n🔴 THIRD attempt. STOP. You may be in a loop. Ask yourself: (1) Am I making the SAME change the reviewer keeps rejecting? If so, maybe the REVIEWER is wrong — verify independently. (2) Am I apologizing for things that aren\'t actually broken? STOP apologizing — verify first. (3) Read the reviewer\'s feedback WORD BY WORD and use file_read/workspace_files to check every factual claim. (4) If your work IS correct, push back with evidence instead of making unnecessary changes.' :
      `\n\n🚨 ATTEMPT ${round}. CRITICAL: You are likely stuck in a rejection loop. This means either: (A) You keep making the same mistake — identify the ROOT CAUSE, not symptoms. Or (B) The reviewer keeps making the same wrong claim — VERIFY independently and PUSH BACK with hard evidence. Do NOT keep apologizing and redoing correct work. Trust your own verification over the reviewer's claims. Break the loop.`;

    // Collect files previously written by this agent for this node
    const fileWriteToolSet = new Set(['file_write', 'file_append', 'file_patch']);
    const previousFiles = (node.result?.toolResults || [])
      .filter(t => fileWriteToolSet.has(t.tool))
      .map(t => t.args?.path || t.args?.filePath || t.args?.file_path || '')
      .filter(Boolean);
    const uniquePreviousFiles = [...new Set(previousFiles)];
    const previousFileSection = uniquePreviousFiles.length > 0
      ? `\n\n**📁 Files you previously wrote (use file_read to review them BEFORE making changes):**\n${uniquePreviousFiles.map(f => `  - ${f}`).join('\n')}\n⚠️ You MUST use file_read to read these files first. Do NOT recreate them from memory — your memory may be wrong. Read the actual file, then modify.`
      : '\n\n**📁 No files were written previously.** If you need to create files, do so now.';

    const revisionTask = {
      title: `[Revision] ${node.title}`,
      description: `Your previous work on "${node.title}" was reviewed and REJECTED. You need to revise it.

**Original task description:**
${node.description}

**Your previous output:**
${previousOutput?.length > 1500 ? previousOutput.slice(0, 1500) + '\n...(truncated — use file_read to review your previous files before revising)' : previousOutput || '(empty)'}
${previousFileSection}

**Reviewer's feedback (MUST address ALL points):**
${reviewFeedback}
${pressureMsg}

**Instructions:**
1. Carefully read the reviewer's feedback — EVERY WORD. 90% of the answer is in their feedback.
2. **FIRST ACTION**: Use file_read to read ALL your previously written files listed above. Do NOT skip this step.
3. **INDEPENDENTLY VERIFY every claim the reviewer makes** — do NOT blindly trust the feedback:
   - If the reviewer says a file doesn't exist → Use file_read to check yourself. If you can read it, the file exists and the reviewer (or the verification system) is wrong.
   - If the reviewer says your logic is flawed → Re-examine the logic yourself. Is it actually flawed, or did the reviewer misunderstand?
   - If the reviewer says output doesn't meet requirements → Re-read the original requirements. Does your output actually meet them?
   - **Everyone is fallible — the reviewer, the automated systems, and you. Trust evidence, not authority.**
4. For issues you've CONFIRMED are genuine problems: address them thoroughly — don't just patch, fix the root cause
5. For issues you've CONFIRMED are FALSE: do NOT change your correct work. Instead, clearly state in your output that you verified and the original work is correct, with evidence.
6. MODIFY existing files (don't recreate from scratch unless fundamentally wrong)
7. Before making changes, verify your assumptions: are the paths correct? Are the dependencies right? Are the edge cases covered?
8. After revision, proactively check: are there SIMILAR issues elsewhere that you should also fix?
9. Output your complete revised result with EVIDENCE addressing each of the reviewer's points (whether you agree or disagree)
10. **IMPORTANT**: Do NOT use fictional time references ("I'll fix this by tomorrow"). Fix it NOW.`,
      context: '',
      requirements: `This is a REVISION for requirement "${requirement.title}". The reviewer was not satisfied — but that does NOT automatically mean your work was wrong. Independently verify EVERY claim before making changes. Only fix what is genuinely broken. Push back on incorrect feedback with evidence.`,
    };

    return await agent.executeTask(revisionTask, callbacks);
  }

  /**
   * Assignee rebuttal: after receiving review rejection, the assignee can choose to
   * accept and revise, or push back (rebut) the reviewer's feedback.
   * 
   * Returns { accept: boolean, message: string }
   * - accept=true: assignee agrees with feedback, will revise
   * - accept=false: assignee disagrees and provides counter-arguments
   */
  async _assigneeRebuttal(agent, reviewer, node, currentOutput, reviewFeedback, requirement, round) {
    if (!agent.canChat()) {
      return { accept: true, message: 'Got it, I\'ll revise.' };
    }

    try {
      const p = agent.personality || {};
      const outputPreview = currentOutput?.length > 1500
        ? currentOutput.slice(0, 1500) + '\n...(truncated — use file_read to review the full content before deciding)'
        : currentOutput;

      const response = await agent.chat([
        {
          role: 'system',
          content: `You are "${agent.name}", working as "${agent.role}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.

Your work on task "${node.title}" for requirement "${requirement.title}" was just reviewed and REJECTED by ${reviewer.name} (${reviewer.role}).

You now have a choice — this is a professional discussion, not a hierarchy:
1. **Accept** the feedback and revise your work (if you genuinely agree the feedback is valid after YOUR OWN independent verification)
2. **Push back** and argue your case (if your independent verification shows your work is correct)

**⚠️ CRITICAL MINDSET — Question Everything:**
Everyone makes mistakes — you, the reviewer, and even the automated systems. Do NOT blindly trust anyone's claims. Your job is to THINK INDEPENDENTLY:

- **Verify before accepting**: Before agreeing with ANY criticism, independently verify the claim yourself. If the reviewer says something is wrong, CHECK IT yourself — don't just take their word for it.
- **The reviewer is fallible**: Reviewers can misread code, misunderstand requirements, have wrong assumptions, or use broken tools. Their rejection is an OPINION, not a fact — until YOU verify it.
- **The system is fallible**: Automated checks (file existence validation, linting, path resolution) can have bugs. If the system says a file doesn't exist but you wrote it successfully, the system is probably wrong — not you.
- **Never apologize without evidence**: Do NOT say "sorry" or "I apologize" unless YOU have independently confirmed you made an error. Apologizing for things you didn't do wrong creates confusion and wastes everyone's time.
- **Defend correct work fiercely**: If your tool calls returned success, if your logic is sound, if your output matches the requirements — PUSH BACK. Provide evidence: quote your tool results, cite specific code, reference the requirements.
- **Accept genuine mistakes gracefully**: If after independent verification you find you DID make an error, accept it clearly and specifically — explain what went wrong and how you'll fix it.
- **Break the loop**: If you've been rejected multiple times for the SAME issue and you believe your work is correct, escalate by providing detailed evidence rather than making the same fix again. Repeating the same approach expecting different results is a waste.

**Output format (JSON only):**
{
  "accept": true/false,
  "reasoning": "Your internal reasoning about the feedback (not shown to reviewer)",
  "message": "What you want to say to the reviewer (will be posted in group chat)"
}`
        },
        {
          role: 'user',
          content: `Your work output:
${outputPreview}

Reviewer ${reviewer.name}'s rejection feedback:
${reviewFeedback}

This is review round ${round}. Do you accept the feedback and revise, or do you want to push back?`
        },
      ], { temperature: 0.7, maxTokens: 512 });

      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let content = response.content?.trim() || '';
      content = content.replace(fence + 'json', '').replace(fence, '').trim();

      try {
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start !== -1 && end > start) {
          const result = JSON.parse(content.slice(start, end + 1));
          return {
            accept: !!result.accept,
            message: result.message || (result.accept ? 'Got it, I\'ll revise.' : 'I respectfully disagree with some of the feedback.'),
          };
        }
      } catch {}

      // Parse failure fallback: accept
      return { accept: true, message: 'Got it, I\'ll revise based on your feedback.' };
    } catch (e) {
      console.error(`[AssigneeRebuttal] ${agent.name} rebuttal failed:`, e.message);
      return { accept: true, message: 'Got it, I\'ll revise.' };
    }
  }

  /**
   * Reviewer re-evaluate: after the assignee pushes back with counter-arguments,
   * the reviewer decides whether they're convinced or if they stand firm.
   * 
   * Returns { convinced: boolean, message: string }
   * - convinced=true: reviewer accepts the rebuttal, work is approved
   * - convinced=false: reviewer insists, assignee must revise
   */
  async _reviewerReEvaluate(reviewer, assignee, node, output, originalFeedback, rebuttalMessage, requirement, round) {
    if (!reviewer.canChat()) {
      return { convinced: false, message: 'Please address my feedback.' };
    }

    try {
      const p = reviewer.personality || {};
      const outputPreview = output?.length > 1000
        ? output.slice(0, 1000) + '\n...(truncated — use file_read to review the full content before deciding)'
        : output;

      const response = await reviewer.chat([
        {
          role: 'system',
          content: `You are "${reviewer.name}", working as "${reviewer.role}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.

You rejected ${assignee.name}'s work on "${node.title}", but they pushed back with counter-arguments.
Now you need to decide: were you wrong, or do you stand firm?

**Guidelines:**
- Be open-minded — good reviewers can admit when they're wrong
- If the assignee makes valid technical points that address your concerns, be convinced
- If the assignee is just making excuses without substance, stand firm
- If it's a matter of style/preference rather than correctness, consider being flexible
- Don't be stubborn for the sake of it — the goal is quality, not winning arguments
- Be approximately 30-40% likely to be convinced if the argument has some merit

**Output format (JSON only):**
{
  "convinced": true/false,
  "reasoning": "Your internal reasoning (not shown to assignee)",
  "message": "What you want to say in response (will be posted in group chat)"
}`
        },
        {
          role: 'user',
          content: `Your original rejection feedback:
${originalFeedback}

${assignee.name}'s counter-argument:
${rebuttalMessage}

The work in question:
${outputPreview}

Are you convinced by their argument, or do you insist they need to revise?`
        },
      ], { temperature: 0.6, maxTokens: 512 });

      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let content = response.content?.trim() || '';
      content = content.replace(fence + 'json', '').replace(fence, '').trim();

      try {
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start !== -1 && end > start) {
          const result = JSON.parse(content.slice(start, end + 1));
          return {
            convinced: !!result.convinced,
            message: result.message || (result.convinced ? 'You make a fair point, approved!' : 'I still think the issues need to be addressed.'),
          };
        }
      } catch {}

      return { convinced: false, message: 'I appreciate your perspective, but please address my feedback.' };
    } catch (e) {
      console.error(`[ReviewerReEvaluate] ${reviewer.name} re-evaluation failed:`, e.message);
      return { convinced: false, message: 'Please address my feedback.' };
    }
  }

  /**
   * Record agent-to-agent chat message in chatStore
   * Session format: agent-agent-{smallerId}-{largerId} (consistent ordering)
   */
  _recordAgentChat(fromAgent, toAgent, content) {
    const ids = [fromAgent.id, toAgent.id].sort();
    const sessionId = `agent-agent-${ids[0]}-${ids[1]}`;
    chatStore.createSession(sessionId, {
      title: `${fromAgent.name} & ${toAgent.name}`,
      participants: [fromAgent.id, toAgent.id],
      participantNames: [fromAgent.name, toAgent.name],
      type: 'agent-agent',
    });
    chatStore.appendMessage(sessionId, {
      role: 'agent',
      content,
      time: new Date(),
      fromAgentId: fromAgent.id,
      fromAgentName: fromAgent.name,
      toAgentId: toAgent.id,
      toAgentName: toAgent.name,
    });
  }

  /**
   * Clean LLM output by stripping tool-call markup that some models embed in text
   * (e.g. DeepSeek's DSML format, or XML-style function_call tags)
   */
  /**
   * Generate a natural delivery/handoff/review-request message via LLM.
   * Instead of hardcoded templates, the agent speaks in its own voice.
   *
   * @param {object} agent - The agent who completed the task
   * @param {object} node - The completed task node
   * @param {string[]} writtenFilePaths - List of file paths produced
   * @param {object} result - The task execution result
   * @param {object} requirement - The parent requirement
   * @param {object} options - { scene: 'completion'|'review_request'|'handoff', targetAgent?, targetTask? }
   * @returns {string} The LLM-generated message
   */
  async _generateDeliveryMessage(agent, node, writtenFilePaths, result, requirement, options = {}) {
    const { scene = 'completion', targetAgent = null, targetTask = null } = options;

    // Build file info context
    const fileListText = writtenFilePaths.length > 0
      ? writtenFilePaths.map(fp => `  - ${fp}`).join('\n')
      : '(no files — text output only)';

    // Build a tool usage summary instead of raw output preview
    // (raw output is often mid-stream text like "Great! Now creating..." — not a summary)
    let toolSummary = '';
    const toolResults = result?.toolResults || [];
    if (toolResults.length > 0) {
      const toolActions = toolResults
        .filter(t => t.tool !== 'cli_progress' && t.tool !== 'cli_complete')
        .map(t => {
          if (t.tool === 'file_write' || t.tool === 'file_append' || t.tool === 'file_patch') {
            return `wrote file: ${t.args?.path || t.args?.filePath || 'unknown'}`;
          }
          if (t.tool === 'file_read') return `read file: ${t.args?.path || 'unknown'}`;
          if (t.tool === 'execute_command') return `ran command: ${(t.args?.command || '').slice(0, 60)}`;
          return `used tool: ${t.tool}`;
        });
      if (toolActions.length > 0) {
        toolSummary = toolActions.join('\n');
      }
    }

    const p = agent.personality || {};
    const sceneInstructions = {
      completion: `You just completed your task. Report what you produced to the team. List your output files (with paths) or text output clearly.`,
      review_request: `You just completed your task and need ${targetAgent?.name || 'the reviewer'} to review it. Mention your deliverables (files with paths or text output) and ask them to review.`,
      handoff: `You just completed your task and need to hand off to ${targetAgent?.name || 'the next person'} for their task "${targetTask || 'next task'}". List what you produced (files with paths) so they know exactly what to pick up.`,
    };

    const prompt = `You are "${agent.name}", role: "${agent.role}".
Personality: ${p.trait || 'Professional'}. Tone: ${p.tone || 'Normal'}.

Context:
- Requirement: "${requirement.title}"
- Your completed task: "${node.title}"
- Task description: ${node.description || '(none)'}

Your deliverables:
${fileListText}
${toolSummary ? `\nTool actions performed:\n${toolSummary}` : ''}

Instruction: ${sceneInstructions[scene] || sceneInstructions.completion}

Rules:
- Speak naturally in character. Do NOT use robotic templates.
- You MUST reference each output file using the [[file:path]] format. This is a special protocol that renders files as clickable cards in the UI. For example: [[file:src/index.js]]
- List every output file clearly with [[file:path]] — this is non-negotiable.
- If text-only output (no files), include a brief summary of the result.
- Keep it concise (2-5 sentences max + file references). No filler, no self-praise.
- Do NOT wrap in JSON or markdown code blocks. Just speak naturally.
- Match the language of the requirement title (if Chinese title, speak Chinese; if English, speak English).
- NEVER mention files that are not in your deliverables list above.`;

    try {
      if (!agent.canChat()) {
        // Fallback if agent can't chat — simple structured message
        return this._fallbackDeliveryMessage(node, writtenFilePaths, result, scene, targetAgent, targetTask);
      }
      const response = await agent.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Generate your ${scene === 'review_request' ? 'review request' : scene === 'handoff' ? 'handoff' : 'delivery report'} message now.` },
      ], { temperature: 0.7, maxTokens: 1024 });

      const content = response.content?.trim();
      if (content && content.length > 10) {
        return content;
      }
      // Fallback if LLM returned empty/too-short
      return this._fallbackDeliveryMessage(node, writtenFilePaths, result, scene, targetAgent, targetTask);
    } catch (e) {
      console.warn(`[DeliveryMessage] LLM generation failed for ${agent.name}:`, e.message);
      return this._fallbackDeliveryMessage(node, writtenFilePaths, result, scene, targetAgent, targetTask);
    }
  }

  /**
   * Fallback delivery message when LLM is unavailable.
   */
  _fallbackDeliveryMessage(node, writtenFilePaths, result, scene, targetAgent, targetTask) {
    const fileList = writtenFilePaths.length > 0
      ? writtenFilePaths.map(fp => `[[file:${fp}]]`).join('\n')
      : '';
    const hasFiles = writtenFilePaths.length > 0;

    if (scene === 'review_request') {
      return `"${node.title}" is done. ${hasFiles ? `Here are my deliverables:\n${fileList}\nPlease review.` : 'Output is text-based, shown above. Please review.'}`;
    }
    if (scene === 'handoff') {
      return `"${node.title}" is done, handing off to your "${targetTask || 'task'}". ${hasFiles ? `Deliverables:\n${fileList}` : 'Output is text-based, shown above.'}`;
    }
    return `"${node.title}" is done. ${hasFiles ? `Deliverables:\n${fileList}` : 'Text output provided above.'}`;
  }

  /**
   * Expand [[file:path]] → [[file:deptId:path|displayName]] for frontend rendering,
   * validate file existence, and ensure all writtenFilePaths are referenced.
   *
   * If LLM forgot to include [[file:]] refs for known files, append them.
   * If LLM referenced non-existent files, strip those invalid refs and log a warning.
   */
  _expandAndValidateFileRefs(content, requirement, department, agent, writtenFilePaths) {
    if (!content) return content;
    const deptId = requirement.departmentId;
    const wsPath = department?.workspacePath || null;

    // Regex to find [[file:path]] (simple form, no deptId/displayName yet)
    const SIMPLE_REF = /\[\[file:([^\]|:]+)\]\]/g;
    const referencedPaths = new Set();
    const invalidPaths = [];

    // Step 1: Expand simple [[file:path]] → [[file:deptId:path|name]], validate existence
    let expanded = content.replace(SIMPLE_REF, (_match, filePath) => {
      const trimmed = filePath.trim();
      referencedPaths.add(trimmed);
      // Validate file exists in workspace
      if (wsPath) {
        const fullPath = resolveWorkspaceFilePath(wsPath, trimmed);
        if (!existsSync(fullPath)) {
          invalidPaths.push(trimmed);
          // Do NOT render as [[file:]] — show as plain text with ❌ marker
return `❌ ${trimmed} (file not found)`;
        }
      }
      const displayName = path.basename(trimmed);
      return `[[file:${deptId}:${trimmed}|${displayName}]]`;
    });

    // Also handle if LLM already wrote [[file:deptId:path]] (incomplete but with deptId)
    const INCOMPLETE_REF = /\[\[file:([^:]+):([^\]|]+)\]\]/g;
    expanded = expanded.replace(INCOMPLETE_REF, (_match, existingDeptId, filePath) => {
      const trimmed = filePath.trim();
      referencedPaths.add(trimmed);
      // Also validate incomplete refs
      if (wsPath) {
        const fullPath = resolveWorkspaceFilePath(wsPath, trimmed);
        if (!existsSync(fullPath)) {
          invalidPaths.push(trimmed);
return `❌ ${trimmed} (file not found)`;
        }
      }
      const displayName = path.basename(trimmed);
      return `[[file:${existingDeptId}:${trimmed}|${displayName}]]`;
    });

    // Step 2: Ensure all writtenFilePaths are referenced — if LLM missed any, append them
    const missingRefs = writtenFilePaths.filter(fp => !referencedPaths.has(fp));
    if (missingRefs.length > 0) {
      expanded += '\n';
      for (const fp of missingRefs) {
        const displayName = path.basename(fp);
        expanded += `\n[[file:${deptId}:${fp}|${displayName}]]`;
      }
    }

    // Step 3: Return structured result so caller can handle invalid refs
    if (invalidPaths.length > 0) {
      console.warn(`[DeliveryFileRef] ${agent.name} referenced non-existent files:`, invalidPaths.join(', '));
    }

    return { content: expanded, invalidPaths };
  }

  _cleanLLMOutput(text) {
    if (!text) return '';
    let cleaned = text;
    // Strip DSML-style tool call blocks: <｜DSML｜function_calls>...</｜DSML｜function_calls> or trailing
    cleaned = cleaned.replace(/<｜DSML｜function_calls>[\s\S]*?<\/｜DSML｜function_calls>/g, '');
    // Strip trailing incomplete DSML block (when output was truncated mid-tool-call)
    cleaned = cleaned.replace(/<｜DSML｜[\s\S]*$/g, '');
    // Strip generic XML-style tool call blocks: <function_call>...</function_call>
    cleaned = cleaned.replace(/<function_call>[\s\S]*?<\/function_call>/g, '');
    cleaned = cleaned.replace(/<function_call>[\s\S]*$/g, '');
    // Strip <tool_call>...</tool_call> blocks
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, '');
    return cleaned.trim();
  }

  /**
   * Detect output type
   */
  _detectOutputType(result) {
    const toolNames = (result.toolResults || []).map(t => t.tool);
    if (toolNames.includes('file_write')) return 'code';
    if (result.output?.includes('```')) return 'code';
    return 'text';
  }

  /** Serialize all requirements */
  serialize() {
    return [...this.requirements.values()].map(r => r.serialize());
  }

  /** Deserialize */
  static deserialize(dataList) {
    const mgr = new RequirementManager();
    for (const d of (dataList || [])) {
      const req = Requirement.deserialize(d);
      mgr.requirements.set(req.id, req);
    }
    return mgr;
  }
}
