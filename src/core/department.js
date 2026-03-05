import { v4 as uuidv4 } from 'uuid';
import { Agent } from './agent.js';

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
    this.groupChat.push({
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
    });
  }

  /** Add an Agent to the department */
  addAgent(agent) {
    agent.department = this.id;
    this.agents.set(agent.id, agent);
    console.log(`  ✅ [${agent.name}] (${agent.role}) joined department "${this.name}"`);
    console.log(`     Model provider: ${agent.provider.name} (${agent.provider.provider})`);
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

  /** Get the department leader */
  getLeader() {
    return this.agents.get(this.leader);
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
      provider: agent.provider.name,
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
