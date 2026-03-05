/**
 * Model Provider Registry - Outsourcing vendor marketplace
 * Different job categories map to different model providers
 * Providers need API Key configuration before enabling recruitment
 */

// Job category enum
export const JobCategory = {
  GENERAL: 'general',       // General positions (text processing, analysis, coding, etc.)
  DRAWING: 'drawing',       // Drawing/illustration positions
  MUSIC: 'music',           // Music positions
  VIDEO: 'video',           // Video positions
  CLI: 'cli',               // CLI coding assistant positions (local CLI tools)
};

// Job category label mapping (i18n keys for frontend)
export const JobCategoryLabel = {
  [JobCategory.GENERAL]: 'general',
  [JobCategory.DRAWING]: 'drawing',
  [JobCategory.MUSIC]: 'music',
  [JobCategory.VIDEO]: 'video',
  [JobCategory.CLI]: 'cli',
};

// Model Providers (outsourcing vendor marketplace)
export const ModelProviders = {
  // === General Position Providers ===
  OPENAI_GPT4: {
    id: 'openai-gpt4',
    name: 'OpenAI GPT-4',
    provider: 'OpenAI',
    model: 'gpt-4-turbo',
    category: JobCategory.GENERAL,
    capabilities: ['text-generation', 'coding', 'data-analysis', 'reasoning', 'translation'],
    costPerToken: 0.03,
    priceLabel: '$0.03/1K tokens',
    priceLevel: 3, // 1=cheap 2=moderate 3=expensive
    rating: 95, // Overall score 0-100
    description: 'Most powerful general model, ideal for complex reasoning and coding tasks',
    apiKey: '',
    enabled: false,
  },
  OPENAI_GPT35: {
    id: 'openai-gpt35',
    name: 'OpenAI GPT-3.5',
    provider: 'OpenAI',
    model: 'gpt-3.5-turbo',
    category: JobCategory.GENERAL,
    capabilities: ['text-generation', 'simple-coding', 'translation', 'summarization'],
    costPerToken: 0.002,
    priceLabel: '$0.002/1K tokens',
    priceLevel: 1,
    rating: 72,
    description: 'Cost-effective general model for simple tasks',
    apiKey: '',
    enabled: false,
  },
  ANTHROPIC_CLAUDE: {
    id: 'anthropic-claude',
    name: 'Anthropic Claude 3.5',
    provider: 'Anthropic',
    model: 'claude-3.5-sonnet',
    category: JobCategory.GENERAL,
    capabilities: ['text-generation', 'coding', 'data-analysis', 'long-context', 'reasoning'],
    costPerToken: 0.015,
    priceLabel: '$0.015/1K tokens',
    priceLevel: 2,
    rating: 93,
    description: 'Excels at long-context understanding and precise analysis',
    apiKey: '',
    enabled: false,
  },
  DEEPSEEK: {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    category: JobCategory.GENERAL,
    capabilities: ['text-generation', 'coding', 'math-reasoning', 'data-analysis'],
    costPerToken: 0.001,
    priceLabel: '$0.001/1K tokens',
    priceLevel: 1,
    rating: 88,
    description: 'High cost-performance model with outstanding coding capability',
    apiKey: '',
    enabled: false,
  },
  QWEN: {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'Alibaba Cloud',
    model: 'qwen-max',
    category: JobCategory.GENERAL,
    capabilities: ['text-generation', 'coding', 'data-analysis', 'reasoning', 'translation'],
    costPerToken: 0.004,
    priceLabel: '$0.004/1K tokens',
    priceLevel: 1,
    rating: 86,
    description: 'Alibaba Cloud flagship model with excellent multilingual support',
    apiKey: '',
    enabled: false,
  },

  // === Drawing Position Providers ===
  DALLE3: {
    id: 'openai-dalle3',
    name: 'DALL·E 3',
    provider: 'OpenAI',
    model: 'dall-e-3',
    category: JobCategory.DRAWING,
    capabilities: ['text-to-image', 'illustration', 'ui-design', 'concept-art'],
    costPerImage: 0.04,
    priceLabel: '$0.04/image',
    priceLevel: 2,
    rating: 90,
    description: 'High-quality text-to-image model',
    apiKey: '',
    enabled: false,
  },
  MIDJOURNEY: {
    id: 'midjourney-v6',
    name: 'Midjourney V6',
    provider: 'Midjourney',
    model: 'midjourney-v6',
    category: JobCategory.DRAWING,
    capabilities: ['art-creation', 'concept-art', 'stylized-illustration', 'photography-style'],
    costPerImage: 0.05,
    priceLabel: '$0.05/image',
    priceLevel: 3,
    rating: 96,
    description: 'Top choice for art creation with powerful stylization',
    apiKey: '',
    enabled: false,
  },
  STABLE_DIFFUSION: {
    id: 'stability-sdxl',
    name: 'Stable Diffusion XL',
    provider: 'Stability AI',
    model: 'sdxl-1.0',
    category: JobCategory.DRAWING,
    capabilities: ['text-to-image', 'image-to-image', 'style-transfer', 'fine-control'],
    costPerImage: 0.02,
    priceLabel: '$0.02/image',
    priceLevel: 1,
    rating: 82,
    description: 'Open-source controllable image generation model',
    apiKey: '',
    enabled: false,
  },

  // === Music Position Providers ===
  SUNO: {
    id: 'suno-v3',
    name: 'Suno V3.5',
    provider: 'Suno',
    model: 'suno-v3.5',
    category: JobCategory.MUSIC,
    capabilities: ['songwriting', 'scoring', 'lyrics', 'multi-genre'],
    costPerTrack: 0.1,
    priceLabel: '$0.10/track',
    priceLevel: 2,
    rating: 91,
    description: 'All-in-one AI music creation',
    apiKey: '',
    enabled: false,
  },
  UDIO: {
    id: 'udio-v1',
    name: 'Udio',
    provider: 'Udio',
    model: 'udio-v1.5',
    category: JobCategory.MUSIC,
    capabilities: ['music-generation', 'vocal-synthesis', 'arrangement', 'mixing'],
    costPerTrack: 0.08,
    priceLabel: '$0.08/track',
    priceLevel: 1,
    rating: 85,
    description: 'High-fidelity music generation',
    apiKey: '',
    enabled: false,
  },

  // === Video Position Providers ===
  RUNWAY: {
    id: 'runway-gen3',
    name: 'Runway Gen-3',
    provider: 'Runway',
    model: 'gen-3-alpha',
    category: JobCategory.VIDEO,
    capabilities: ['text-to-video', 'image-to-video', 'video-editing', 'vfx'],
    costPerSecond: 0.5,
    priceLabel: '$0.50/sec',
    priceLevel: 3,
    rating: 92,
    description: 'Professional-grade AI video generation',
    apiKey: '',
    enabled: false,
  },
  PIKA: {
    id: 'pika-v2',
    name: 'Pika 2.0',
    provider: 'Pika',
    model: 'pika-2.0',
    category: JobCategory.VIDEO,
    capabilities: ['short-video', 'animation', 'video-effects'],
    costPerSecond: 0.3,
    priceLabel: '$0.30/sec',
    priceLevel: 2,
    rating: 84,
    description: 'Lightweight video generation',
    apiKey: '',
    enabled: false,
  },
  KLING: {
    id: 'kling-v1',
    name: 'Kling AI',
    provider: 'Kuaishou',
    model: 'kling-v1',
    category: JobCategory.VIDEO,
    capabilities: ['text-to-video', 'image-to-video', 'video-continuation'],
    costPerSecond: 0.2,
    priceLabel: '$0.20/sec',
    priceLevel: 1,
    rating: 80,
    description: 'Cost-effective video generation model',
    apiKey: '',
    enabled: false,
  },

  // === CLI Coding Assistant Providers ===
  // CLI providers are auto-populated from CLI Backend Registry at runtime.
  // They appear in the Brain Providers board as a separate "CLI" category.
  // When enabled, HR can recruit agents that use local CLI tools as execution engines.
};

