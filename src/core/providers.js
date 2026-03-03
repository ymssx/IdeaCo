/**
 * 模型提供方注册表 - 外包人力市场供应商
 * 不同职位类型对应不同的模型提供方
 * 供应商需要配置API Key后才能启用招聘
 */

// 职位类型枚举
export const JobCategory = {
  GENERAL: 'general',       // 通用岗位（文本处理、分析、编程等）
  DRAWING: 'drawing',       // 画图岗位
  MUSIC: 'music',           // 音乐岗位
  VIDEO: 'video',           // 视频岗位
};

// 职位类型中文名映射
export const JobCategoryLabel = {
  [JobCategory.GENERAL]: '通用岗位',
  [JobCategory.DRAWING]: '画图岗位',
  [JobCategory.MUSIC]: '音乐岗位',
  [JobCategory.VIDEO]: '视频岗位',
};

// 模型提供方（外包人力市场供应商）
export const ModelProviders = {
  // === 通用岗位供应商 ===
  OPENAI_GPT4: {
    id: 'openai-gpt4',
    name: 'OpenAI GPT-4',
    provider: 'OpenAI',
    model: 'gpt-4-turbo',
    category: JobCategory.GENERAL,
    capabilities: ['文本生成', '代码编写', '数据分析', '逻辑推理', '翻译'],
    costPerToken: 0.03,
    priceLabel: '$0.03/1K tokens',
    priceLevel: 3, // 1=便宜 2=适中 3=较贵
    rating: 95, // 综合评分 0-100
    description: '最强通用大模型，适合复杂推理和编程任务',
    apiKey: '',
    enabled: false,
  },
  OPENAI_GPT35: {
    id: 'openai-gpt35',
    name: 'OpenAI GPT-3.5',
    provider: 'OpenAI',
    model: 'gpt-3.5-turbo',
    category: JobCategory.GENERAL,
    capabilities: ['文本生成', '简单编程', '翻译', '摘要'],
    costPerToken: 0.002,
    priceLabel: '$0.002/1K tokens',
    priceLevel: 1,
    rating: 72,
    description: '性价比高的通用模型，适合简单任务',
    apiKey: '',
    enabled: false,
  },
  ANTHROPIC_CLAUDE: {
    id: 'anthropic-claude',
    name: 'Anthropic Claude 3.5',
    provider: 'Anthropic',
    model: 'claude-3.5-sonnet',
    category: JobCategory.GENERAL,
    capabilities: ['文本生成', '代码编写', '数据分析', '长文本处理', '逻辑推理'],
    costPerToken: 0.015,
    priceLabel: '$0.015/1K tokens',
    priceLevel: 2,
    rating: 93,
    description: '擅长长文本理解和精确分析',
    apiKey: '',
    enabled: false,
  },
  DEEPSEEK: {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    category: JobCategory.GENERAL,
    capabilities: ['文本生成', '代码编写', '数学推理', '数据分析'],
    costPerToken: 0.001,
    priceLabel: '$0.001/1K tokens',
    priceLevel: 1,
    rating: 88,
    description: '国产高性价比模型，编程能力突出',
    apiKey: '',
    enabled: false,
  },
  QWEN: {
    id: 'qwen-max',
    name: '通义千问 Max',
    provider: '阿里云',
    model: 'qwen-max',
    category: JobCategory.GENERAL,
    capabilities: ['文本生成', '代码编写', '数据分析', '逻辑推理', '翻译'],
    costPerToken: 0.004,
    priceLabel: '$0.004/1K tokens',
    priceLevel: 1,
    rating: 86,
    description: '阿里云通义千问旗舰模型，中文能力出色',
    apiKey: '',
    enabled: false,
  },

  // === 画图岗位供应商 ===
  DALLE3: {
    id: 'openai-dalle3',
    name: 'DALL·E 3',
    provider: 'OpenAI',
    model: 'dall-e-3',
    category: JobCategory.DRAWING,
    capabilities: ['文生图', '插画', 'UI设计', '概念设计'],
    costPerImage: 0.04,
    priceLabel: '$0.04/张',
    priceLevel: 2,
    rating: 90,
    description: '高质量文生图模型',
    apiKey: '',
    enabled: false,
  },
  MIDJOURNEY: {
    id: 'midjourney-v6',
    name: 'Midjourney V6',
    provider: 'Midjourney',
    model: 'midjourney-v6',
    category: JobCategory.DRAWING,
    capabilities: ['艺术创作', '概念设计', '风格化插画', '摄影风格'],
    costPerImage: 0.05,
    priceLabel: '$0.05/张',
    priceLevel: 3,
    rating: 96,
    description: '艺术创作首选，风格化能力极强',
    apiKey: '',
    enabled: false,
  },
  STABLE_DIFFUSION: {
    id: 'stability-sdxl',
    name: 'Stable Diffusion XL',
    provider: 'Stability AI',
    model: 'sdxl-1.0',
    category: JobCategory.DRAWING,
    capabilities: ['文生图', '图生图', '风格迁移', '精细控制'],
    costPerImage: 0.02,
    priceLabel: '$0.02/张',
    priceLevel: 1,
    rating: 82,
    description: '开源可控的图像生成模型',
    apiKey: '',
    enabled: false,
  },

  // === 音乐岗位供应商 ===
  SUNO: {
    id: 'suno-v3',
    name: 'Suno V3.5',
    provider: 'Suno',
    model: 'suno-v3.5',
    category: JobCategory.MUSIC,
    capabilities: ['歌曲创作', '配乐', '歌词生成', '多风格音乐'],
    costPerTrack: 0.1,
    priceLabel: '$0.10/首',
    priceLevel: 2,
    rating: 91,
    description: '全能音乐创作AI',
    apiKey: '',
    enabled: false,
  },
  UDIO: {
    id: 'udio-v1',
    name: 'Udio',
    provider: 'Udio',
    model: 'udio-v1.5',
    category: JobCategory.MUSIC,
    capabilities: ['音乐生成', '人声合成', '编曲', '混音'],
    costPerTrack: 0.08,
    priceLabel: '$0.08/首',
    priceLevel: 1,
    rating: 85,
    description: '高保真音乐生成',
    apiKey: '',
    enabled: false,
  },

  // === 视频岗位供应商 ===
  RUNWAY: {
    id: 'runway-gen3',
    name: 'Runway Gen-3',
    provider: 'Runway',
    model: 'gen-3-alpha',
    category: JobCategory.VIDEO,
    capabilities: ['文生视频', '图生视频', '视频编辑', '特效'],
    costPerSecond: 0.5,
    priceLabel: '$0.50/秒',
    priceLevel: 3,
    rating: 92,
    description: '专业级AI视频生成',
    apiKey: '',
    enabled: false,
  },
  PIKA: {
    id: 'pika-v2',
    name: 'Pika 2.0',
    provider: 'Pika',
    model: 'pika-2.0',
    category: JobCategory.VIDEO,
    capabilities: ['短视频生成', '动画', '视频特效'],
    costPerSecond: 0.3,
    priceLabel: '$0.30/秒',
    priceLevel: 2,
    rating: 84,
    description: '轻量级视频生成',
    apiKey: '',
    enabled: false,
  },
  KLING: {
    id: 'kling-v1',
    name: '可灵 AI',
    provider: '快手',
    model: 'kling-v1',
    category: JobCategory.VIDEO,
    capabilities: ['文生视频', '图生视频', '视频续写'],
    costPerSecond: 0.2,
    priceLabel: '$0.20/秒',
    priceLevel: 1,
    rating: 80,
    description: '国产视频生成模型',
    apiKey: '',
    enabled: false,
  },
};

