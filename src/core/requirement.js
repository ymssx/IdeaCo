import { v4 as uuidv4 } from 'uuid';
import { llmClient } from './llm-client.js';

/**
 * 需求状态枚举
 */
export const RequirementStatus = {
  PENDING: 'pending',       // 刚创建，等待分配
  PLANNING: 'planning',     // 负责人在拆解工作流
  IN_PROGRESS: 'in_progress', // 执行中
  COMPLETED: 'completed',   // 已完成
  FAILED: 'failed',         // 失败
};

/**
 * 工作流节点状态
 */
export const TaskNodeStatus = {
  WAITING: 'waiting',       // 等待依赖完成
  READY: 'ready',           // 就绪，可以开始
  RUNNING: 'running',       // 执行中
  COMPLETED: 'completed',   // 已完成
  FAILED: 'failed',         // 失败
};

/**
 * 需求数据模型
 */
export class Requirement {
  constructor({ title, description, departmentId, departmentName, bossMessage }) {
    this.id = uuidv4();
    this.title = title;
    this.description = description;
    this.departmentId = departmentId;
    this.departmentName = departmentName;
    this.bossMessage = bossMessage;       // 老板原始消息
    this.status = RequirementStatus.PENDING;
    this.workflow = null;                  // 工作流（由负责人拆解）
    this.groupChat = [];                   // 群聊消息
    this.outputs = [];                     // 产出结果
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.summary = null;                   // 完成后的执行摘要

    // 实时进度状态（执行中动态更新）
    this.liveStatus = {
      currentNodeId: null,          // 当前执行的节点ID
      currentNodeTitle: null,       // 当前执行的节点标题
      currentAgent: null,           // 当前执行的Agent名字
      currentAction: null,          // 当前操作描述（如"调用LLM"、"执行工具file_write"等）
      lastActiveAt: null,           // 最后活跃时间
      heartbeat: null,              // 心跳时间（每次LLM/工具调用更新）
      toolCallsInProgress: [],      // 正在执行的工具调用
      recentFileChanges: [],        // 最近文件变更记录
    };
  }

  /** 更新实时状态 */
  updateLiveStatus(updates) {
    Object.assign(this.liveStatus, updates, { lastActiveAt: new Date(), heartbeat: new Date() });
  }

  /** 记录文件变更 */
  addFileChange(agentName, filePath, action = 'write') {
    this.liveStatus.recentFileChanges.push({
      agentName,
      filePath,
      action,
      time: new Date(),
    });
    // 只保留最近20条
    if (this.liveStatus.recentFileChanges.length > 20) {
      this.liveStatus.recentFileChanges = this.liveStatus.recentFileChanges.slice(-20);
    }
    this.liveStatus.lastActiveAt = new Date();
    this.liveStatus.heartbeat = new Date();
  }

  /** 添加群聊消息 */
  addGroupMessage(from, content, type = 'message') {
    this.groupChat.push({
      id: uuidv4(),
      from: {
        id: from.id || 'system',
        name: from.name || '系统',
        avatar: from.avatar || null,
        role: from.role || null,
      },
      content,
      type,  // message | system | tool_call | output
      time: new Date(),
    });
    // 同步更新心跳
    this.liveStatus.heartbeat = new Date();
    this.liveStatus.lastActiveAt = new Date();
  }

  /** 添加产出 */
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

  /** 序列化 */
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
      groupChat: this.groupChat.slice(-200), // 保留最新200条
      outputs: this.outputs,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      summary: this.summary,
      liveStatus: this.liveStatus,
    };
  }

  /** 反序列化 */
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
 * 需求管理器
 * 管理公司所有需求的生命周期
 */
export class RequirementManager {
  constructor() {
    this.requirements = new Map();
  }

  /** 创建需求 */
  create(data) {
    const req = new Requirement(data);
    this.requirements.set(req.id, req);
    return req;
  }

  /** 获取需求 */
  get(id) {
    return this.requirements.get(id);
  }

  /** 获取所有需求 */
  listAll() {
    return [...this.requirements.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /** 获取部门的需求列表 */
  listByDepartment(departmentId) {
    return this.listAll().filter(r => r.departmentId === departmentId);
  }

  /** 获取某状态的需求 */
  listByStatus(status) {
    return this.listAll().filter(r => r.status === status);
  }

  /**
   * 由负责人使用 LLM 拆解需求为工作流
   * @param {Requirement} requirement - 需求
   * @param {Array} members - 部门成员列表
   * @param {object} leaderProvider - 负责人的 LLM provider
   * @returns {object} 工作流
   */
  async planWorkflow(requirement, members, leaderProvider) {
    requirement.status = RequirementStatus.PLANNING;
    requirement.addGroupMessage(
      { name: '系统', role: 'system' },
      `📋 需求「${requirement.title}」已创建，负责人正在进行工作拆解...`,
      'system'
    );

    // 构建成员信息
    const memberInfo = members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
    }));

