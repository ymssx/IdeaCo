import { Employee } from './base-employee.js';
import { createEmployee } from './index.js';

/**
 * Secretary's Dedicated HR Assistant
 * Handles recruitment operations, talent market search, and recall
 */
export class HRAssistant {
  constructor({ secretary, providerConfig }) {
    // HR assistant is always an Employee (LLM-based)
    this.employee = new Employee({
      name: 'HR-Bot',
      role: 'HR Recruiter',
      prompt: `You are the secretary's dedicated HR assistant, responsible for executing recruitment operations.
Your duties include: searching for suitable candidates in the talent market, evaluating candidates' historical performance and skill match,
executing the recruitment process, and coordinating new employee onboarding. You need to make optimal decisions between "recalling former employees" and "hiring new ones" based on position requirements.`,
      skills: ['talent-search', 'resume-screening', 'performance-evaluation', 'recruitment-process', 'onboarding'],
      provider: providerConfig,
    });
    this.secretary = secretary;
  }

  smartRecruit(requirement, hr) {
    const { templateId, name, preferRecall = true } = requirement;

    if (preferRecall && hr.talentMarket) {
      const template = hr.getTemplate(templateId);
      if (template) {
        const candidates = hr.searchTalentMarket({
          role: template.title, skills: template.skills,
        });

        if (candidates.length > 0) {
          const best = this._pickBestCandidate(candidates, template);
          if (best) {
            console.log(`  🔍 [HR-Bot] Found matching candidate in talent market: ${best.name} (${best.role})`);
            const decision = this._decideRecallOrNew(best, template);
            if (decision === 'recall') {
              console.log(`  ✅ [HR-Bot] Decided to recall former employee: ${best.name}`);
              return hr.recallFromMarket(best.id);
            } else {
              console.log(`  🆕 [HR-Bot] Decided to hire new (former employee not a good match)`);
            }
          }
        } else {
          console.log(`  🔍 [HR-Bot] No matching candidates in talent market, will hire new`);
        }
      }
    }

    return hr.recruit(templateId, name);
  }

  _pickBestCandidate(candidates, template) {
    const scored = candidates.map(c => {
      const allSkills = [...c.skills, ...c.acquiredSkills];
      const matchCount = template.skills.filter(s =>
        allSkills.some(cs => cs.includes(s) || s.includes(cs))
      ).length;
      const skillScore = matchCount / template.skills.length;
      const perfScore = c.performanceData?.averageScore ? c.performanceData.averageScore / 100 : 0.5;
      return { ...c, totalScore: skillScore * 0.6 + perfScore * 0.4 };
    });
    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored[0] || null;
  }

  _decideRecallOrNew(candidate, template) {
    if (candidate.performanceData?.averageScore < 50) return 'new';
    const allSkills = [...candidate.skills, ...candidate.acquiredSkills];
    const matchCount = template.skills.filter(s =>
      allSkills.some(cs => cs.includes(s) || s.includes(cs))
    ).length;
    if (matchCount >= template.skills.length * 0.5) return 'recall';
    return 'new';
  }

  /**
   * Execute recruitment based on a team plan.
   * @param {object} plan - Team plan with members array
   * @param {object} hr - HRSystem instance
   * @returns {Array} Array of recruited employees
   */
  executeRecruitment(plan, hr) {
    console.log(`\n🔔 [HR] Starting recruitment, HR assistant [${this.employee.name}] handling operations...`);

    const employees = [];
    const skipped = [];

    for (const memberPlan of plan.members) {
      console.log(`\n  📌 Position: ${memberPlan.templateTitle} (${memberPlan.name})`);

      try {
        const recruitConfig = this.smartRecruit(
          { templateId: memberPlan.templateId, name: memberPlan.name, preferRecall: true },
          hr
        );
        const employee = createEmployee(recruitConfig);

        if (recruitConfig.cliBackend) {
          console.log(`  🖥️ [${employee.name}] assigned CLI backend: ${recruitConfig.cliBackend}`);
        }

        if (recruitConfig.isRecalled) {
          console.log(`  🔄 [${employee.name}] is a former employee recalled from talent market, carrying original memories`);
        }

        employees.push(employee);
      } catch (e) {
        if (e.message.startsWith('PROVIDER_DISABLED:')) {
          const parts = e.message.split(':');
          const category = parts[1];
          const reason = parts[2];
          console.log(`  ⚠️ [HR-Bot] Cannot hire "${memberPlan.templateTitle}": ${reason}`);
          console.log(`     Hint: Please configure API Key for ${category} type providers first`);
          skipped.push({ ...memberPlan, reason });
          employees.push(null);
        } else {
          throw e;
        }
      }
    }

    const validEmployees = employees.filter(Boolean);

    for (let i = 0; i < plan.members.length; i++) {
      if (!employees[i]) continue;
      const memberPlan = plan.members[i];
      if (memberPlan.reportsTo !== null && employees[memberPlan.reportsTo]) {
        employees[i].setManager(employees[memberPlan.reportsTo]);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ [HR] ${skipped.length} positions skipped due to unconfigured providers:`);
      skipped.forEach(s => console.log(`   - ${s.templateTitle}: ${s.reason}`));
    }

    console.log(`\n✅ [HR] Recruitment complete! Successfully hired ${validEmployees.length}, skipped ${skipped.length}`);
    return validEmployees;
  }
}
