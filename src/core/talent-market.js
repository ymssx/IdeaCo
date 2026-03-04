import { v4 as uuidv4 } from 'uuid';

/**
 * Talent Market - Buffer pool for dismissed Agents
 * 
 * Dismissed employees enter the talent market, retaining their memories and skill experience.
 * The secretary can recall former employees from the talent market; they'll return with their original memories and newly acquired skills.
 * Alternatively, you can choose not to reuse them and recruit new hires instead.
 */
export class TalentMarket {
  constructor() {
    this.pool = new Map(); // talentId => TalentProfile
  }

  /**
   * Register a dismissed Agent into the talent market
   * @param {Agent} agent - The dismissed Agent
   * @param {string} reason - Dismissal reason
   * @param {object} performanceData - Performance data
   * @returns {object} Talent profile
   */
  register(agent, reason = 'Project ended', performanceData = null) {
    const profile = {
      id: uuidv4(),
      originalAgentId: agent.id,
      name: agent.name,
      role: agent.role,
      prompt: agent.prompt,
      skills: [...agent.skills],
      // Skills potentially acquired while in the talent market
      acquiredSkills: [],
      provider: agent.provider,
      // 保存头像和个人属性
      avatar: agent.avatar,
      avatarParams: agent.avatarParams || null,
      gender: agent.gender,
      age: agent.age,
      personality: agent.personality,
      signature: agent.signature,
      // Save complete memory data
      memorySnapshot: agent.memory ? agent.memory.serialize() : null,
      // Save performance data
      performanceData,
      // Work history
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

    console.log(`  🏪 [${agent.name}] (${agent.role}) entered the talent market`);
    console.log(`     Dismissal reason: ${reason}`);
    console.log(`     Skills: ${agent.skills.join(', ')}`);
    if (agent.memory) {
      console.log(`     Memories: short-term ${agent.memory.shortTerm.length}, long-term ${agent.memory.longTerm.length}`);
    }

    return profile;
  }

  /**
   * Search for available talent in the talent market
   * @param {object} criteria - Search criteria
   * @param {string} [criteria.role] - Role/position
   * @param {string[]} [criteria.skills] - Required skills
   * @param {string} [criteria.name] - Name search
   * @param {number} [criteria.minScore] - Minimum performance score
   * @returns {Array} List of matching talent profiles
   */
  search(criteria = {}) {
    const results = [];

    for (const profile of this.pool.values()) {
      if (profile.status !== 'available') continue;

      let match = true;

      // Match by role
      if (criteria.role && !profile.role.includes(criteria.role)) {
        match = false;
      }

      // Match by skills
      if (criteria.skills && criteria.skills.length > 0) {
        const allSkills = [...profile.skills, ...profile.acquiredSkills];
        const hasSkills = criteria.skills.some(s =>
          allSkills.some(ps => ps.includes(s))
        );
        if (!hasSkills) match = false;
      }

      // Match by name
      if (criteria.name && !profile.name.includes(criteria.name)) {
        match = false;
      }

      // Match by minimum performance score
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
   * Recall a talent from the talent market
   * @param {string} profileId - Talent profile ID
   * @param {string[]} [newSkills] - New skills acquired while in the talent market
   * @returns {object} Recalled talent profile (with memories and new skills)
   */
  recall(profileId, newSkills = []) {
    const profile = this.pool.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found in talent market: ${profileId}`);
    }
    if (profile.status !== 'available') {
      throw new Error(`This talent is no longer available, status: ${profile.status}`);
    }

    // Add new skills
    profile.acquiredSkills.push(...newSkills);
    profile.status = 'recalled';

    console.log(`  📞 Recalled from talent market: [${profile.name}] (${profile.role})`);
    console.log(`     Original skills: ${profile.skills.join(', ')}`);
    if (profile.acquiredSkills.length > 0) {
      console.log(`     Newly acquired skills: ${profile.acquiredSkills.join(', ')}`);
    }
    if (profile.memorySnapshot) {
      const memData = profile.memorySnapshot;
      console.log(`     Memories: short-term ${memData.shortTerm?.length || 0}, long-term ${memData.longTerm?.length || 0}`);
    }

    return profile;
  }

  /**
   * Permanently remove a talent from the talent market
   * @param {string} profileId - Talent profile ID
   * @returns {object} The removed talent profile
   */
  remove(profileId) {
    const profile = this.pool.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found in talent market: ${profileId}`);
    }
    this.pool.delete(profileId);
    console.log(`  🗑️ Permanently removed from talent market: [${profile.name}] (${profile.role})`);
    return profile;
  }

  /**
   * Get all available talent in the talent market
   */
  listAvailable() {
    return [...this.pool.values()].filter(p => p.status === 'available');
  }

  /**
   * Get talent market statistics
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
   * Print talent market information
   */
  print() {
    const available = this.listAvailable();
    console.log(`\n🏪 Talent Market (${available.length} available):`);
    if (available.length === 0) {
      console.log('   (empty)');
      return;
    }
    available.forEach(p => {
      const allSkills = [...p.skills, ...p.acquiredSkills.map(s => `${s}(new)`)];
      console.log(`   👤 ${p.name} (${p.role}) - ${p.dismissalReason}`);
      console.log(`      Skills: ${allSkills.join(', ')}`);
      if (p.performanceData) {
        console.log(`      Historical performance: ${p.performanceData.averageScore} pts`);
      }
    });
  }
}
