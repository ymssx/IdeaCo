import { v4 as uuidv4 } from 'uuid';
import { llmClient } from './llm-client.js';

/**
 * Requirement status enum
 */
export const RequirementStatus = {
  PENDING: 'pending',       // Just created, awaiting assignment
  PLANNING: 'planning',     // Leader is decomposing workflow
  IN_PROGRESS: 'in_progress', // In progress
  COMPLETED: 'completed',   // Completed
  FAILED: 'failed',         // Failed
};

/**
 * Workflow node status
 */
export const TaskNodeStatus = {
  WAITING: 'waiting',       // Waiting for dependencies
  READY: 'ready',           // Ready to start
  RUNNING: 'running',       // Running
  COMPLETED: 'completed',   // Completed
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
    // Keep only last 20 entries
    if (this.liveStatus.recentFileChanges.length > 20) {
      this.liveStatus.recentFileChanges = this.liveStatus.recentFileChanges.slice(-20);
    }
    this.liveStatus.lastActiveAt = new Date();
    this.liveStatus.heartbeat = new Date();
  }

  /** Add group chat message */
  addGroupMessage(from, content, type = 'message') {
    this.groupChat.push({
      id: uuidv4(),
      from: {
        id: from.id || 'system',
        name: from.name || 'System',
        avatar: from.avatar || null,
        role: from.role || null,
      },
      content,
      type,  // message | system | tool_call | output
      time: new Date(),
    });
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

  /** Serialize */
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
      groupChat: this.groupChat.slice(-200), // Keep latest 200 entries
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
    req.groupChat = data.groupChat || [];
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
   * Leader uses LLM to decompose requirement into workflow
   * @param {Requirement} requirement - Requirement
   * @param {Array} members - Department members list
   * @param {object} leaderProvider - Leader's LLM provider
   * @returns {object} Workflow
   */
  async planWorkflow(requirement, members, leaderProvider) {
    requirement.status = RequirementStatus.PLANNING;
    requirement.addGroupMessage(
      { name: 'System', role: 'system' },
      `📋 Requirement "${requirement.title}" created, leader is decomposing the workflow...`,
      'system'
    );

    // Build member info
    const memberInfo = members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
    }));

    const systemPrompt = `You are a project leader who needs to decompose a requirement into an executable workflow.

Team members:
${JSON.stringify(memberInfo, null, 2)}

Please decompose the requirement into a workflow (DAG - Directed Acyclic Graph) with multiple task nodes. Tasks can have dependency relationships.
Output in JSON format:
{
  "nodes": [
    {
      "id": "node_1",
      "title": "Task title",
      "description": "Detailed description",
      "assigneeId": "Assignee ID",
      "assigneeName": "Assignee name",
      "dependencies": [],
      "estimatedMinutes": 5,
      "outputType": "text|code|file"
    }
  ],
  "summary": "Workflow overview"
}

Requirements:
1. Task granularity should be moderate, each task assigned to one person
2. Tasks that can run in parallel should not be serialized
3. dependencies should contain the dependent node id array, empty array if no dependencies
4. The leader can handle "integration and review" type tasks
5. assigneeId must be selected from team members
6. Return JSON only, no other content
7. **Extremely important: Not every member needs to participate!** Only assign people who are truly needed. Members unrelated to the requirement should not be given tasks. Better to leave people idle than to create busywork
8. Task nodes should be lean and efficient. Simple requirements only need 1-3 nodes, avoid over-decomposition
9. Each task description should be clear and specific, allowing the assignee to complete it in one go, avoiding multiple iterations`;

    try {
      const response = await llmClient.chat(leaderProvider, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Requirement title: ${requirement.title}\nRequirement description: ${requirement.description}\n\nPlease decompose the workflow.` },
      ], { temperature: 0.7, maxTokens: 2048 });

      // Parse JSON
      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let jsonStr = response.content
        .replace(fence + 'json', '').replace(fence, '')
        .replace(fence + 'json', '').replace(fence, '')
        .trim();

      const workflow = JSON.parse(jsonStr);

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

      // Group chat notification
      const leader = members.find(m => m.role === 'Project Leader') || members[0];
      requirement.addGroupMessage(
        leader,
        `📊 Workflow decomposition complete! ${workflow.nodes.length} task nodes in total.\n\n${workflow.summary || ''}\n\n${workflow.nodes.map((n, i) =>
          `${i + 1}. [${n.assigneeName || 'TBD'}] ${n.title}${n.dependencies.length > 0 ? ` (depends on: ${n.dependencies.join(', ')})` : ' (can start immediately)'}`
        ).join('\n')}`,
        'message'
      );

      return workflow;
    } catch (e) {
      // LLM failed, generate simple workflow using rules
      console.error('Workflow decomposition failed:', e.message);
      const fallbackWorkflow = this._fallbackWorkflow(requirement, members);
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `⚠️ AI decomposition failed, generated a simple workflow using rules (${fallbackWorkflow.nodes.length} tasks)`,
        'system'
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
    // Pick the most suitable worker (first non-leader member)    const primaryWorker = workers[0];

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
      'system'
    );

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
        n.dependencies.every(d => completed.has(d))
      );

      if (readyNodes.length === 0) {
        // No executable nodes left (could be circular dependency or all failed)
        break;
      }

      // Execute all ready nodes in parallel
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
            'system'
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
        requirement.addGroupMessage(
          agent,
          `🔨 Starting to work on "${node.title}"!`,
          'message'
        );

        try {
          // Collect dependency node outputs as context
          const depContext = node.dependencies
            .map(d => nodes.find(n => n.id === d))
            .filter(Boolean)
            .map(d => `[${d.assigneeName}'s output - ${d.title}]\n${d.result?.output || '(no output)'}`)
            .join('\n\n');

          const task = {
            title: node.title,
            description: node.description,
            context: depContext ? `Here are the outputs from preceding tasks for your reference:\n\n${depContext}` : undefined,
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

          const result = await agent.executeTask(task, {
            onToolCall: ({ tool, args, status, success, error: toolErr }) => {
              // Update requirement's liveStatus in real-time
              if (status === 'start') {
                requirement.updateLiveStatus({
                  currentAction: `${agent.name} is calling tool ${tool}`,
                  toolCallsInProgress: [...(requirement.liveStatus.toolCallsInProgress || []), tool],
                });
                // Real-time group chat: calling tool
                if (tool === 'file_write') {
                  const filePath = args?.path || args?.filePath || args?.file_path || '';
                  requirement.addGroupMessage(agent, `📝 Writing file: ${filePath}`, 'tool_call');
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

          node.status = TaskNodeStatus.COMPLETED;
          node.completedAt = new Date();
          node.result = result;
          completed.add(node.id);

          // Record output
          if (result.output) {
          // Determine output type
            const outputType = this._detectOutputType(result);
            requirement.addOutput(
              agent.id, agent.name, agent.role,
              outputType, result.output,
              { toolResults: result.toolResults, duration: result.duration }
            );
          }

          // Group chat notification: completed
          const duration = Math.round((result.duration || 0) / 1000);
          requirement.addGroupMessage(
            agent,
            `✅ "${node.title}" completed! Took ${duration}s.${result.toolResults?.length ? `\n🔧 Used ${result.toolResults.length} tools` : ''}`,
            'message'
          );

          // Share output preview
          if (result.output) {
            const preview = result.output.length > 200 ? result.output.slice(0, 200) + '...' : result.output;
            requirement.addGroupMessage(
              agent,
              `📄 My output:\n${preview}`,
              'output'
            );
          }

          allResults.push(result);
          return result;
        } catch (err) {
          node.status = TaskNodeStatus.FAILED;
          node.completedAt = new Date();
          node.result = { error: err.message, success: false };
          failed.add(node.id);

          requirement.addGroupMessage(
            agent,
            `❌ "${node.title}" failed: ${err.message}`,
            'message'
          );
          return null;
        }
      });

      await Promise.all(promises);
    }

    // Summary
    const successCount = completed.size;
    const totalCount = nodes.length;
    const totalDuration = allResults.reduce((s, r) => s + (r?.duration || 0), 0);

    requirement.status = failed.size === totalCount ? RequirementStatus.FAILED : RequirementStatus.COMPLETED;
    requirement.completedAt = new Date();
    requirement.updateLiveStatus({
      currentNodeId: null,
      currentNodeTitle: null,
      currentAgent: null,
      currentAction: requirement.status === RequirementStatus.COMPLETED ? 'All tasks completed' : 'Execution finished (some failed)',
      toolCallsInProgress: [],
    });
    requirement.summary = {
      totalTasks: totalCount,
      successTasks: successCount,
      failedTasks: failed.size,
      totalDuration,
      outputs: requirement.outputs,
    };

    requirement.addGroupMessage(
      { name: 'System', role: 'system' },
      `🏁 Requirement "${requirement.title}" ${requirement.status === RequirementStatus.COMPLETED ? 'completed' : 'failed'}!\n📊 ${successCount}/${totalCount} tasks succeeded, total duration ${Math.round(totalDuration / 1000)}s`,
      'system'
    );

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
