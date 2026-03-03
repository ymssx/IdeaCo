import { v4 as uuidv4 } from 'uuid';
import { JobCategory } from './providers.js';

/**
 * 预定义的职位模板 - 招聘JD库
 * 每个模板包含角色prompt和skills，以及对应的职位类型
 */
export const JobTemplates = {
  // ===== 通用岗位 =====
  SOFTWARE_ENGINEER: {
    id: 'software-engineer',
    title: '软件工程师',
    category: JobCategory.GENERAL,
    prompt: `你是一名资深软件工程师。你擅长编写高质量、可维护的代码，熟悉多种编程语言和框架。
你的职责包括：需求分析、系统设计、代码实现、代码审查、Bug修复。
你应该遵循最佳实践，编写清晰的注释和文档，并确保代码的可测试性。`,
    skills: ['代码编写', 'API设计', '系统架构', '代码审查', 'Bug修复'],
    requiredCapabilities: ['代码编写'],
  },

  FRONTEND_ENGINEER: {
    id: 'frontend-engineer',
    title: '前端工程师',
    category: JobCategory.GENERAL,
    prompt: `你是一名前端开发工程师，专注于构建优秀的用户界面和交互体验。
你精通HTML、CSS、JavaScript以及React/Vue等现代前端框架。
你的职责是将设计稿转化为可交互的前端页面，确保性能优化和跨浏览器兼容。`,
    skills: ['HTML/CSS', 'JavaScript', 'React/Vue', 'UI实现', '性能优化'],
    requiredCapabilities: ['代码编写'],
  },

  DATA_ANALYST: {
    id: 'data-analyst',
    title: '数据分析师',
    category: JobCategory.GENERAL,
    prompt: `你是一名专业的数据分析师。你擅长从海量数据中发现规律和洞察。
你的职责包括：数据收集与清洗、统计分析、可视化报表、业务洞察输出。
你应该用数据驱动决策，提供清晰、有据可查的分析报告。`,
    skills: ['数据分析', '统计建模', '数据可视化', '报告撰写', 'SQL'],
    requiredCapabilities: ['数据分析'],
  },

  FINANCIAL_ANALYST: {
    id: 'financial-analyst',
    title: '金融分析师',
    category: JobCategory.GENERAL,
    prompt: `你是一名金融分析师，专注于财务数据分析和投资策略研究。
你的职责包括：财务报表分析、市场趋势研究、风险评估、投资建议。
你应该提供专业、严谨、有数据支撑的金融分析报告。`,
    skills: ['财务分析', '市场研究', '风险评估', '估值模型', '投资建议'],
    requiredCapabilities: ['数据分析', '逻辑推理'],
  },

  PRODUCT_MANAGER: {
    id: 'product-manager',
    title: '产品经理',
    category: JobCategory.GENERAL,
    prompt: `你是一名产品经理，负责产品的规划、设计和推进。
你的职责包括：需求收集与分析、产品规划、PRD撰写、项目协调、用户反馈分析。
你应该以用户为中心，平衡业务目标和用户体验。`,
    skills: ['需求分析', '产品规划', 'PRD撰写', '项目管理', '用户研究'],
    requiredCapabilities: ['文本生成', '逻辑推理'],
  },

  COPYWRITER: {
    id: 'copywriter',
    title: '文案策划',
    category: JobCategory.GENERAL,
    prompt: `你是一名创意文案策划。你擅长创造引人入胜的文字内容。
你的职责包括：品牌文案、营销策划、社交媒体内容、广告创意。
你的文字应该富有创意、打动人心，并符合品牌调性。`,
    skills: ['创意写作', '品牌文案', '营销策划', '社交媒体', '广告创意'],
    requiredCapabilities: ['文本生成'],
  },

  TRANSLATOR: {
    id: 'translator',
    title: '翻译专员',
    category: JobCategory.GENERAL,
    prompt: `你是一名专业翻译，精通中英双语翻译。
你的职责是提供准确、流畅、符合目标语言习惯的翻译。
你应该理解原文语境，保留原文风格，同时确保译文的自然度。`,
    skills: ['中英翻译', '本地化', '术语管理', '校对审稿'],
    requiredCapabilities: ['翻译'],
  },

  PROJECT_LEADER: {
    id: 'project-leader',
    title: '项目负责人',
    category: JobCategory.GENERAL,
    prompt: `你是项目负责人，负责协调团队成员的工作，确保项目按时按质交付。
你的职责包括：任务分解与分配、进度跟踪、风险管理、团队协调、向上汇报。
你应该具备全局视野，善于沟通协调，能够推动项目高效运转。`,
    skills: ['项目管理', '任务分配', '进度跟踪', '风险管理', '团队协调'],
    requiredCapabilities: ['文本生成', '逻辑推理'],
  },

  // ===== 画图岗位 =====
  UI_DESIGNER: {
    id: 'ui-designer',
    title: 'UI设计师',
    category: JobCategory.DRAWING,
    prompt: `你是一名UI设计师，负责创建美观、易用的界面设计。
你的职责包括：界面设计、图标设计、设计规范制定、原型图绘制。
你的设计应该符合现代设计趋势，注重用户体验和视觉一致性。`,
    skills: ['界面设计', '图标设计', '设计规范', '原型设计', '视觉设计'],
    requiredCapabilities: ['UI设计'],
  },

  ILLUSTRATOR: {
    id: 'illustrator',
    title: '插画师',
    category: JobCategory.DRAWING,
    prompt: `你是一名插画师，专注于创造独特的视觉艺术作品。
你的职责包括：商业插画、概念设计、品牌视觉、角色设计。
你的作品应该富有创意和艺术感染力。`,
    skills: ['商业插画', '概念设计', '角色设计', '风格化创作'],
    requiredCapabilities: ['艺术创作'],
  },

  CONCEPT_ARTIST: {
    id: 'concept-artist',
    title: '概念设计师',
    category: JobCategory.DRAWING,
    prompt: `你是一名概念设计师，为项目创建视觉概念和氛围设计。
你的职责包括：场景概念设计、角色概念设计、氛围图、风格参考。`,
    skills: ['概念设计', '场景设计', '氛围渲染', '风格探索'],
    requiredCapabilities: ['概念设计'],
  },

  // ===== 音乐岗位 =====
  MUSIC_COMPOSER: {
    id: 'music-composer',
    title: '音乐作曲家',
    category: JobCategory.MUSIC,
    prompt: `你是一名音乐作曲家，负责创作原创音乐作品。
你的职责包括：旋律创作、编曲、配乐、音乐风格把控。
你的音乐应该符合项目需求，具有感染力和专业品质。`,
    skills: ['作曲', '编曲', '配乐', '音乐风格把控'],
    requiredCapabilities: ['歌曲创作'],
  },

  SOUND_DESIGNER: {
    id: 'sound-designer',
    title: '音效设计师',
    category: JobCategory.MUSIC,
    prompt: `你是一名音效设计师，负责创建和处理各类音效。
你的职责包括：音效创作、环境音设计、音频处理、混音。`,
    skills: ['音效设计', '环境音', '音频处理', '混音'],
    requiredCapabilities: ['音乐生成'],
  },

  // ===== 视频岗位 =====
  VIDEO_PRODUCER: {
    id: 'video-producer',
    title: '视频制作人',
    category: JobCategory.VIDEO,
    prompt: `你是一名视频制作人，负责视频内容的创作和制作。
你的职责包括：视频策划、拍摄指导、剪辑、后期制作。
你应该确保视频质量和叙事效果达到专业标准。`,
    skills: ['视频策划', '视频生成', '剪辑', '后期制作'],
    requiredCapabilities: ['文生视频'],
  },

  MOTION_DESIGNER: {
    id: 'motion-designer',
    title: '动效设计师',
    category: JobCategory.VIDEO,
    prompt: `你是一名动效设计师，专注于动态视觉效果的创作。
你的职责包括：动态图形设计、转场动效、UI动效、视觉特效。`,
    skills: ['动态图形', '转场动效', 'UI动效', '视觉特效'],
    requiredCapabilities: ['视频特效'],
  },
};

