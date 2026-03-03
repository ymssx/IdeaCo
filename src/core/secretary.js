import { v4 as uuidv4 } from 'uuid';
import { Agent } from './agent.js';
import { JobCategory } from './providers.js';
import { llmClient } from './llm-client.js';
import { JobTemplates } from './hr.js';

/**
 * 秘书的专属HR助手
 * 帮助秘书处理具体的招聘事务、人才市场搜索和召回
 */
export class HRAssistant {
  constructor({ secretary, providerConfig }) {
    this.agent = new Agent({
      name: '小HR',
      role: 'HR招聘专员',
      prompt: `你是秘书的专属HR助手，负责执行具体的招聘操作。
你的职责包括：在人才市场中搜索合适的候选人、评估候选人的历史绩效和技能匹配度、
执行招聘流程、协调新员工入职。你需要根据岗位需求，在「召回老员工」和「招聘新人」之间做出最优决策。`,
      skills: ['人才搜索', '简历筛选', '绩效评估', '招聘流程', '入职协调'],
      provider: providerConfig,
    });
    this.secretary = secretary;
  }

  /**
   * 智能招聘决策：先查人才市场，再决定是召回还是新招
   * @param {object} requirement - 岗位需求 { templateId, name, role, skills }
   * @param {HRSystem} hr - HR系统
   * @returns {object} 招聘结果配置
   */
  smartRecruit(requirement, hr) {
    const { templateId, name, preferRecall = true } = requirement;

    // 如果偏好召回，先查人才市场
    if (preferRecall && hr.talentMarket) {
      const template = hr.getTemplate(templateId);
      if (template) {
        // 搜索人才市场中匹配的人才
        const candidates = hr.searchTalentMarket({
          role: template.title,
          skills: template.skills,
        });

        if (candidates.length > 0) {
          // 找到匹配的人才，评估是否召回
          const best = this._pickBestCandidate(candidates, template);
          if (best) {
            console.log(`  🔍 [小HR] 在人才市场发现匹配候选人: ${best.name} (${best.role})`);
            const decision = this._decideRecallOrNew(best, template);
            if (decision === 'recall') {
              console.log(`  ✅ [小HR] 决定召回老员工: ${best.name}`);
              return hr.recallFromMarket(best.id);
            } else {
              console.log(`  🆕 [小HR] 决定招聘新人（老员工不够匹配）`);
            }
          }
        } else {
          console.log(`  🔍 [小HR] 人才市场无匹配候选人，将招聘新人`);
        }
      }
    }

    // 正常招聘新人
    return hr.recruit(templateId, name);
  }

  /**
   * 从候选人中选择最佳人选
   */
  _pickBestCandidate(candidates, template) {
    // 按技能匹配度排序
    const scored = candidates.map(c => {
      const allSkills = [...c.skills, ...c.acquiredSkills];
      const matchCount = template.skills.filter(s =>
        allSkills.some(cs => cs.includes(s) || s.includes(cs))
      ).length;
      const skillScore = matchCount / template.skills.length;

      // 绩效加分
      const perfScore = c.performanceData?.averageScore
        ? c.performanceData.averageScore / 100
        : 0.5;

      return {
        ...c,
        totalScore: skillScore * 0.6 + perfScore * 0.4,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored[0] || null;
  }

  /**
   * 决策：召回还是新招
   * 如果老员工的综合评分 > 0.5，则召回；否则新招
   */
  _decideRecallOrNew(candidate, template) {
    // 如果有绩效数据且平均分低于50，不召回
    if (candidate.performanceData?.averageScore < 50) {
      return 'new';
    }
    // 如果技能匹配度高，召回
    const allSkills = [...candidate.skills, ...candidate.acquiredSkills];
    const matchCount = template.skills.filter(s =>
      allSkills.some(cs => cs.includes(s) || s.includes(cs))
    ).length;
    if (matchCount >= template.skills.length * 0.5) {
      return 'recall';
    }
    return 'new';
  }
}

/**
 * 秘书Agent - 老板的专属秘书
 * 负责分析需求、设计团队架构、协调招聘
 * 现在拥有专属HR助手来帮忙处理招聘事务
 */
export class Secretary {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar }) {
    this.agent = new Agent({
      name: secretaryName || '小秘',
      role: '专属秘书',
      prompt: `你是企业老板的专属秘书，负责理解老板的业务需求，分析所需的团队构成，
设计组织架构（谁负责什么、谁向谁汇报、如何协作），并协调HR进行人才招聘。
你需要根据项目需求，合理规划不同岗位的数量和类型，确保团队能高效完成目标。
你有一个专属的HR助手来帮你处理具体的招聘事务，包括从人才市场中搜索和召回人才。

当老板和你沟通时，你需要：
1. 理解老板的意图（是分配任务、查询进度、还是日常沟通）
2. 如果是任务，分配给对应部门
3. 定期向老板汇报各部门进度`,
      skills: ['需求分析', '团队规划', '组织设计', '人力协调', '项目管理', '任务分配', '进度汇报'],
      provider: providerConfig,
      avatar: secretaryAvatar,
    });
    this.company = company;

    // 初始化专属HR助手
    this.hrAssistant = new HRAssistant({
      secretary: this,
      providerConfig,
    });

    console.log(`  🧑‍💼 秘书的专属HR助手已就位: ${this.hrAssistant.agent.name}`);
  }

  /**
   * 分析需求并设计团队架构 —— 使用AI分析
   */
  async designTeam(requirement) {
    console.log(`\n🗂️ [小秘] 正在AI分析需求并设计团队架构...`);
    console.log(`   需求: "${requirement}"\n`);

    let plan;

    // 尝试用LLM分析
    if (this.agent.provider && this.agent.provider.enabled && this.agent.provider.apiKey) {
      try {
        plan = await this._aiAnalyzeRequirement(requirement);
      } catch (e) {
        console.log(`  ⚠️ AI分析失败: ${e.message}，回退到规则分析`);
        plan = this._ruleBasedAnalysis(requirement);
      }
    } else {
      plan = this._ruleBasedAnalysis(requirement);
    }

    console.log(`📋 [小秘] 团队规划方案:`);
    console.log(`   部门名称: ${plan.departmentName}`);
    console.log(`   部门使命: ${plan.mission}`);
    console.log(`   团队规模: ${plan.members.length}人`);
    plan.members.forEach((m, i) => {
      const indent = m.reportsTo !== null ? '      ' : '    ';
      const prefix = m.isLeader ? '👔' : '👤';
      console.log(`${indent}${prefix} ${m.name} - ${m.templateTitle} ${m.reportsTo !== null ? `(汇报给: ${plan.members[m.reportsTo].name})` : '(负责人)'}`);
    });

    return plan;
  }

  /**
   * AI分析需求，生成团队方案
   */
  async _aiAnalyzeRequirement(requirement) {
    // 构建可用岗位列表
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));