/**
 * 模型提供方注册表 - 管理所有供应商
 */
export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    // 注册所有内置供应商
    Object.values(ModelProviders).forEach(p => this.register({ ...p }));
  }

  /** 注册一个新的模型提供方 */
  register(providerConfig) {
    this.providers.set(providerConfig.id, providerConfig);
  }

  /** 根据ID获取供应商 */
  getById(id) {
    return this.providers.get(id);
  }

  /**
   * 配置供应商的API Key
   * @param {string} id - 供应商ID
   * @param {string} apiKey - API Key
   * @returns {object} 更新后的供应商配置
   */
  configure(id, apiKey) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`供应商不存在: ${id}`);
    provider.apiKey = apiKey;
    provider.enabled = !!apiKey;
    return provider;
  }

  /**
   * 手动启用/禁用供应商
   */
  setEnabled(id, enabled) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`供应商不存在: ${id}`);
    if (enabled && !provider.apiKey) {
      throw new Error(`供应商 ${provider.name} 尚未配置API Key，无法启用`);
    }
    provider.enabled = enabled;
    return provider;
  }

  /** 根据职位类型获取可用的（已启用的）供应商列表 */
  getByCategory(category) {
    return [...this.providers.values()].filter(
      p => p.category === category && p.enabled
    );
  }

  /** 根据职位类型获取所有供应商（包括未启用的） */
  getAllByCategory(category) {
    return [...this.providers.values()].filter(p => p.category === category);
  }

  /** 检查某个类型是否有已启用的供应商 */
  hasCategoryEnabled(category) {
    return this.getByCategory(category).length > 0;
  }

  /** 
   * 根据职位类型推荐最佳供应商（仅从已启用的中推荐）
   * 策略: 综合评分 = rating * 0.6 + (100 - priceLevel*20) * 0.4
   * 即高评分、低价格的优先
   */
  recommend(category, requirements = []) {
    let candidates = this.getByCategory(category);
    if (candidates.length === 0) return null;

    // 如果有特定能力需求，优先匹配
    if (requirements.length > 0) {
      const matched = candidates.filter(p =>
        requirements.every(req => p.capabilities.includes(req))
      );
      if (matched.length > 0) candidates = matched;
    }

    // 按性价比排序：高评分 + 低价格
    candidates.sort((a, b) => {
      const scoreA = (a.rating || 80) * 0.6 + (100 - (a.priceLevel || 2) * 20) * 0.4;
      const scoreB = (b.rating || 80) * 0.6 + (100 - (b.priceLevel || 2) * 20) * 0.4;
      return scoreB - scoreA;
    });

    return candidates[0];
  }

  /** 列出所有供应商 */
  listAll() {
    return [...this.providers.values()];
  }

  /** 列出所有已启用的供应商 */
  listEnabled() {
    return [...this.providers.values()].filter(p => p.enabled);
  }

  /** 获取供应商统计（按类别分组，包含启用数） */
  getStats() {
    const stats = {};
    for (const cat of Object.values(JobCategory)) {
      const all = this.getAllByCategory(cat);
      const enabled = this.getByCategory(cat);
      stats[cat] = {
        label: JobCategoryLabel[cat],
        total: all.length,
        enabled: enabled.length,
        providers: all.map(p => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          enabled: p.enabled,
          hasKey: !!p.apiKey,
          rating: p.rating || 0,
          priceLabel: p.priceLabel || '',
          priceLevel: p.priceLevel || 2,
          description: p.description || '',
          capabilities: p.capabilities || [],
        })),
      };
    }
    return stats;
  }
}
