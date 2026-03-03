import { v4 as uuidv4 } from 'uuid';

/**
 * 人才市场 - 被解聘的Agent的缓冲池
 * 
 * 被解聘的员工会进入人才市场，保留其记忆和技能经验。
 * 秘书可以从人才市场中召回老员工，他们会带着原有的记忆和新习得的skills回归。
 * 也可以选择不复用，重新招聘新人。
 */
export class TalentMarket {
  constructor() {
    this.pool = new Map(); // talentId => TalentProfile
  }

  /**
   * 将被解聘的Agent加入人才市场
   * @param {Agent} agent - 被解聘的Agent
   * @param {string} reason - 解聘原因
   * @param {object} performanceData - 绩效数据
   * @returns {object} 人才档案
   */
  register(agent, reason = '项目结束', performanceData = null) {
    const profile = {
      id: uuidv4(),
      originalAgentId: agent.id,
      name: agent.name,
      role: agent.role,
      prompt: agent.prompt,
      skills: [...agent.skills],
      // 在人才市场期间可能习得的新技能
      acquiredSkills: [],
      provider: agent.provider,
      // 保存完整的记忆数据
      memorySnapshot: agent.memory ? agent.memory.serialize() : null,
      // 保存绩效数据
      performanceData,
      // 工作经历
      workHistory: agent.taskHistory.map(h => ({
        task: h.task,
        completedAt: h.completedAt,
      })),
      previousDepartment: agent.department,
      dismissalReason: reason,
      registeredAt: new Date(),
      status: 'available', // available | recalled | expired
    };

    this.pool.set(profile.id, profile);

    console.log(`  🏪 [${agent.name}] (${agent.role}) 已进入人才市场`);
    console.log(`     解聘原因: ${reason}`);
    console.log(`     携带技能: ${agent.skills.join(', ')}`);
    if (agent.memory) {
      console.log(`     携带记忆: 短期${agent.memory.shortTerm.length}条, 长期${agent.memory.longTerm.length}条`);
    }

    return profile;
  }

  /**
   * 搜索人才市场中的可用人才
   * @param {object} criteria - 搜索条件
   * @param {string} [criteria.role] - 角色/职位
   * @param {string[]} [criteria.skills] - 需要的技能
   * @param {string} [criteria.name] - 名字搜索
   * @param {number} [criteria.minScore] - 最低绩效分数
   * @returns {Array} 匹配的人才档案列表
   */
  search(criteria = {}) {
    const results = [];

    for (const profile of this.pool.values()) {
      if (profile.status !== 'available') continue;

      let match = true;

      // 按角色匹配
      if (criteria.role && !profile.role.includes(criteria.role)) {
        match = false;
      }

      // 按技能匹配
      if (criteria.skills && criteria.skills.length > 0) {
        const allSkills = [...profile.skills, ...profile.acquiredSkills];
        const hasSkills = criteria.skills.some(s =>
          allSkills.some(ps => ps.includes(s))
        );
        if (!hasSkills) match = false;
      }

      // 按名字匹配
      if (criteria.name && !profile.name.includes(criteria.name)) {
        match = false;
      }

      // 按最低绩效分数匹配
      if (criteria.minScore && profile.performanceData) {
        if (profile.performanceData.averageScore < criteria.minScore) {
          match = false;
        }
      }

      if (match) results.push(profile);
    }

    return results;
  }

  /**
   * 从人才市场中召回一个人才
   * @param {string} profileId - 人才档案ID
   * @param {string[]} [newSkills] - 在人才市场期间习得的新技能
   * @returns {object} 召回的人才档案（包含记忆和新技能）
   */
  recall(profileId, newSkills = []) {
    const profile = this.pool.get(profileId);
    if (!profile) {
      throw new Error(`人才市场中未找到档案: ${profileId}`);
    }
    if (profile.status !== 'available') {
      throw new Error(`该人才已不可用，状态: ${profile.status}`);
    }

    // 添加新技能
    profile.acquiredSkills.push(...newSkills);
    profile.status = 'recalled';

    console.log(`  📞 从人才市场召回: [${profile.name}] (${profile.role})`);
    console.log(`     原有技能: ${profile.skills.join(', ')}`);
    if (profile.acquiredSkills.length > 0) {
      console.log(`     新习得技能: ${profile.acquiredSkills.join(', ')}`);
    }
    if (profile.memorySnapshot) {
      const memData = profile.memorySnapshot;
      console.log(`     携带记忆: 短期${memData.shortTerm?.length || 0}条, 长期${memData.longTerm?.length || 0}条`);
    }

    return profile;
  }

  /**
   * 从人才市场中彻底删除一个人才
   * @param {string} profileId - 人才档案ID
   * @returns {object} 被删除的人才档案
   */
  remove(profileId) {
    const profile = this.pool.get(profileId);
    if (!profile) {
      throw new Error(`人才市场中未找到档案: ${profileId}`);
    }
    this.pool.delete(profileId);
    console.log(`  🗑️ 从人才市场永久删除: [${profile.name}] (${profile.role})`);
    return profile;
  }

  /**
   * 获取人才市场中所有可用人才
   */
  listAvailable() {
    return [...this.pool.values()].filter(p => p.status === 'available');
  }

  /**
   * 获取人才市场统计信息
   */
  getStats() {
    const all = [...this.pool.values()];
    return {
      total: all.length,
      available: all.filter(p => p.status === 'available').length,
      recalled: all.filter(p => p.status === 'recalled').length,
      byRole: all.reduce((acc, p) => {
        acc[p.role] = (acc[p.role] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  /**
   * 打印人才市场信息
   */
  print() {
    const available = this.listAvailable();
    console.log(`\n🏪 人才市场 (${available.length}人可用):`);
    if (available.length === 0) {
      console.log('   (空空如也)');
      return;
    }
    available.forEach(p => {
      const allSkills = [...p.skills, ...p.acquiredSkills.map(s => `${s}(新)`)];
      console.log(`   👤 ${p.name} (${p.role}) - ${p.dismissalReason}`);
      console.log(`      技能: ${allSkills.join(', ')}`);
      if (p.performanceData) {
        console.log(`      历史绩效: ${p.performanceData.averageScore}分`);
      }
    });
  }
}