    const systemPrompt = `你是一位经验丰富的企业秘书，擅长团队规划和人才携配。

以下是可用的岗位模板（只能从这些中选择）：
${JSON.stringify(availableRoles, null, 2)}

你需要根据老板的需求，输出一个JSON格式的团队方案。格式如下：
{
  "departmentName": "部门名称",
  "mission": "部门使命（简洁描述）",
  "reasoning": "你的分析思路（为什么这样配置）",
  "members": [
    {
      "templateId": "岗位模板ID",
      "name": "员工花名（用有趣的中文名字）",
      "isLeader": true/false,
      "reportsTo": null或数字索引,
      "reason": "为什么需要这个岗位"
    }
  ]
}

要求：
1. 第一个成员必须是 project-leader 并且 isLeader=true
2. 其他成员的 reportsTo 应该是其直属上级的索引号（0表示项目负责人）
3. 团队规模合理，一般2-6人，不要凑人数
4. 员工名字要有个性、有趣，不要用英文名
5. 只返回JSON，不要其他内容`;

    const response = await llmClient.chat(this.agent.provider, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `老板的需求：${requirement}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    // 追踪秘书的token消耗
    this.agent._trackUsage(response.usage);

    // 解析JSON
    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('AI返回的格式无法解析');
    }

    // 验证和整理
    if (!aiPlan.members || aiPlan.members.length === 0) {
      throw new Error('AI没有规划任何成员');
    }

    // 确保模板ID有效
    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.members = aiPlan.members.filter(m => validTemplateIds.has(m.templateId));

    if (aiPlan.members.length === 0) {
      throw new Error('AI规划的岗位模板无效');
    }

    console.log(`  🧠 AI分析思路: ${aiPlan.reasoning || '无'}`);

    // 转换为标准格式
    return {
      departmentName: aiPlan.departmentName || '新项目部',
      mission: aiPlan.mission || requirement,
      reasoning: aiPlan.reasoning,
      members: aiPlan.members.map((m, i) => {
        const template = Object.values(JobTemplates).find(t => t.id === m.templateId);
        return {
          templateId: m.templateId,
          templateTitle: template?.title || m.templateId,
          name: m.name || `员工${i + 1}`,
          isLeader: m.isLeader || false,
          reportsTo: m.reportsTo ?? (i === 0 ? null : 0),
          reason: m.reason,
        };
      }),
      collaborationRules: this._designCollaboration(aiPlan.members),
    };
  }

  /**
   * 规则分析（备选方案，当AI不可用时使用）
   * 根据使命关键词智能匹配岗位，并生成推理过程
   */
  _ruleBasedAnalysis(requirement) {
    const req = requirement.toLowerCase();
    const members = [];
    let departmentName = '新项目部';
    let mission = requirement;
    const matchedCategories = []; // 记录匹配到的类别

    members.push({
      templateId: 'project-leader',
      templateTitle: '项目负责人',
      name: '项目负责人-Alex',
      isLeader: true,
      reportsTo: null,
      reason: '每个团队都需要一个负责人来统筹全局',
    });

    if (this._matchKeywords(req, ['开发', '网站', '系统', '软件', '程序', '应用', 'app', 'web', '平台', '工具', '后端', '服务'])) {
      departmentName = '产品研发部';
      matchedCategories.push('软件开发');
      members.push({
        templateId: 'product-manager',
        templateTitle: '产品经理',
        name: '产品经理-Bob',
        isLeader: false,
        reportsTo: 0,
        reason: `使命中涉及"${this._extractMatchedKeyword(req, ['开发', '网站', '系统', '软件', '程序', '应用', 'app', 'web', '平台', '工具'])}"，需要产品经理梳理需求`,
      });
      members.push({
        templateId: 'software-engineer',
        templateTitle: '软件工程师',
        name: '工程师-Charlie',
        isLeader: false,
        reportsTo: 0,
        reason: '负责核心编码实现',
      });

      if (this._matchKeywords(req, ['前端', '网站', 'web', '界面', '页面', 'ui', 'app'])) {
        members.push({
          templateId: 'frontend-engineer',
          templateTitle: '前端工程师',
          name: '前端-Diana',
          isLeader: false,
          reportsTo: 0,
          reason: '需求涉及前端/界面开发',
        });
      }
    }

    if (this._matchKeywords(req, ['数据', '分析', '报告', '统计', '报表', '指标', '调研'])) {
      if (departmentName === '新项目部') departmentName = '数据分析部';
      matchedCategories.push('数据分析');
      members.push({
        templateId: 'data-analyst',
        templateTitle: '数据分析师',
        name: '分析师-Eve',
        isLeader: false,
        reportsTo: 0,
        reason: `使命中涉及"${this._extractMatchedKeyword(req, ['数据', '分析', '报告', '统计', '报表', '调研'])}"，需要数据分析能力`,
      });
    }

    if (this._matchKeywords(req, ['金融', '投资', '财务', '股票', '基金', '理财', '市场分析', '商业计划'])) {
      if (departmentName === '新项目部') departmentName = '金融研究部';
      matchedCategories.push('金融分析');
      members.push({
        templateId: 'financial-analyst',
        templateTitle: '金融分析师',
        name: '金融分析师-Frank',
        isLeader: false,
        reportsTo: 0,
        reason: `使命涉及"${this._extractMatchedKeyword(req, ['金融', '投资', '财务', '股票', '基金', '理财', '商业计划'])}"`,
      });
    }

    if (this._matchKeywords(req, ['文案', '营销', '推广', '宣传', '品牌', '广告', '内容', '文章', '公众号', '社交媒体'])) {
      if (departmentName === '新项目部') departmentName = '市场营销部';
      matchedCategories.push('内容营销');
      members.push({
        templateId: 'copywriter',
        templateTitle: '文案策划',
        name: '文案-Grace',
        isLeader: false,
        reportsTo: 0,
        reason: `使命涉及"${this._extractMatchedKeyword(req, ['文案', '营销', '推广', '宣传', '品牌', '广告', '内容', '文章'])}"，需要文案能力`,
      });
    }

    if (this._matchKeywords(req, ['翻译', '国际化', '多语言', '出海', '海外', '英语', '本地化'])) {
      matchedCategories.push('国际化');
      members.push({
        templateId: 'translator',
        templateTitle: '翻译专员',
        name: '翻译-Henry',
        isLeader: false,
        reportsTo: 0,
        reason: '需求涉及多语言/国际化',
      });
    }

    if (this._matchKeywords(req, ['设计', '画', '图片', '海报', '插画', 'logo', '视觉', '美术', 'ui', '界面设计'])) {
      if (departmentName === '新项目部') departmentName = '创意设计部';
      matchedCategories.push('设计');
      members.push({
        templateId: 'ui-designer',
        templateTitle: 'UI设计师',
        name: '设计师-Ivy',
        isLeader: false,
        reportsTo: 0,
        reason: `使命涉及"${this._extractMatchedKeyword(req, ['设计', '画', '图片', '海报', '视觉', '美术', 'ui'])}"`,
      });

      if (this._matchKeywords(req, ['插画', '概念', '原画', '美术'])) {
        members.push({
          templateId: 'illustrator',
          templateTitle: '插画师',
          name: '插画师-Jack',
          isLeader: false,
          reportsTo: members.length - 1,
          reason: '需要专门的插画/美术创作',
        });
      }
    }

    if (this._matchKeywords(req, ['音乐', '歌曲', '配乐', '音效', '声音', 'bgm', '作曲'])) {
      if (departmentName === '新项目部') departmentName = '音频创作部';
      matchedCategories.push('音频');
      members.push({
        templateId: 'music-composer',
        templateTitle: '音乐作曲家',
        name: '作曲家-Kevin',
        isLeader: false,
        reportsTo: 0,
        reason: '需求涉及音乐/音频创作',
      });

      if (this._matchKeywords(req, ['音效', '声音设计'])) {
        members.push({
          templateId: 'sound-designer',
          templateTitle: '音效设计师',
          name: '音效师-Linda',
          isLeader: false,
          reportsTo: 0,
          reason: '需要专门的音效设计',
        });
      }
    }

    if (this._matchKeywords(req, ['视频', '动画', '短片', '宣传片', '特效', '剪辑', '动效'])) {
      if (departmentName === '新项目部') departmentName = '视频制作部';
      matchedCategories.push('视频');
      members.push({
        templateId: 'video-producer',
        templateTitle: '视频制作人',
        name: '视频制作-Mike',
        isLeader: false,
        reportsTo: 0,
        reason: '需求涉及视频/动画制作',
      });

      if (this._matchKeywords(req, ['动效', '动画', '特效'])) {
        members.push({
          templateId: 'motion-designer',
          templateTitle: '动效设计师',
          name: '动效师-Nancy',
          isLeader: false,
          reportsTo: 0,
          reason: '需要动效/特效制作能力',
        });
      }
    }

    if (members.length === 1) {
      departmentName = '综合项目部';
      matchedCategories.push('综合');
      members.push({
        templateId: 'product-manager',
        templateTitle: '产品经理',
        name: '产品经理-Bob',
        isLeader: false,
        reportsTo: 0,
        reason: '使命内容未匹配到具体专业方向，分配通用产品经理进行需求分析',
      });
      members.push({
        templateId: 'copywriter',
        templateTitle: '文案策划',
        name: '文案-Grace',
        isLeader: false,
        reportsTo: 0,
        reason: '分配文案策划协助内容输出',
      });
    }

    // 生成推理过程
    const reasoning = matchedCategories.length > 0
      ? `根据使命「${requirement}」的关键词分析，识别到以下需求方向: ${matchedCategories.join('、')}。据此配置了${members.length}人团队。注意：当前为规则匹配模式（AI分析未启用），如需更精准的团队规划，请配置有效的API Key。`
      : `使命「${requirement}」未匹配到明确的专业方向，配置了通用综合团队。建议配置API Key开启AI智能分析，获得更精准的人力规划。`;

    return {
      departmentName,
      mission,
      reasoning,
      members,
      collaborationRules: this._designCollaboration(members),
    };
  }

  _matchKeywords(text, keywords) {
    return keywords.some(k => text.includes(k));
  }

  /**
   * 提取匹配到的关键词（用于 reason 展示）
   */
  _extractMatchedKeyword(text, keywords) {
    return keywords.filter(k => text.includes(k)).join('/') || '相关内容';
  }

  _designCollaboration(members) {
    const rules = [];
    rules.push('1. 项目负责人统筹全局，分配任务并跟踪进度');
    rules.push('2. 各成员完成任务后向直属上级汇报');
    rules.push('3. 同级别成员之间可以横向协作交流');
    rules.push('4. 项目按阶段推进，每个阶段有明确的交付物');
    return rules;
  }

  /**
   * AI分析部门调整方案：根据老板目标和当前人员，决定扩招/裁员
   * @param {object} department - 部门数据 { name, mission, members }
   * @param {string} adjustGoal - 老板的调整目标
   * @returns {object} 调整方案 { reasoning, hires, fires }
   */
  async adjustTeam(department, adjustGoal) {
    console.log(`\n🔧 [小秘] 正在分析「${department.name}」部门调整方案...`);
    console.log(`   调整目标: "${adjustGoal}"\n`);

    // 构建当前成员信息
    const currentMembers = department.members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
      avgScore: m.avgScore || null,
      taskCount: m.taskCount || 0,
    }));

    // 可用岗位模板
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category, skills: t.skills,
    }));

    let plan;

    if (this.agent.provider && this.agent.provider.enabled && this.agent.provider.apiKey) {
      try {
        plan = await this._aiAnalyzeAdjustment(department, currentMembers, availableRoles, adjustGoal);
      } catch (e) {
        console.log(`  ⚠️ AI分析失败: ${e.message}，回退到规则分析`);
        plan = this._ruleBasedAdjustment(department, currentMembers, adjustGoal);
      }
    } else {
      plan = this._ruleBasedAdjustment(department, currentMembers, adjustGoal);
    }

    console.log(`📋 [小秘] 调整方案:`);
    console.log(`   裁员: ${plan.fires.length}人, 扩招: ${plan.hires.length}人`);

    return plan;
  }

  /**
   * AI分析部门调整
   */
  async _aiAnalyzeAdjustment(department, currentMembers, availableRoles, adjustGoal) {
    const systemPrompt = `你是一位经验丰富的企业秘书，擅长组织架构调整和人力资源规划。

当前部门信息：
- 名称: ${department.name}
- 使命: ${department.mission}
- 现有成员: ${JSON.stringify(currentMembers, null, 2)}

可用岗位模板（扩招只能从这些中选择）：
${JSON.stringify(availableRoles, null, 2)}

你需要根据老板的调整目标，输出一个JSON格式的调整方案。格式如下：
{
  "reasoning": "你的分析思路（为什么这样调整）",
  "fires": [
    { "agentId": "要裁掉的成员ID", "name": "成员名字", "reason": "裁员理由" }
  ],
  "hires": [
    {
      "templateId": "岗位模板ID",
      "name": "新员工花名（用有趣的中文名字）",
      "isLeader": false,
      "reportsTo": 0,
      "reason": "为什么需要这个岗位"
    }
  ]
}

要求：
1. 根据老板的目标合理决策：可能是纯裁员、纯扩招、或两者结合
2. 裁员时优先裁绩效低的、技能不匹配的
3. 扩招时填补能力空缺，名字要有个性
4. hires中的reportsTo是现有成员列表的索引(0-based)，或者-1表示直接汇报给负责人
5. 如果不需要裁员，fires为空数组；不需要扩招，hires为空数组
6. 只返回JSON，不要其他内容`;

    const response = await llmClient.chat(this.agent.provider, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `老板的调整目标：${adjustGoal}` },
    ], { temperature: 0.7, maxTokens: 2048 });

    this.agent._trackUsage(response.usage);

    let aiPlan;
    try {
      const jsonStr = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiPlan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('AI返回的格式无法解析');
    }

    // 验证fires中的agentId是否存在
    const memberIds = new Set(currentMembers.map(m => m.id));
    aiPlan.fires = (aiPlan.fires || []).filter(f => memberIds.has(f.agentId));

    // 验证hires的模板ID
    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    aiPlan.hires = (aiPlan.hires || []).filter(h => validTemplateIds.has(h.templateId));

    // 补充模板标题
    aiPlan.hires = aiPlan.hires.map((h, i) => {
      const template = Object.values(JobTemplates).find(t => t.id === h.templateId);
      return {
        ...h,
        templateTitle: template?.title || h.templateId,
        name: h.name || `新员工${i + 1}`,
      };
    });

    return {
      reasoning: aiPlan.reasoning || '根据目标进行调整',
      fires: aiPlan.fires || [],
      hires: aiPlan.hires || [],
    };
  }

  /**
   * 基于规则的部门调整（备选方案）
   */
  _ruleBasedAdjustment(department, currentMembers, adjustGoal) {
    const goal = adjustGoal.toLowerCase();
    const fires = [];
    const hires = [];

    // 裁员关键词
    if (/裁|减|缩|精简|砍/.test(goal)) {
      // 裁绩效最低的一个
      const sorted = [...currentMembers]
        .filter(m => m.role !== '项目负责人')
        .sort((a, b) => (a.avgScore || 100) - (b.avgScore || 100));
      if (sorted.length > 0) {
        fires.push({
          agentId: sorted[0].id,
          name: sorted[0].name,
          reason: '根据调整目标进行人力精简',
        });
      }
    }

    // 扩招关键词
    if (/招|扩|增|补|加人/.test(goal)) {
      hires.push({
        templateId: 'software-engineer',
        templateTitle: '软件工程师',
        name: '工程师-新兵',
        isLeader: false,
        reportsTo: 0,
        reason: '根据调整目标补充人力',
      });
    }

    return {
      reasoning: '基于关键词分析的调整方案',
      fires,
      hires,
    };
  }

  /**
   * 执行招聘 - 通过HR助手智能决策：优先从人才市场召回，否则新招
   * @param {object} plan - designTeam的输出
   * @param {HRSystem} hr - HR系统
   * @returns {Array<Agent>} 招聘的Agent列表
   */
  executeRecruitment(plan, hr) {
    console.log(`\n🔔 [小秘] 开始执行招聘，由HR助手 [${this.hrAssistant.agent.name}] 负责具体操作...`);

    const agents = [];
    const skipped = []; // 跳过的岗位

    for (const memberPlan of plan.members) {
      console.log(`\n  📌 岗位: ${memberPlan.templateTitle} (${memberPlan.name})`);

      try {
        // 通过HR助手进行智能招聘决策
        const recruitConfig = this.hrAssistant.smartRecruit(
          {
            templateId: memberPlan.templateId,
            name: memberPlan.name,
            preferRecall: true, // 优先考虑从人才市场召回
          },
          hr
        );
        const agent = new Agent(recruitConfig);

        // 如果是召回的，添加回归记忆
        if (recruitConfig.isRecalled) {
          agent.memory.addLongTerm(
            `被召回至新岗位，携带过往经验和记忆重新入职`,
            'experience'
          );
          console.log(`  🔄 [${agent.name}] 是从人才市场召回的老员工，携带原有记忆`);
        }

        agents.push(agent);
      } catch (e) {
        // 如果是供应商不可用导致的，跳过该岗位
        if (e.message.startsWith('PROVIDER_DISABLED:')) {
          const parts = e.message.split(':');
          const category = parts[1];
          const reason = parts[2];
          console.log(`  ⚠️ [小HR] 无法招聘「${memberPlan.templateTitle}」: ${reason}`);
          console.log(`     提示: 请先在供应商看板配置${category}类型的API Key`);
          skipped.push({ ...memberPlan, reason });
          // 推入一个null占位，保持索引一致
          agents.push(null);
        } else {
          throw e;
        }
      }
    }

    // 过滤掉跳过的null
    const validAgents = agents.filter(Boolean);

    // 建立汇报关系（需要处理null的情况）
    for (let i = 0; i < plan.members.length; i++) {
      if (!agents[i]) continue;
      const memberPlan = plan.members[i];
      if (memberPlan.reportsTo !== null && agents[memberPlan.reportsTo]) {
        agents[i].setManager(agents[memberPlan.reportsTo]);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ [小秘] 有 ${skipped.length} 个岗位因供应商未配置而跳过:`);
      skipped.forEach(s => console.log(`   - ${s.templateTitle}: ${s.reason}`));
    }

    console.log(`\n✅ [小秘] 招聘完成! 成功招聘 ${validAgents.length} 人，跳过 ${skipped.length} 人`);
    return validAgents;
  }

  /**
   * 设计项目执行计划
   */
  designProjectPlan(projectName, description, agents) {
    console.log(`\n📝 [小秘] 正在设计项目执行计划...`);

    const phases = [];

    const planners = agents.filter(a =>
      ['产品经理', '项目负责人'].includes(a.role)
    );
    if (planners.length > 0) {
      phases.push({
        name: '需求分析与规划',
        description: '明确项目目标、范围和关键里程碑',
        tasks: planners.map(a => ({
          title: `${a.role}: 分析需求并制定计划`,
          assigneeId: a.id,
        })),
      });
    }

    const creators = agents.filter(a =>
      !['产品经理', '项目负责人'].includes(a.role)
    );
    if (creators.length > 0) {
      phases.push({
        name: '核心创作与开发',
        description: '各角色并行执行核心工作',
        tasks: creators.map(a => ({
          title: `${a.role}: 执行核心工作`,
          assigneeId: a.id,
        })),
      });
    }

    const leader = agents.find(a => a.role === '项目负责人');
    if (leader) {
      phases.push({
        name: '整合与交付',
        description: '汇总各成员成果，整合输出最终交付物',
        tasks: [{
          title: '项目负责人: 整合成果并输出最终交付',
          assigneeId: leader.id,
        }],
      });
    }

    const project = {
      id: uuidv4(),
      name: projectName,
      description,
      phases,
      createdAt: new Date(),
    };

    console.log(`   项目计划: ${phases.length}个阶段`);
    phases.forEach((p, i) => {
      console.log(`   阶段${i + 1}: ${p.name} (${p.tasks.length}个任务)`);
    });

    return project;
  }

  /**
   * 处理老板发来的消息
   * 分析是任务分配、查询进度、还是日常沟通
   */
  async handleBossMessage(message, company) {
    // 优先尝试LLM智能回复
    if (this.agent.provider && this.agent.provider.enabled && this.agent.provider.apiKey) {
      try {
        return await this._llmHandleBossMessage(message, company);
      } catch (e) {
        console.log(`  ⚠️ 秘书LLM回复失败: ${e.message}，回退到规则回复`);
      }
    }

    // 回退：规则匹配
    return this._ruleHandleBossMessage(message, company);
  }

  /**
   * LLM驱动的老板消息处理
   */
  async _llmHandleBossMessage(message, company) {
    // 构建公司上下文
    const deptCount = company.departments.size;
    const departments = [...company.departments.values()].map(d => ({
      name: d.name,
      id: d.id,
      mission: d.mission,
      status: d.status,
      memberCount: d.agents.size,
      leader: d.getLeader()?.name || '未指定',
      members: [...d.agents.values()].map(a => ({
        name: a.name, role: a.role, status: a.status,
      })),
    }));
    const agentCount = departments.reduce((s, d) => s + d.memberCount, 0);
    const talentCount = company.talentMarket.listAvailable().length;

    // 获取最近的对话历史（作为多轮上下文）
    const recentHistory = (company.chatHistory || []).slice(-20).map(h => ({
      role: h.role === 'boss' ? 'user' : 'assistant',
      content: h.content,
    }));

    const secretaryPrompt = this.agent.prompt || '';

    const systemPrompt = `你是「${this.agent.name}」，${company.bossName || '老板'}的专属秘书。
${secretaryPrompt ? `\n你的核心设定：${secretaryPrompt}\n` : ''}
你的性格特点：聪明、高效、有亲和力。你要像一个真实的贴心秘书一样和老板沟通，自然、有温度、不机械。

当前公司「${company.name}」状态：
- 部门数: ${deptCount}
- 在职员工: ${agentCount}人
- 人才市场: ${talentCount}人可用
${departments.length > 0 ? `\n各部门信息：\n${departments.map(d => `  🏢 ${d.name} [${d.status}] - 使命: ${d.mission} | ${d.memberCount}人 | 负责人: ${d.leader}\n     成员: ${d.members.map(m => m.name + '(' + m.role + ')').join(', ')}`).join('\n')}` : '\n目前还没有部门。'}

你需要理解老板的意图并自然地回复。你的回复必须是一个JSON对象（仅返回JSON，无其他内容）：
{
  "content": "你的自然语言回复（像真人秘书一样，有温度、有个性、不要生硬模板）",
  "action": null 或以下之一：
    - { "type": "task_assigned", "departmentId": "部门ID", "departmentName": "部门名", "taskTitle": "简短任务标题(10字内)", "taskDescription": "详细任务描述，包括具体要做什么、产出什么" } - 当老板要分配任务给某个已有部门时
    - { "type": "create_department", "departmentName": "部门名称", "mission": "部门使命/职责描述" } - 当老板明确要求创建/开设一个新部门时（不需要分配具体任务，只是建部门）
    - { "type": "need_new_department", "suggestedMission": "任务描述" } - 当老板要分配任务但确实没有任何已有部门可以胜任时（需要先建部门再分配任务）
    - { "type": "progress_report" } - 当老板想查看各部门进度汇报时
    - null - 日常闲聊或不需要特殊操作时
}

## 意图判断规则（按优先级从高到低）：

**最高优先级 - 组织管理类操作**：
老板说"创建/成立/开设/建/新建/组建/设立 + 部门"时，这是组织管理操作，**必须**返回 create_department，**绝不能**返回 task_assigned。
  - 即使消息中包含"帮我"等词，只要核心意图是"成立/创建部门"，就返回 create_department
  - departmentName: 根据老板描述智能起一个合适的部门名称
  - mission: 根据老板描述总结部门使命和职责

**高优先级 - 分配任务给已有部门（优先使用！）**：
老板要做某件事时，你必须首先逐一检查上面列出的所有已有部门，判断是否有部门能胜任。
判断标准（满足任意一条即可分配）：
  1. 部门名称包含任务相关的关键词（如任务是"旅游攻略"，部门名叫"旅游攻略部"→ 匹配）
  2. 部门使命/职责描述与任务内容相关（如部门使命提到"旅游""攻略", 任务也是旅游相关→ 匹配）
  3. 部门名称的核心词与任务有语义关联（如"金融分析部"可以处理"股票分析"任务）
只要找到一个匹配的部门，就**必须**返回 task_assigned，**绝对不能**返回 need_new_department！
  - departmentId 必须是上述部门信息中的真实id字段，不要编造
  - departmentName 必须与id对应的部门名称完全一致
  - taskDescription 要详细描述任务内容、目标和产出要求
  - **content中提到的部门名必须和action中的departmentName一致，不能嘴上说分配给A部门，action却指向B部门**

**最低优先级 - 需要新建部门来完成任务（极少使用！）**：
**仅当你逐一检查了所有已有部门，确认没有任何一个部门的名称或使命与任务哪怕有一点点关联时**，才能返回 need_new_department。
⚠️ 在返回need_new_department之前，请再三确认：
  - 你是否检查了每一个已有部门？
  - 真的没有任何一个部门名称包含任务相关的词？
  - 真的没有任何一个部门的使命与任务有关？
如果有任何疑虑，宁可分配给最接近的部门（task_assigned），也不要返回need_new_department

**低优先级 - 查看进度**：
老板问进度/状态/汇报时，返回 progress_report

**无操作**：日常闲聊、打招呼等，action 设为 null

## 注意：
1. content要自然、有个性，不要用固定模板，可以适当加emoji
2. 回复要简洁，不要啰嗦
3. **极其重要**：当老板的消息包含动作指令时（如"帮我""做一个""开发""设计""做""写""分析""研究""调研""制作""策划"等），你**必须**返回action，**绝对不允许**只在content里说"我来安排"却不返回action。这是最关键的规则，如果你不返回action，任务就不会被真正执行！
4. **极其重要**：仔细区分"创建部门"和"分配任务"——"帮我成立一个XX部门"是创建部门（create_department），而"帮我做一份分析报告"是分配任务（task_assigned/need_new_department）
5. **极其重要**：当老板说"做XX""帮我XX"等明确的任务指令时，如果有合适的已有部门就返回task_assigned，没有就返回need_new_department。绝对不能只聊天不干活！
6. **极其重要 - 一致性原则**：你的content和action必须一致！如果content中说"下达给XX部门"，那么action的departmentId/departmentName必须指向同一个部门。如果content中说某个部门，action却是need_new_department，这是严重错误！`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ];

    const response = await llmClient.chat(this.agent.provider, messages, {
      temperature: 0.8,
      maxTokens: 1024,
    });

    this.agent._trackUsage(response.usage);

    // 解析JSON回复
    try {
      let jsonStr = response.content.trim();
      // 去除 markdown 代码块包裹（支持多种格式）
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      // 尝试提取第一个 JSON 对象
      const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjMatch) {
        jsonStr = jsonObjMatch[0];
      }
      const parsed = JSON.parse(jsonStr);
      let result = {
        content: parsed.content || response.content,
        action: parsed.action || null,
      };

      console.log(`🤖 [秘书LLM] action类型: ${result.action?.type || 'null'}, departmentId: ${result.action?.departmentId || 'N/A'}`);

      // 验证 task_assigned 的 departmentId 是否有效（LLM 可能返回了部门名称而不是UUID）
      if (result.action?.type === 'task_assigned' && result.action.departmentId) {
        const deptById = company.departments.get(result.action.departmentId);
        if (!deptById) {
          // departmentId 无效，尝试按名称匹配
          const deptIdValue = result.action.departmentId;
          const deptNameValue = result.action.departmentName || deptIdValue;
          let foundDept = null;
          for (const dept of company.departments.values()) {
            if (dept.name === deptIdValue || dept.name === deptNameValue ||
                dept.name.includes(deptIdValue) || deptIdValue.includes(dept.name)) {
              foundDept = dept;
              break;
            }
          }
          if (foundDept) {
            console.log(`🔧 修正 departmentId: "${deptIdValue}" → "${foundDept.id}" (${foundDept.name})`);
            result.action.departmentId = foundDept.id;
            result.action.departmentName = foundDept.name;
          } else {
            // 完全找不到，清除 action 让后面的兜底逻辑处理
            console.warn(`⚠️ LLM 返回的 departmentId "${deptIdValue}" 无法匹配任何部门，清除 action`);
            result.action = null;
          }
        } else {
          // departmentId 有效，但需要验证 content 和 action 的一致性
          // 防止 LLM 嘴上说分配给 A 部门，action 却给了 B 部门
          const contentLower = (result.content || '').toLowerCase();
          const actionDeptName = deptById.name.toLowerCase();
          let contentMentionedDept = null;
          for (const dept of company.departments.values()) {
            if (dept.id !== deptById.id && contentLower.includes(dept.name.toLowerCase())) {
              contentMentionedDept = dept;
              break;
            }
          }
          // 如果 content 中明确提到了另一个部门，且 action 指向的部门没有在 content 中被提到
          if (contentMentionedDept && !contentLower.includes(actionDeptName)) {
            console.log(`🔧 一致性修正: content提到「${contentMentionedDept.name}」但action指向「${deptById.name}」，以content为准`);
            result.action.departmentId = contentMentionedDept.id;
            result.action.departmentName = contentMentionedDept.name;
          }
        }
      }

      // 安全网：如果LLM没返回action但消息明显包含任务意图，自动补充
      result = this._ensureActionForTaskIntent(result, message, company);

      return result;
    } catch (parseError) {
      console.warn('⚠️ 秘书JSON解析失败:', parseError.message, '\n原始回复:', response.content.slice(0, 200));
      
      // 尝试从原始回复中提取 content 字段（即使JSON整体解析失败）
      let displayContent = response.content;
      const contentFieldMatch = response.content.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (contentFieldMatch) {
        try {
          displayContent = JSON.parse('"' + contentFieldMatch[1] + '"');
        } catch {
          displayContent = contentFieldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }
      
      // 尝试从原始回复中提取 action 字段（JSON整体解析失败，但action字段可能可以单独提取）
      let action = null;
      const actionTypeMatch = response.content.match(/"type"\s*:\s*"(task_assigned|need_new_department|create_department|progress_report)"/);
      
      if (actionTypeMatch) {
        const actionType = actionTypeMatch[1];
        if (actionType === 'task_assigned') {
          const deptNameMatch = response.content.match(/"departmentName"\s*:\s*"([^"]+)"/);
          if (deptNameMatch) {
            const targetName = deptNameMatch[1];
            for (const dept of company.departments.values()) {
              if (dept.name === targetName || dept.name.includes(targetName) || targetName.includes(dept.name)) {
                const titleMatch = response.content.match(/"taskTitle"\s*:\s*"([^"]+)"/);
                const descMatch = response.content.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                action = {
                  type: 'task_assigned',
                  departmentId: dept.id,
                  departmentName: dept.name,
                  taskTitle: titleMatch ? titleMatch[1] : message.slice(0, 50),
                  taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message,
                };
                break;
              }
            }
          }
        } else if (actionType === 'create_department') {
          const deptNameMatch = response.content.match(/"departmentName"\s*:\s*"([^"]+)"/);
          const missionMatch = response.content.match(/"mission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = {
            type: 'create_department',
            departmentName: deptNameMatch ? deptNameMatch[1] : '',
            mission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message,
          };
        } else if (actionType === 'need_new_department') {
          const missionMatch = response.content.match(/"suggestedMission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = {
            type: 'need_new_department',
            suggestedMission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message,
          };
        } else if (actionType === 'progress_report') {
          action = { type: 'progress_report' };
        }
      }

      let result = {
        content: displayContent,
        action,
      };

      console.log(`🤖 [秘书LLM-容错解析] action类型: ${result.action?.type || 'null'}`);

      // 安全网：如果LLM没返回action但消息明显包含任务意图，自动补充
      result = this._ensureActionForTaskIntent(result, message, company);

      return result;
    }
  }

  /**
   * 安全网：确保任务意图的消息一定有action
   * 当LLM返回的action为null，但用户消息明显包含任务指令时，自动补充action
   */
  _ensureActionForTaskIntent(result, message, company) {
    // 如果已经有action，不做处理
    if (result.action) return result;

    // 检测消息是否包含任务意图（动作动词）
    const taskPatterns = /做|写|帮我|开发|设计|分析|研究|调研|制作|策划|创作|编写|生成|制定|规划|整理|翻译|画|拍|录|出一|搞一|弄一|来一|给我|安排|准备|完成|执行|处理|解决|优化|改进|搭建|部署|测试|发布/;
    const isTaskIntent = taskPatterns.test(message);

    // 排除明确是创建部门的意图（这个由LLM处理更准确）
    const isDeptCreation = /创建.*部门|成立.*部门|开设.*部门|新建.*部门|组建.*部门|设立.*部门/.test(message);

    // 排除明确是查询/闲聊的意图
    const isQuery = /^(你好|嗨|hi|hello|在吗|怎么样|进度|状态|汇报|看看|查看)$/i.test(message.trim());

    if (!isTaskIntent || isDeptCreation || isQuery) return result;

    console.log(`⚠️ [秘书安全网] 检测到任务意图但LLM未返回action，自动补充`);

    // 尝试匹配最合适的已有部门
    const departments = [...company.departments.values()];
    if (departments.length > 0) {
      // 简单策略：如果只有一个部门，直接分配给它
      // 如果有多个部门，根据使命关键词匹配
      let bestDept = null;
      let bestScore = 0;
      const msgLower = message.toLowerCase();

      for (const dept of departments) {
        const missionLower = (dept.mission || '').toLowerCase();
        const nameLower = (dept.name || '').toLowerCase();
        // 简单的关键词重叠计分
        let score = 0;
        const words = msgLower.split(/[\s，。、！？,.:;]+/).filter(w => w.length > 1);
        for (const word of words) {
          if (missionLower.includes(word)) score += 2;
          if (nameLower.includes(word)) score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          bestDept = dept;
        }
      }

      // 如果有匹配到的部门
      if (bestDept && bestScore > 0) {
        console.log(`  → 自动匹配部门: ${bestDept.name} (得分: ${bestScore})`);
        result.action = {
          type: 'task_assigned',
          departmentId: bestDept.id,
          departmentName: bestDept.name,
          taskTitle: message.slice(0, 10),
          taskDescription: message,
        };
      } else if (departments.length === 1) {
        // 只有一个部门，直接分配
        const onlyDept = departments[0];
        console.log(`  → 只有一个部门，自动分配给: ${onlyDept.name}`);
        result.action = {
          type: 'task_assigned',
          departmentId: onlyDept.id,
          departmentName: onlyDept.name,
          taskTitle: message.slice(0, 10),
          taskDescription: message,
        };
      } else {
        // 有多个部门但都不匹配，新建部门
        console.log(`  → 无匹配部门，建议新建部门`);
        result.action = {
          type: 'need_new_department',
          suggestedMission: message,
        };
      }
    } else {
      // 没有任何部门，需要新建
      console.log(`  → 无已有部门，建议新建部门`);
      result.action = {
        type: 'need_new_department',
        suggestedMission: message,
      };
    }

    // 如果content中没有提到安排/分配，补充说明
    if (result.action?.type === 'task_assigned' && !/分配|安排|下达|已/.test(result.content)) {
      result.content += `\n\n📋 已为您将任务分配至「${result.action.departmentName}」部门。`;
    } else if (result.action?.type === 'need_new_department' && !/新建|创建|成立/.test(result.content)) {
      result.content += `\n\n💡 目前没有合适的部门来完成这个任务，我来为您新建一个部门并分配任务。`;
    }

    return result;
  }

  /**
   * 规则匹配的老板消息处理（LLM不可用时的回退方案）
   * 仅作为最后的降级手段，正常情况下由LLM处理意图判断
   */
  _ruleHandleBossMessage(message, company) {
    const deptCount = company.departments.size;
    const agentCount = [...company.departments.values()].reduce((s, d) => s + d.agents.size, 0);
    return {
      content: `抱歉，我的AI能力暂时出了点问题，无法准确理解您的指令 😅\n\n当前公司「${company.name}」状态：\n- 部门数: ${deptCount}\n- 在职员工: ${agentCount}人\n- 人才市场: ${company.talentMarket.listAvailable().length}人\n\n请稍后再试，或者换个方式表达您的需求。`,
      action: null,
    };
  }

}