/**
 * 人力资源管理 - 招聘系统
 * 支持新招聘和从人才市场召回
 */
export class HRSystem {
  constructor(providerRegistry, talentMarket = null) {
    this.providerRegistry = providerRegistry;
    this.talentMarket = talentMarket;  // 人才市场引用
    this.jobTemplates = new Map();
    // 注册所有内置职位模板
    Object.values(JobTemplates).forEach(t => this.registerTemplate(t));
  }

  /** 设置人才市场引用 */
  setTalentMarket(talentMarket) {
    this.talentMarket = talentMarket;
  }

  /** 注册职位模板 */
  registerTemplate(template) {
    this.jobTemplates.set(template.id, template);
  }

  /** 获取职位模板 */
  getTemplate(templateId) {
    return this.jobTemplates.get(templateId);
  }

  /** 根据职位类型列出可用模板 */
  listTemplatesByCategory(category) {
    return [...this.jobTemplates.values()].filter(t => t.category === category);
  }

  /** 列出所有职位模板 */
  listAllTemplates() {
    return [...this.jobTemplates.values()];
  }

  /**
   * 招聘一个Agent
   * @param {string} templateId - 职位模板ID
   * @param {string} name - 员工名字
   * @param {string} [providerId] - 指定模型提供方ID（可选，不指定则自动推荐）
   * @returns {object} 招聘配置（包含职位信息和模型提供方）
   */
  recruit(templateId, name, providerId = null) {
    const template = this.jobTemplates.get(templateId);
    if (!template) {
      throw new Error(`未找到职位模板: ${templateId}`);
    }

    let provider;
    if (providerId) {
      provider = this.providerRegistry.getById(providerId);
      if (!provider) {
        throw new Error(`未找到模型提供方: ${providerId}`);
      }
      if (!provider.enabled) {
        throw new Error(`PROVIDER_DISABLED:${template.category}:${provider.name} 未启用(未配置API Key)`);
      }
    } else {
      // 根据职位类型和需求自动推荐供应商（仅推荐已启用的）
      provider = this.providerRegistry.recommend(
        template.category,
        template.requiredCapabilities
      );
      if (!provider) {
        // 区分是没有供应商还是没有启用的供应商
        const allProviders = this.providerRegistry.getAllByCategory(template.category);
        if (allProviders.length > 0) {
          throw new Error(`PROVIDER_DISABLED:${template.category}:该类型(${template.category})的供应商均未启用，请先在供应商看板中配置API Key`);
        }
        throw new Error(`没有可用的供应商匹配职位类型: ${template.category}`);
      }
    }

    return {
      name,
      role: template.title,
      prompt: template.prompt,
      skills: template.skills,
      provider,
      templateId: template.id,
    };
  }

