import { v4 as uuidv4 } from 'uuid';

/**
 * Sprint status enum
 */
export const SprintStatus = {
  DRAFT: 'draft',             // Sprint draft, not started yet
  DISCUSSING: 'discussing',   // Leader initiates group discussion on sprint plan
  PENDING_APPROVAL: 'pending_approval', // Discussion complete, waiting for Boss approval
  IN_PROGRESS: 'in_progress', // Boss approved, sprint in progress
  COMPLETED: 'completed',     // Sprint completed
  FAILED: 'failed',           // Sprint failed
};

/**
 * Sprint — similar to a Requirement, one iteration cycle
 */
export class Sprint {
  constructor({ title, goal, teamId, teamName }) {
    this.id = uuidv4();
    this.title = title;
    this.goal = goal;                // Sprint goal
    this.teamId = teamId;
    this.teamName = teamName;
    this.status = SprintStatus.DRAFT;
    this.plan = null;                // Sprint plan formed after discussion
    this.requirementId = null;       // Standard requirement ID created after approval
    this.workflow = null;            // (deprecated) workflow is managed by the associated requirement
    this.groupChat = [];             // Sprint group chat
    this.outputs = [];               // Outputs
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.summary = null;

    // Live progress
    this.liveStatus = {
      currentNodeId: null,
      currentNodeTitle: null,
      currentAgent: null,
      currentAction: null,
      lastActiveAt: null,
      heartbeat: null,
      toolCallsInProgress: [],
      recentFileChanges: [],
    };
  }

  updateLiveStatus(updates) {
    Object.assign(this.liveStatus, updates, { lastActiveAt: new Date(), heartbeat: new Date() });
  }

  addFileChange(agentName, filePath, action = 'write') {
    this.liveStatus.recentFileChanges.push({ agentName, filePath, action, time: new Date() });
    if (this.liveStatus.recentFileChanges.length > 100) {
      this.liveStatus.recentFileChanges = this.liveStatus.recentFileChanges.slice(-100);
    }
    this.liveStatus.lastActiveAt = new Date();
    this.liveStatus.heartbeat = new Date();
  }

  addGroupMessage(from, content, type = 'message', visibility = null) {
    const resolvedVisibility = visibility || (type === 'tool_call' || type === 'output' ? 'flow' : 'group');
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
      visibility: resolvedVisibility,
      time: new Date(),
    });
    this.liveStatus.heartbeat = new Date();
    this.liveStatus.lastActiveAt = new Date();
  }

  addOutput(agentId, agentName, role, outputType, content, metadata = {}) {
    this.outputs.push({
      id: uuidv4(), agentId, agentName, role, outputType, content, metadata, createdAt: new Date(),
    });
  }

  serialize() {
    return {
      id: this.id,
      title: this.title,
      goal: this.goal,
      teamId: this.teamId,
      teamName: this.teamName,
      status: this.status,
      plan: this.plan,
      requirementId: this.requirementId,
      workflow: this.workflow,
      groupChat: this.groupChat.slice(-200),
      outputs: this.outputs,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      summary: this.summary,
      liveStatus: this.liveStatus,
    };
  }

  static deserialize(data) {
    const s = new Sprint({
      title: data.title,
      goal: data.goal,
      teamId: data.teamId,
      teamName: data.teamName,
    });
    s.id = data.id;
    s.status = data.status;
    s.plan = data.plan;
    s.requirementId = data.requirementId || null;
    s.workflow = data.workflow;
    s.groupChat = data.groupChat || [];
    s.outputs = data.outputs || [];
    s.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    s.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    s.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    s.summary = data.summary;
    s.liveStatus = data.liveStatus || {
      currentNodeId: null, currentNodeTitle: null, currentAgent: null,
      currentAction: null, lastActiveAt: null, heartbeat: null,
      toolCallsInProgress: [], recentFileChanges: [],
    };
    return s;
  }
}

/**
 * Team — a specialized subgroup within a department
 */
export class Team {
  constructor({ name, departmentId, departmentName, memberIds, leaderId, leaderName, description }) {
    this.id = uuidv4();
    this.name = name;
    this.departmentId = departmentId;
    this.departmentName = departmentName;
    this.memberIds = memberIds || [];      // Team member ID list
    this.leaderId = leaderId;              // Leader ID
    this.leaderName = leaderName;
    this.description = description || '';
    this.skills = [];                       // Team skill list
    this.workspacePath = null;              // Dedicated workspace directory
    this.sprints = new Map();              // Sprint list (sprintId => Sprint)
    this.createdAt = new Date();
    this.status = 'active';                // active | archived
  }

  addSprint(sprint) {
    this.sprints.set(sprint.id, sprint);
    return sprint;
  }

  getSprint(id) {
    return this.sprints.get(id);
  }

  listSprints() {
    return [...this.sprints.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      departmentId: this.departmentId,
      departmentName: this.departmentName,
      memberIds: this.memberIds,
      leaderId: this.leaderId,
      leaderName: this.leaderName,
      description: this.description,
      skills: this.skills,
      workspacePath: this.workspacePath,
      sprints: [...this.sprints.values()].map(s => s.serialize()),
      createdAt: this.createdAt,
      status: this.status,
    };
  }

  static deserialize(data) {
    const t = new Team({
      name: data.name,
      departmentId: data.departmentId,
      departmentName: data.departmentName,
      memberIds: data.memberIds,
      leaderId: data.leaderId,
      leaderName: data.leaderName,
      description: data.description,
    });
    t.id = data.id;
    t.skills = data.skills || [];
    t.workspacePath = data.workspacePath || null;
    t.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    t.status = data.status || 'active';
    // Deserialize sprints
    for (const sd of (data.sprints || [])) {
      const sprint = Sprint.deserialize(sd);
      t.sprints.set(sprint.id, sprint);
    }
    return t;
  }
}

/**
 * TeamManager — manages all teams
 */
export class TeamManager {
  constructor() {
    this.teams = new Map();
  }

  create(data) {
    const team = new Team(data);
    this.teams.set(team.id, team);
    return team;
  }

  get(id) {
    return this.teams.get(id);
  }

  delete(id) {
    return this.teams.delete(id);
  }

  listAll() {
    return [...this.teams.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  listByDepartment(departmentId) {
    return this.listAll().filter(t => t.departmentId === departmentId);
  }

  serialize() {
    return [...this.teams.values()].map(t => t.serialize());
  }

  static deserialize(dataList) {
    const mgr = new TeamManager();
    for (const d of (dataList || [])) {
      const team = Team.deserialize(d);
      mgr.teams.set(team.id, team);
    }
    return mgr;
  }
}
