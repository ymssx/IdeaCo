import { v4 as uuidv4 } from 'uuid';
import { Agent } from './agent.js';

/**
 * 部门 - 由多个Agent组成的协作单元
 * 支持绩效评估流程和成员解聘
 */
export class Department {
  constructor({ name, mission, company }) {
    this.id = uuidv4();
    this.name = name;             // 部门名称
    this.mission = mission;       // 部门使命/目标
    this.company = company;       // 所属公司
    this.agents = new Map();      // 部门成员 (agentId => Agent)
    this.leader = null;           // 部门负责人
    this.orgStructure = null;     // 组织架构描述
    this.tasks = [];              // 部门任务列表
    this.status = 'preparing';    // preparing | active | completed | disbanded
    this.createdAt = new Date();
  }

  /** 添加Agent到部门 */
  addAgent(agent) {
    agent.department = this.id;
    this.agents.set(agent.id, agent);
    console.log(`  ✅ [${agent.name}] (${agent.role}) 已加入「${this.name}」部门`);
    console.log(`     模型供应商: ${agent.provider.name} (${agent.provider.provider})`);
    return agent;
  }

  /**
   * 移除Agent（解聘前的部门操作）
   * @param {string} agentId - 要移除的Agent ID
   * @returns {Agent|null} 被移除的Agent
   */
  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // 如果是负责人，清空负责人
    if (this.leader === agentId) {
      this.leader = null;
    }

    // 清理汇报关系：将该Agent的下属转移到其上级
    const managerId = agent.reportsTo;
    const manager = managerId ? this.agents.get(managerId) : null;

    // 将下属重新分配给上级
    for (const subId of agent.subordinates) {
      const sub = this.agents.get(subId);
      if (sub) {
        if (manager) {
          sub.setManager(manager);
          console.log(`  🔄 [${sub.name}] 的汇报关系转移到 [${manager.name}]`);
        } else {
          sub.reportsTo = null;
        }
      }
    }

    // 清理上级的下属列表
    if (manager) {
      manager.subordinates = manager.subordinates.filter(id => id !== agentId);
    }

    // 从部门移除
    this.agents.delete(agentId);
    agent.department = null;
    agent.reportsTo = null;
    agent.subordinates = [];

    console.log(`  🚪 [${agent.name}] (${agent.role}) 已离开「${this.name}」部门`);
    return agent;
  }

  /** 设置部门负责人 */
  setLeader(agent) {
    this.leader = agent.id;
    console.log(`  👔 [${agent.name}] 被任命为「${this.name}」部门负责人`);
  }

  /** 建立汇报关系 */
  setReportingLine(subordinate, manager) {
    subordinate.setManager(manager);
    console.log(`  📋 汇报关系: [${subordinate.name}] → [${manager.name}]`);
  }

  /** 获取部门所有成员 */
  getMembers() {
    return [...this.agents.values()];
  }

  /** 获取部门负责人 */
  getLeader() {
    return this.agents.get(this.leader);
  }

  /** 获取某个成员的下属 */
  getSubordinates(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    return agent.subordinates
      .map(subId => this.agents.get(subId))
      .filter(Boolean);
  }

  /**
   * 部门协作执行任务，执行完后自动进行绩效评估
   * @param {object} project - 项目
   * @param {PerformanceSystem} [performanceSystem] - 绩效系统（可选）
   */
  async executeProject(project, performanceSystem = null) {
    console.log(`\n🏢 「${this.name}」部门开始执行项目: "${project.name}"`);
    console.log(`   项目描述: ${project.description}`);
    console.log(`   参与成员: ${this.agents.size}人\n`);

    this.status = 'active';
    const results = [];
    // 收集每个agent完成的任务，用于后续绩效评估
    const agentTaskMap = new Map();

    // 按任务阶段执行
    for (const phase of project.phases) {
      console.log(`\n📌 阶段: ${phase.name}`);
      console.log(`   ${phase.description}`);

      // 并行执行同一阶段的任务
      const phasePromises = phase.tasks.map(async (task) => {
        const assignee = this.agents.get(task.assigneeId);
        if (!assignee) {
          console.log(`  ⚠️ 找不到任务指派人: ${task.assigneeId}`);
          return null;
        }
        const result = await assignee.executeTask(task);

        // 记录agent完成的任务
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

      // 阶段完成后汇报
      const leader = this.getLeader();
      if (leader) {
        console.log(`\n  📊 [${leader.name}] 汇总阶段「${phase.name}」成果...`);
      }
    }

    this.status = 'completed';
    console.log(`\n✅ 「${this.name}」部门项目 "${project.name}" 已完成!`);

    // 项目完成后进行绩效评估
    if (performanceSystem) {
      console.log(`\n📋 开始项目绩效评估...`);
      await this._runPerformanceReview(performanceSystem, agentTaskMap);
    }

    return results;
  }

  /**
   * 执行绩效评估：由上级对下属打分，员工进行自我反馈
   */
  async _runPerformanceReview(performanceSystem, agentTaskMap) {
    const leader = this.getLeader();

    for (const [agentId, taskResults] of agentTaskMap) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      // 找到该agent的直属上级作为评估人
      let reviewer = null;
      if (agent.reportsTo) {
        reviewer = this.agents.get(agent.reportsTo);
      }
      // 如果没有上级，由部门负责人评估
      if (!reviewer && leader && leader.id !== agentId) {
        reviewer = leader;
      }
      // 负责人自评（或者跳过）
      if (!reviewer) continue;

      // 对每个任务进行评估
      for (const { task } of taskResults) {
        const review = performanceSystem.autoEvaluate({
          agent,
          reviewer,
          taskTitle: task.title,
        });

        // 员工接收反馈并自我反思
        agent.receiveFeedback(review);
      }
    }

    console.log(`\n✅ 绩效评估完成!`);
  }

  /** 获取部门组织架构树 */
  getOrgTree() {
    const leader = this.getLeader();
    if (!leader) return null;

    const buildTree = (agent) => ({
      name: agent.name,
      role: agent.role,
      provider: agent.provider.name,
      subordinates: this.getSubordinates(agent.id).map(sub => buildTree(sub)),
    });

    return buildTree(leader);
  }

  /** 打印组织架构 */
  printOrgChart(node = null, indent = '  ') {
    if (!node) {
      node = this.getOrgTree();
      if (!node) {
        console.log('  (暂无组织架构)');
        return;
      }
      console.log(`\n📊 「${this.name}」部门组织架构:`);
    }

    console.log(`${indent}├── 👤 ${node.name} (${node.role}) [${node.provider}]`);
    node.subordinates.forEach(sub => {
      this.printOrgChart(sub, indent + '│   ');
    });
  }

  /** 获取部门摘要 */
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