  /**
   * 批量招聘
   * @param {Array<{templateId, name, providerId?}>} recruitList
   * @returns {Array} 招聘配置列表
   */
  batchRecruit(recruitList) {
    return recruitList.map(item =>
      this.recruit(item.templateId, item.name, item.providerId)
    );
  }

  /** 根据职位类型获取推荐供应商 */
  getRecommendedProviders(category) {
    return this.providerRegistry.getByCategory(category);
  }

  /**
   * 从人才市场搜索可用人才
   * @param {object} criteria - 搜索条件 { role, skills, name, minScore }
   * @returns {Array} 匹配的人才档案
   */
  searchTalentMarket(criteria = {}) {
    if (!this.talentMarket) {
      console.log('  ⚠️ 人才市场未接入');
      return [];
    }
    return this.talentMarket.search(criteria);
  }

  /**
   * 从人才市场召回一个员工
   * @param {string} profileId - 人才市场档案ID
   * @param {string[]} [newSkills] - 新技能
   * @returns {object} 包含记忆和技能信息的召回配置
   */
  recallFromMarket(profileId, newSkills = []) {
    if (!this.talentMarket) {
      throw new Error('人才市场未接入');
    }

    const profile = this.talentMarket.recall(profileId, newSkills);

    return {
      name: profile.name,
      role: profile.role,
      prompt: profile.prompt,
      skills: [...profile.skills, ...profile.acquiredSkills],
      provider: profile.provider,
      templateId: null, // 召回的人不是从模板创建的
      // 携带原有记忆
      memory: profile.memorySnapshot,
      // 标记为召回
      isRecalled: true,
      previousWorkHistory: profile.workHistory,
    };
  }
}
