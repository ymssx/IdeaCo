/**
 * EmployeeSkillSet — Per-employee skill management.
 *
 * Replaces the flat `this.skills: string[]` on Employee with a rich
 * skill management layer. Each employee can enable, disable, and pin
 * skills from the global SkillRegistry, with overrides persisted per-agent.
 *
 * Pinned skills are always active regardless of global state.
 * Enabled skills follow the global registry state.
 */

/**
 * EmployeeSkillSet
 */
export class EmployeeSkillSet {
  /**
   * @param {string} employeeId
   * @param {object} [opts]
   * @param {string[]} [opts.enabledSkills] - Skill IDs this employee has enabled
   * @param {string[]} [opts.pinnedSkills]  - Always-on skill IDs
   * @param {object}   [opts.skillConfigs]  - Per-skill config overrides { [skillId]: {...} }
   * @param {string[]} [opts.legacySkills]  - Legacy free-text skill tags (for backward compat)
   */
  constructor(employeeId, opts = {}) {
    this.employeeId = employeeId;

    /** @type {Set<string>} Skill IDs this employee has explicitly enabled */
    this.enabledSkills = new Set(opts.enabledSkills || []);

    /** @type {Set<string>} Always-on skill IDs (persist even if globally disabled) */
    this.pinnedSkills = new Set(opts.pinnedSkills || []);

    /** @type {Map<string, object>} Per-skill config overrides */
    this.skillConfigs = new Map(
      Object.entries(opts.skillConfigs || {})
    );

    /** @type {string[]} Legacy free-text skill tags (from old HR templates) */
    this.legacySkills = opts.legacySkills || [];
  }

  // ---- Skill management ----

  /**
   * Enable a skill for this employee
   */
  enable(skillId) {
    this.enabledSkills.add(skillId);
  }

  /**
   * Disable a skill for this employee
   */
  disable(skillId) {
    this.enabledSkills.delete(skillId);
    this.pinnedSkills.delete(skillId);
  }

  /**
   * Pin a skill — always active for this employee
   */
  pin(skillId) {
    this.pinnedSkills.add(skillId);
    this.enabledSkills.add(skillId);
  }

  /**
   * Unpin a skill (still enabled, just no longer pinned)
   */
  unpin(skillId) {
    this.pinnedSkills.delete(skillId);
  }

  /**
   * Check if a skill is enabled for this employee
   */
  has(skillId) {
    return this.enabledSkills.has(skillId);
  }

  /**
   * Check if a skill is pinned
   */
  isPinned(skillId) {
    return this.pinnedSkills.has(skillId);
  }

  /**
   * Get per-skill config override
   */
  getConfig(skillId) {
    return this.skillConfigs.get(skillId) || {};
  }

  /**
   * Set per-skill config override
   */
  setConfig(skillId, config) {
    this.skillConfigs.set(skillId, config);
  }

  /**
   * Bulk set all enabled skills (replace current set)
   */
  setEnabledSkills(skillIds) {
    this.enabledSkills = new Set(skillIds);
    // Ensure pinned skills remain enabled
    for (const pinned of this.pinnedSkills) {
      this.enabledSkills.add(pinned);
    }
  }

  // ---- Resolution ----

  /**
   * Resolve final skill definitions for this employee.
   * Combines employee-enabled skills with the global registry state.
   *
   * @param {import('./skills.js').SkillRegistry} skillRegistry
   * @returns {import('./skills.js').SkillDefinition[]}
   */
  resolve(skillRegistry) {
    if (this.enabledSkills.size === 0 && this.pinnedSkills.size === 0) {
      // No explicit skill selection — return empty (only installed skills should be disclosed)
      return [];
    }

    const result = [];
    const seen = new Set();

    // First add pinned skills (always active, even if globally disabled)
    for (const id of this.pinnedSkills) {
      const entry = skillRegistry.get(id);
      if (entry && !seen.has(id)) {
        result.push(entry.definition);
        seen.add(id);
      }
    }

    // Then add enabled skills (only if globally enabled too)
    for (const id of this.enabledSkills) {
      if (seen.has(id)) continue;
      const entry = skillRegistry.get(id);
      if (entry && entry.state === 'enabled') {
        result.push(entry.definition);
        seen.add(id);
      }
    }

    return result;
  }

  // ---- Permissions ----

  /**
   * Get the aggregated set of permissions granted by all enabled/pinned skills.
   * Permissions come from each skill's `grantedPermissions` array.
   *
   * @param {import('./registry.js').SkillRegistry} skillRegistry
   * @returns {Set<string>} All permissions this employee has
   */
  getPermissions(skillRegistry) {
    const permissions = new Set();
    const skills = this.resolve(skillRegistry);
    for (const skill of skills) {
      if (skill.grantedPermissions) {
        for (const perm of skill.grantedPermissions) {
          permissions.add(perm);
        }
      }
    }
    return permissions;
  }

  /**
   * Check if this employee has a specific permission via their skills.
   *
   * @param {string} permission - Permission string to check (e.g. 'management.create_department')
   * @param {import('./registry.js').SkillRegistry} skillRegistry
   * @returns {boolean}
   */
  hasPermission(permission, skillRegistry) {
    return this.getPermissions(skillRegistry).has(permission);
  }

  /**
   * Get all skill IDs (enabled + pinned) as a flat array.
   * Used for display and backward-compat with the old `this.skills` array.
   */
  toArray() {
    const ids = new Set([...this.enabledSkills, ...this.pinnedSkills]);
    // Append legacy tags that aren't registry skill IDs
    for (const tag of this.legacySkills) {
      ids.add(tag);
    }
    return [...ids];
  }

  // ---- Serialization ----

  serialize() {
    const configObj = {};
    for (const [k, v] of this.skillConfigs) {
      configObj[k] = v;
    }

    return {
      enabledSkills: [...this.enabledSkills],
      pinnedSkills: [...this.pinnedSkills],
      skillConfigs: configObj,
      legacySkills: this.legacySkills,
    };
  }

  static deserialize(employeeId, data) {
    if (!data) return new EmployeeSkillSet(employeeId);

    // Handle backward compatibility with old `skills: string[]` format
    if (Array.isArray(data)) {
      return EmployeeSkillSet.fromLegacy(employeeId, data);
    }

    return new EmployeeSkillSet(employeeId, {
      enabledSkills: data.enabledSkills || [],
      pinnedSkills: data.pinnedSkills || [],
      skillConfigs: data.skillConfigs || {},
      legacySkills: data.legacySkills || [],
    });
  }

  /**
   * Create from legacy `skills: string[]` format.
   * Old skills were just free-text tags like ['coding', 'api-design'].
   * We keep them as legacySkills and don't enable any registry skills.
   */
  static fromLegacy(employeeId, skillTags) {
    return new EmployeeSkillSet(employeeId, {
      legacySkills: skillTags || [],
    });
  }
}