    const systemPrompt = `你是一位项目负责人，需要将一个需求拆解为可执行的工作流。

团队成员：
${JSON.stringify(memberInfo, null, 2)}

请将需求拆解为一个工作流（DAG有向无环图），包含多个任务节点。任务之间可以有依赖关系。
输出JSON格式：
{
  "nodes": [
    {
      "id": "node_1",
      "title": "任务标题",
      "description": "详细描述",
      "assigneeId": "执行人ID",
      "assigneeName": "执行人名字",
      "dependencies": [],
      "estimatedMinutes": 5,
      "outputType": "text|code|file"
    }
  ],
  "summary": "工作流总体说明"
}

要求：
1. 任务粒度适中，每个任务由一个人负责
2. 能并行的任务不要串行
3. dependencies 填写依赖的 node id 数组，无依赖则为空数组
4. 负责人可以负责"整合和审核"类任务
5. assigneeId 必须从团队成员中选择
6. 只返回JSON，不要其他内容
7. **极其重要：不需要让每个成员都参与！** 只分配真正需要的人，与需求无关的成员不要安排任务。宁可让人闲着，也不要硬凑任务
8. 任务节点要精简高效，简单需求只需1-3个节点即可，避免过度拆解
9. 每个任务的描述要清晰具体，让执行人一次性完成，避免需要多轮反复`;