/**
 * Provider Registry - Manages all model providers
 */
export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    // Register all built-in providers
    Object.values(ModelProviders).forEach(p => this.register({ ...p }));
  }

  /**
   * Sync CLI backends from CLIBackendRegistry into providers.
   * Called at startup and after CLI detection to keep the two systems in sync.
   * CLI backends become providers under the 'cli' category.
   * @param {import('./cli-backends/registry.js').CLIBackendRegistry} cliRegistry
   */
  syncCLIBackends(cliRegistry) {
    if (!cliRegistry) return;
    const backends = cliRegistry.listAll();
    for (const b of backends) {
      const providerId = `cli-${b.id}`;
      const existing = this.providers.get(providerId);
      // Preserve existing enabled/apiKey state if already registered
      const wasEnabled = existing?.enabled || false;
      this.providers.set(providerId, {
        id: providerId,
        name: b.name,
        provider: 'Local CLI',
        model: b.execCommand,
        category: JobCategory.CLI,
        capabilities: ['coding', 'file-operations', 'shell-execution', 'code-review', 'refactoring'],
        costPerToken: 0,
        priceLabel: 'Free (local)',
        priceLevel: 1,
        rating: b.rating || 80,  // Use CLI's own rating (defined in BUILTIN_BACKENDS)
        description: b.description || `${b.name} - local CLI coding assistant`,
      // CLI providers don't need API keys; they use local CLI authentication
        // Detected/configured CLIs are auto-enabled, otherwise keep manual toggle state
        apiKey: (b.state === 'detected' || b.state === 'configured') ? 'cli-local' : '',
        enabled: (b.state === 'detected' || b.state === 'configured') ? true : wasEnabled || false,
        // Extra CLI metadata
        isCLI: true,
        cliBackendId: b.id,
        cliState: b.state,
        cliVersion: b.version,
        cliIcon: b.icon,
        // TODO: hide CodeBuddy from external users in the future
        // hidden: b.id === 'codebuddy',
      });
    }
  }

  /** Register a new model provider */
  register(providerConfig) {
    this.providers.set(providerConfig.id, providerConfig);
  }

  /** Get provider by ID */
  getById(id) {
    return this.providers.get(id);
  }

  /**
   * Configure a provider's API Key
   * @param {string} id - Provider ID
   * @param {string} apiKey - API Key
   * @returns {object} Updated provider config
   */
  configure(id, apiKey) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider not found: ${id}`);
    // CLI providers use toggle instead of API key
    if (provider.isCLI) {
      provider.enabled = !!apiKey;
      return provider;
    }
    provider.apiKey = apiKey;
    provider.enabled = !!apiKey;
    return provider;
  }

  /**
   * Manually enable/disable a provider
   */
  setEnabled(id, enabled) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider not found: ${id}`);
    // CLI providers can be toggled without API key check
    if (provider.isCLI) {
      provider.enabled = enabled;
      return provider;
    }
    if (enabled && !provider.apiKey) {
      throw new Error(`Provider ${provider.name} has no API Key configured, cannot enable`);
    }
    provider.enabled = enabled;
    return provider;
  }

  /** Get available (enabled) providers by job category */
  getByCategory(category) {
    return [...this.providers.values()].filter(
      p => p.category === category && p.enabled
    );
  }

  /** Get all providers by job category (including disabled) */
  getAllByCategory(category) {
    return [...this.providers.values()].filter(p => p.category === category);
  }

  /** Check if a category has any enabled provider */
  hasCategoryEnabled(category) {
    return this.getByCategory(category).length > 0;
  }

  /** 
   * Recommend best provider for a job category (from enabled ones)
   * Strategy: composite score = rating * 0.6 + (100 - priceLevel*20) * 0.4
   * i.e. high-rating + low-price gets priority
   */
  recommend(category, requirements = []) {
    let candidates = this.getByCategory(category);
    if (candidates.length === 0) return null;

    // If specific capability requirements exist, prefer matches
    if (requirements.length > 0) {
      const matched = candidates.filter(p =>
        requirements.every(req => p.capabilities.includes(req))
      );
      if (matched.length > 0) candidates = matched;
    }

    // Sort by cost-performance: high rating + low price
    candidates.sort((a, b) => {
      const scoreA = (a.rating || 80) * 0.6 + (100 - (a.priceLevel || 2) * 20) * 0.4;
      const scoreB = (b.rating || 80) * 0.6 + (100 - (b.priceLevel || 2) * 20) * 0.4;
      return scoreB - scoreA;
    });

    return candidates[0];
  }

  /** List all providers */
  listAll() {
    return [...this.providers.values()];
  }

  /** List all enabled providers */
  listEnabled() {
    return [...this.providers.values()].filter(p => p.enabled);
  }

  /** Get provider statistics (grouped by category, with enabled count) */
  getStats() {
    const stats = {};
    for (const cat of Object.values(JobCategory)) {
      const all = this.getAllByCategory(cat);
      // Skip empty CLI category if no CLI backends registered
      if (cat === JobCategory.CLI && all.length === 0) continue;
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
          // CLI-specific fields
          isCLI: p.isCLI || false,
          cliBackendId: p.cliBackendId || null,
          cliState: p.cliState || null,
          cliVersion: p.cliVersion || null,
          cliIcon: p.cliIcon || null,
        })),
      };
    }
    return stats;
  }
}
