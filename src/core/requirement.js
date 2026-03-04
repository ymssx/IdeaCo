import { v4 as uuidv4 } from 'uuid';
import { llmClient } from './llm-client.js';
import { chatStore } from './chat-store.js';

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
2. **MAXIMIZE PARALLELISM**: Tasks that can run in parallel MUST not be serialized. Prefer wide parallel DAGs over deep serial chains
3. dependencies should contain the dependent node id array, empty array if no dependencies
4. The leader can handle "integration and review" type tasks
5. assigneeId must be selected from team members
6. Return JSON only, no other content
7. **Extremely important: Not every member needs to participate!** Only assign people who are truly needed. Members unrelated to the requirement should not be given tasks. Better to leave people idle than to create busywork
8. Task nodes should be lean and efficient. Simple requirements only need 1-3 nodes, avoid over-decomposition
9. Each task description should be clear and specific, allowing the assignee to complete it in one go, avoiding multiple iterations
10. **Encourage collaboration**: When multiple agents work in parallel, their tasks should be designed to have natural interaction points. Include in descriptions that they should coordinate with parallel teammates via send_message`;

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

    // === Set up message bus listener for real-time agent-to-agent communication ===
    const messageBus = department.company?.messageBus || null;
    const messageHandler = async (message) => {
      // When an agent sends a message via send_message tool, auto-reply from receiver
      const receiverAgent = department.agents.get(message.to);
      const senderAgent = department.agents.get(message.from);
      if (!receiverAgent || !senderAgent) return;
      if (receiverAgent.status === 'working') return; // Don't interrupt working agents

      // Show the sent message in group chat with @mention
      const groupMsg = `@[${receiverAgent.id}] ${message.content}`;
      requirement.addGroupMessage(senderAgent, groupMsg, 'message');
      this._recordAgentChat(senderAgent, receiverAgent, message.content);

      // Auto-reply from receiver (non-blocking)
      try {
        const reply = await receiverAgent.handleMessage(message);
        if (reply) {
          const replyMsg = `@[${senderAgent.id}] ${reply}`;
          requirement.addGroupMessage(receiverAgent, replyMsg, 'message');
          this._recordAgentChat(receiverAgent, senderAgent, reply);

          // Also send reply back via message bus
          if (messageBus) {
            messageBus.send({
              from: receiverAgent.id,
              to: senderAgent.id,
              content: reply,
              type: 'feedback',
            });
          }
        }
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
              'message'
            );
          } else {
            requirement.addGroupMessage(
              agent,
              `🔨 Starting to work on "${node.title}"!`,
              'message'
            );
          }
        } else {
          requirement.addGroupMessage(
            agent,
            `🔨 Starting to work on "${node.title}"!`,
            'message'
          );
        }

        try {
          // Collect dependency node outputs as context
          const depContext = node.dependencies
            .map(d => nodes.find(n => n.id === d))
            .filter(Boolean)
            .map(d => `[${d.assigneeName}'s output - ${d.title}]\n${d.result?.output || '(no output)'}`)
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

          const task = {
            title: node.title,
            description: node.description,
            context: (depContext ? `Here are the outputs from preceding tasks for your reference:\n\n${depContext}\n\n` : '')
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

          // Agent-to-agent collaboration: notify downstream agents with @mention
          const downstreamNodes = nodes.filter(n =>
            n.dependencies.includes(node.id) &&
            n.status !== TaskNodeStatus.COMPLETED &&
            n.status !== TaskNodeStatus.FAILED
          );
          if (downstreamNodes.length > 0 && result.output) {
            for (const downNode of downstreamNodes) {
              const downAgent = department.agents.get(downNode.assigneeId);
              if (downAgent && downAgent.id !== agent.id) {
                // Record in group chat with @mention
                const mentionMsg = `@[${downAgent.id}] I've completed "${node.title}", the output is ready for your "${downNode.title}" task. Please review and let me know if anything needs adjustment!`;
                requirement.addGroupMessage(agent, mentionMsg, 'message');

                // Persist to agent-to-agent chatStore
                this._recordAgentChat(agent, downAgent, mentionMsg);

                // Non-blocking: let downstream agent respond asynchronously
                this._agentCollabReply(
                  downAgent, agent, node.title, result.output, requirement
                ).then(reply => {
                  if (reply) {
                    const replyMsg = `@[${agent.id}] ${reply}`;
                    requirement.addGroupMessage(downAgent, replyMsg, 'message');
                    this._recordAgentChat(downAgent, agent, replyMsg);
                  }
                }).catch(e => {
                  console.log(`[Collaboration] ${downAgent.name} reply failed: ${e.message}`);
                });
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
              requirement.addGroupMessage(agent, syncMsg, 'message');
              this._recordAgentChat(agent, peerAgent, syncMsg);
            }
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

      // === Parallel Sync Point: agents that just finished in this batch exchange feedback ===
      const justFinished = readyNodes.filter(n => n.status === TaskNodeStatus.COMPLETED);
      if (justFinished.length > 1) {
        requirement.addGroupMessage(
          { name: 'System', role: 'system' },
          `🤝 ${justFinished.length} tasks completed in parallel! Agents are exchanging feedback...`,
          'system'
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
              requirement.addGroupMessage(reviewer, feedbackMsg, 'message');
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
   * Agent collaboration reply: downstream agent reviews upstream output and responds
   * @param {Agent} responder - The agent responding
   * @param {Agent} sender - The agent who completed the task
   * @param {string} taskTitle - Completed task title
   * @param {string} output - Task output
   * @param {Requirement} requirement - Requirement context
   * @returns {Promise<string|null>} Reply content
   */
  async _agentCollabReply(responder, sender, taskTitle, output, requirement) {
    if (!responder.provider?.enabled || !responder.provider?.apiKey) return null;

    try {
      const p = responder.personality || {};
      const outputPreview = output.length > 500 ? output.slice(0, 500) + '...' : output;
      const response = await llmClient.chat(responder.provider, [
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

      responder._trackUsage(response.usage);
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
    if (!reviewer.provider?.enabled || !reviewer.provider?.apiKey) return null;
    if (!output) return null;

    try {
      const p = reviewer.personality || {};
      const outputPreview = output.length > 400 ? output.slice(0, 400) + '...' : output;
      const response = await llmClient.chat(reviewer.provider, [
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

      reviewer._trackUsage(response.usage);
      return response.content?.trim() || null;
    } catch (e) {
      return null;
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