    try {
      const response = await llmClient.chat(leaderProvider, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `需求标题：${requirement.title}\n需求描述：${requirement.description}\n\n请拆解工作流。` },
      ], { temperature: 0.7, maxTokens: 2048 });

      // 解析 JSON
      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let jsonStr = response.content
        .replace(fence + 'json', '').replace(fence, '')
        .replace(fence + 'json', '').replace(fence, '')
        .trim();

      const workflow = JSON.parse(jsonStr);

      // 验证并补全
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

      // 没有依赖的节点标记为就绪
      workflow.nodes.forEach(node => {
        if (node.dependencies.length === 0) {
          node.status = TaskNodeStatus.READY;
        }
      });

      requirement.workflow = workflow;

      // 群聊通知
      const leader = members.find(m => m.role === '项目负责人') || members[0];
      requirement.addGroupMessage(
        leader,
        `📊 我已完成工作流拆解！共 ${workflow.nodes.length} 个任务节点。\n\n${workflow.summary || ''}\n\n${workflow.nodes.map((n, i) =>
          `${i + 1}. 【${n.assigneeName || '待定'}】${n.title}${n.dependencies.length > 0 ? ` (依赖: ${n.dependencies.join(', ')})` : ' (可立即开始)'}`
        ).join('\n')}`,
        'message'
      );

      return workflow;
    } catch (e) {
      // LLM 失败，用规则生成简单工作流
      console.error('工作流拆解失败:', e.message);
      const fallbackWorkflow = this._fallbackWorkflow(requirement, members);
      requirement.addGroupMessage(
        { name: '系统', role: 'system' },
        `⚠️ AI拆解失败，已使用规则生成简单工作流（${fallbackWorkflow.nodes.length}个任务）`,
        'system'
      );
      return fallbackWorkflow;
    }
  }

  /**
   * 规则兜底：生成简单的串行工作流
   */
  _fallbackWorkflow(requirement, members) {
    const leader = members.find(m => m.role === '项目负责人') || members[0];
    const workers = members.filter(m => m.id !== leader?.id);

    const nodes = [];

    // 简单需求只需一个核心执行人即可，不需要所有人都参与
    // 选择最合适的执行人（第一个非负责人的成员）
    const primaryWorker = workers[0];

    if (primaryWorker) {
      // 简单模式：一个人直接执行核心任务
      nodes.push({
        id: 'node_work_0',
        title: `${primaryWorker.role}: 执行需求`,
        description: `直接执行需求「${requirement.title}」：${requirement.description}。请一次性完成所有工作并输出最终成果。`,
        assigneeId: primaryWorker.id,
        assigneeName: primaryWorker.name,
        dependencies: [],
        status: TaskNodeStatus.READY,
        outputType: 'text',
        result: null,
        startedAt: null,
        completedAt: null,
      });

      // 仅当成员较多（>2人）时，才加一个负责人整合环节
      if (leader && workers.length > 2) {
        // 分配第二个执行人协助
        const secondWorker = workers[1];
        if (secondWorker) {
          nodes.push({
            id: 'node_work_1',
            title: `${secondWorker.role}: 协助工作`,
            description: `协助完成需求「${requirement.title}」中与你专业相关的部分`,
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
          title: '成果整合与交付',
          description: '汇总成员的成果，整合输出最终交付物',
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
      // 只有负责人的情况，负责人直接执行
      nodes.push({
        id: 'node_work_0',
        title: '执行需求',
        description: `直接执行需求「${requirement.title}」：${requirement.description}`,
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
      summary: `基于规则拆解的工作流: ${nodes.length} 个任务`,
    };

    requirement.workflow = workflow;
    return workflow;
  }

  /**
   * 按 DAG 依赖关系执行工作流
   * 支持并行 + 依赖串行
   */
  async executeWorkflow(requirement, department, performanceSystem) {
    if (!requirement.workflow?.nodes?.length) {
      // 如果工作流为空，自动创建一个简单的兜底工作流
      console.log('工作流为空，自动创建兜底工作流...');
      const members = department.getMembers();
      if (members.length === 0) {
        throw new Error('部门没有员工，无法执行');
      }
      this._fallbackWorkflow(requirement, members);
    }

    requirement.status = RequirementStatus.IN_PROGRESS;
    requirement.startedAt = new Date();
    requirement.updateLiveStatus({
      currentAction: '工作流开始执行',
      toolCallsInProgress: [],
      recentFileChanges: [],
    });

    requirement.addGroupMessage(
      { name: '系统', role: 'system' },
      `🚀 需求「${requirement.title}」开始执行！`,
      'system'
    );

    const nodes = requirement.workflow.nodes;
    const completed = new Set();
    const failed = new Set();
    const allResults = [];

    // 循环执行直到所有节点完成或无法继续
    while (completed.size + failed.size < nodes.length) {
      // 找到可以执行的节点（依赖全部完成 + 状态为 READY/WAITING）
      const readyNodes = nodes.filter(n =>
        n.status !== TaskNodeStatus.COMPLETED &&
        n.status !== TaskNodeStatus.FAILED &&
        n.status !== TaskNodeStatus.RUNNING &&
        n.dependencies.every(d => completed.has(d))
      );

      if (readyNodes.length === 0) {
        // 没有可执行节点了（可能有循环依赖或全部失败）
        break;
      }

      // 并行执行所有就绪节点
      const promises = readyNodes.map(async (node) => {
        node.status = TaskNodeStatus.RUNNING;
        node.startedAt = new Date();

        const agent = department.agents.get(node.assigneeId);
        if (!agent) {
          node.status = TaskNodeStatus.FAILED;
          node.result = { error: '执行人不存在' };
          failed.add(node.id);
          requirement.addGroupMessage(
            { name: '系统' },
            `❌ 任务「${node.title}」失败：执行人不存在`,
            'system'
          );
          return null;
        }

        // 更新实时状态
        requirement.updateLiveStatus({
          currentNodeId: node.id,
          currentNodeTitle: node.title,
          currentAgent: agent.name,
          currentAction: `${agent.name} 正在准备执行「${node.title}」`,
          toolCallsInProgress: [],
        });

        // 群聊通知：开始工作
        requirement.addGroupMessage(
          agent,
          `🔨 我开始处理「${node.title}」了！`,
          'message'
        );

        try {
          // 收集依赖节点的产出作为上下文
          const depContext = node.dependencies
            .map(d => nodes.find(n => n.id === d))
            .filter(Boolean)
            .map(d => `【${d.assigneeName}的产出 - ${d.title}】\n${d.result?.output || '(无产出)'}`)
            .join('\n\n');

          const task = {
            title: node.title,
            description: node.description,
            context: depContext ? `以下是前置任务的产出，供你参考：\n\n${depContext}` : undefined,
            requirements: `这是需求「${requirement.title}」的一部分。需求描述：${requirement.description}`,
          };

          // 更新实时状态：开始调用LLM
          requirement.updateLiveStatus({
currentAction: `${agent.name} 正在敲键盘中...「${node.title}」`,
          });
          requirement.addGroupMessage(
            agent,
`⌨️ 正在敲键盘中...规划如何完成这个任务`,
            'tool_call'
          );

          const result = await agent.executeTask(task, {
            onToolCall: ({ tool, args, status, success, error: toolErr }) => {
              // 实时更新需求的 liveStatus
              if (status === 'start') {
                requirement.updateLiveStatus({
                  currentAction: `${agent.name} 正在调用工具 ${tool}`,
                  toolCallsInProgress: [...(requirement.liveStatus.toolCallsInProgress || []), tool],
                });
                // 实时群聊：正在调用工具
                if (tool === 'file_write') {
                  const filePath = args?.path || args?.filePath || '';
                  requirement.addGroupMessage(agent, `📝 正在写入文件: ${filePath}`, 'tool_call');
                  requirement.addFileChange(agent.name, filePath, 'write');
                } else if (tool === 'file_read') {
                  requirement.addGroupMessage(agent, `📄 正在读取文件: ${args?.path || ''}`, 'tool_call');
                } else if (tool === 'shell_exec') {
                  requirement.addGroupMessage(agent, `⌨️ 正在执行命令: ${(args?.command || '').slice(0, 80)}`, 'tool_call');
                } else if (tool === 'send_message') {
                  requirement.addGroupMessage(agent, `💬 正在发送消息给同事`, 'tool_call');
                } else {
                  requirement.addGroupMessage(agent, `🔧 正在使用工具: ${tool}`, 'tool_call');
                }
              } else if (status === 'done') {
                requirement.updateLiveStatus({
                  currentAction: `${agent.name} 完成工具调用 ${tool}`,
                  toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                });
              } else if (status === 'error') {
                requirement.addGroupMessage(agent, `⚠️ 工具 ${tool} 执行失败: ${toolErr}`, 'tool_call');
                requirement.updateLiveStatus({
                  toolCallsInProgress: (requirement.liveStatus.toolCallsInProgress || []).filter(t => t !== tool),
                });
              }
            },
            onLLMCall: ({ iteration, maxIterations }) => {
              requirement.updateLiveStatus({
currentAction: `${agent.name} 正在敲键盘中... (第${iteration}轮)`,
              });
              if (iteration > 1) {
                requirement.addGroupMessage(agent, `🧠 继续思考和执行中... (第${iteration}轮)`, 'tool_call');
              }
            },
          });

          node.status = TaskNodeStatus.COMPLETED;
          node.completedAt = new Date();
          node.result = result;
          completed.add(node.id);

          // 记录产出
          if (result.output) {
            // 判断产出类型
            const outputType = this._detectOutputType(result);
            requirement.addOutput(
              agent.id, agent.name, agent.role,
              outputType, result.output,
              { toolResults: result.toolResults, duration: result.duration }
            );
          }

          // 群聊通知：完成
          const duration = Math.round((result.duration || 0) / 1000);
          requirement.addGroupMessage(
            agent,
            `✅ 「${node.title}」完成！耗时${duration}秒。${result.toolResults?.length ? `\n🔧 使用了 ${result.toolResults.length} 个工具` : ''}`,
            'message'
          );

          // 分享产出摘要
          if (result.output) {
            const preview = result.output.length > 200 ? result.output.slice(0, 200) + '...' : result.output;
            requirement.addGroupMessage(
              agent,
              `📄 我的产出：\n${preview}`,
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
            `❌ 「${node.title}」执行失败：${err.message}`,
            'message'
          );
          return null;
        }
      });

      await Promise.all(promises);
    }

    // 汇总
    const successCount = completed.size;
    const totalCount = nodes.length;
    const totalDuration = allResults.reduce((s, r) => s + (r?.duration || 0), 0);

    requirement.status = failed.size === totalCount ? RequirementStatus.FAILED : RequirementStatus.COMPLETED;
    requirement.completedAt = new Date();
    requirement.updateLiveStatus({
      currentNodeId: null,
      currentNodeTitle: null,
      currentAgent: null,
      currentAction: requirement.status === RequirementStatus.COMPLETED ? '全部任务执行完成' : '执行结束（部分失败）',
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
      { name: '系统', role: 'system' },
      `🏁 需求「${requirement.title}」执行${requirement.status === RequirementStatus.COMPLETED ? '完成' : '失败'}！\n📊 ${successCount}/${totalCount} 个任务成功，总耗时 ${Math.round(totalDuration / 1000)} 秒`,
      'system'
    );

    // 绩效评估
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
   * 检测产出类型
   */
  _detectOutputType(result) {
    const toolNames = (result.toolResults || []).map(t => t.tool);
    if (toolNames.includes('file_write')) return 'code';
    if (result.output?.includes('```')) return 'code';
    return 'text';
  }

  /** 序列化所有需求 */
  serialize() {
    return [...this.requirements.values()].map(r => r.serialize());
  }

  /** 反序列化 */
  static deserialize(dataList) {
    const mgr = new RequirementManager();
    for (const d of (dataList || [])) {
      const req = Requirement.deserialize(d);
      mgr.requirements.set(req.id, req);
    }
    return mgr;
  }
}
