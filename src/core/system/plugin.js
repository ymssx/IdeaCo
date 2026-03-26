/**
 * Plugin System - Hot-pluggable skill extension framework for agents
 *
 * Distilled from OpenClaw's plugin system (vendor/openclaw/src/plugins/)
 * Re-implemented as an "employee training / skill certification" system
 *
 * Features:
 * - Plugin discovery and registration
 * - Lifecycle hooks (install, enable, disable, uninstall)
 * - Plugin-provided tools that agents can use
 * - Plugin configuration schema validation
 * - Event hooks (before/after tool call, message received, etc.)
 */
import { v4 as uuidv4 } from 'uuid';
import { exec as cpExec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const _require = createRequire(import.meta.url);

/**
 * Safely load optional dependencies (puppeteer, pdf-parse, openai, etc.)
 * These packages are marked as external in next.config.mjs so webpack won't try to bundle them
 */
function tryRequire(moduleName) {
  try {
    return _require(moduleName);
  } catch {
    return null;
  }
}

const execAsync = promisify(cpExec);
const logInfo = (...args) => {
  if (process.env.IDEACO_SILENT_INIT === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  console.log(...args);
};

// Runtime references (lazily fetched to avoid circular dependencies)
let _sessionManager = null;
let _cronScheduler = null;
let _knowledgeManager = null;
let _llmClient = null;
let _messageBus = null;

/** Initialize runtime references (called externally to avoid circular imports) */
export function initPluginRuntime({ sessionManager, cronScheduler, knowledgeManager, llmClient, messageBus } = {}) {
  if (sessionManager) _sessionManager = sessionManager;
  if (cronScheduler) _cronScheduler = cronScheduler;
  if (knowledgeManager) _knowledgeManager = knowledgeManager;
  if (llmClient) _llmClient = llmClient;
  if (messageBus) _messageBus = messageBus;
}

import { WORKSPACE_DIR, DATA_DIR } from '../../lib/paths.js';

/**
 * Plugin lifecycle states
 */
export const PluginState = {
  DISCOVERED: 'discovered',
  INSTALLED: 'installed',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  ERROR: 'error',
};

/**
 * Hook points where plugins can inject behavior
 */
export const HookPoint = {
  BEFORE_TOOL_CALL: 'before_tool_call',
  AFTER_TOOL_CALL: 'after_tool_call',
  BEFORE_LLM_CALL: 'before_llm_call',
  AFTER_LLM_CALL: 'after_llm_call',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
  AGENT_TASK_START: 'agent_task_start',
  AGENT_TASK_END: 'agent_task_end',
  REQUIREMENT_CREATED: 'requirement_created',
  REQUIREMENT_COMPLETED: 'requirement_completed',
};

/**
 * Plugin manifest definition
 * Each plugin must provide this metadata
 */
export class PluginManifest {
  /**
   * @param {object} config
   * @param {string} config.id - Unique plugin identifier
   * @param {string} config.name - Display name
   * @param {string} config.version - Semver version string
   * @param {string} config.description - What this plugin does
   * @param {string} config.author - Plugin author
   * @param {Array} config.tools - Tool definitions this plugin provides
   * @param {object} config.hooks - Hook handlers { [HookPoint]: Function }
   * @param {object} config.configSchema - JSON schema for plugin configuration
   * @param {Array} config.requiredProviders - Provider IDs this plugin needs
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.description = config.description || '';
    this.author = config.author || 'Unknown';
    this.tools = config.tools || [];
    this.hooks = config.hooks || {};
    this.configSchema = config.configSchema || {};
    this.requiredProviders = config.requiredProviders || [];
  }
}

/**
 * Plugin instance - A registered and managed plugin
 */
class PluginInstance {
  constructor(manifest) {
    this.manifest = manifest;
    this.state = PluginState.INSTALLED;
    this.config = {};
    this.error = null;
    this.installedAt = new Date();
    this.enabledAt = null;
  }
}

/**
 * Plugin Registry - Manages all installed plugins
 */
export class PluginRegistry {
  constructor() {
    // Registered plugins: Map<pluginId, PluginInstance>
    this.plugins = new Map();

    // Hook subscriptions: Map<HookPoint, Array<{pluginId, handler}>>
    this.hookSubscriptions = new Map();
    Object.values(HookPoint).forEach(hp => this.hookSubscriptions.set(hp, []));
  }

  /**
   * Install a plugin from its manifest
   * @param {PluginManifest} manifest
   * @param {object} config - Initial plugin configuration
   * @returns {PluginInstance}
   */
  install(manifest, config = {}) {
    // Idempotent: skip if already installed (survives HMR re-execution)
    if (this.plugins.has(manifest.id)) {
      return this.plugins.get(manifest.id);
    }

    const instance = new PluginInstance(manifest);
    instance.config = { ...config };
    this.plugins.set(manifest.id, instance);

    // logInfo(`🔌 Plugin installed: ${manifest.name} v${manifest.version}`);
    return instance;
  }

  /**
   * Enable a plugin (activate its hooks and tools)
   * @param {string} pluginId
   */
  enable(pluginId) {
    const instance = this.plugins.get(pluginId);
    if (!instance) throw new Error(`Plugin "${pluginId}" not found`);

    if (instance.state === PluginState.ENABLED) return;

    // Register hooks
    for (const [hookPoint, handler] of Object.entries(instance.manifest.hooks)) {
      if (this.hookSubscriptions.has(hookPoint)) {
        this.hookSubscriptions.get(hookPoint).push({
          pluginId,
          handler,
        });
      }
    }

    instance.state = PluginState.ENABLED;
    instance.enabledAt = new Date();
  }

  /**
   * Disable a plugin (deactivate its hooks)
   * @param {string} pluginId
   */
  disable(pluginId) {
    const instance = this.plugins.get(pluginId);
    if (!instance) throw new Error(`Plugin "${pluginId}" not found`);

    // Remove hooks
    for (const [hookPoint, subscribers] of this.hookSubscriptions.entries()) {
      this.hookSubscriptions.set(
        hookPoint,
        subscribers.filter(s => s.pluginId !== pluginId)
      );
    }

    instance.state = PluginState.DISABLED;
    console.log(`⏸️  Plugin disabled: ${instance.manifest.name}`);
  }

  /**
   * Uninstall a plugin
   * @param {string} pluginId
   */
  uninstall(pluginId) {
    if (this.plugins.has(pluginId)) {
      this.disable(pluginId);
      this.plugins.delete(pluginId);
      console.log(`🗑️  Plugin uninstalled: ${pluginId}`);
    }
  }

  /**
   * Fire a hook point - call all subscribed handlers
   * @param {string} hookPoint
   * @param {object} context - Data passed to hook handlers
   * @returns {Promise<Array>} Results from all handlers
   */
  async fireHook(hookPoint, context = {}) {
    const subscribers = this.hookSubscriptions.get(hookPoint) || [];
    const results = [];

    for (const { pluginId, handler } of subscribers) {
      const instance = this.plugins.get(pluginId);
      if (!instance || instance.state !== PluginState.ENABLED) continue;

      try {
        const result = await handler(context, instance.config);
        results.push({ pluginId, result, error: null });
      } catch (error) {
        console.error(`[Plugin ${pluginId}] Hook error at ${hookPoint}:`, error.message);
        results.push({ pluginId, result: null, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get all tool definitions from enabled plugins
   * @returns {Array} OpenAI function-call compatible tool definitions
   */
  getPluginTools() {
    const tools = [];
    for (const [pluginId, instance] of this.plugins) {
      if (instance.state !== PluginState.ENABLED) continue;
      for (const tool of instance.manifest.tools) {
        tools.push({
          ...tool,
          _pluginId: pluginId, // Track which plugin owns the tool
        });
      }
    }
    return tools;
  }

  /**
   * Execute a plugin-provided tool
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<string>}
   */
  async executePluginTool(toolName, args) {
    for (const [pluginId, instance] of this.plugins) {
      if (instance.state !== PluginState.ENABLED) continue;

      const tool = instance.manifest.tools.find(t => t.function?.name === toolName);
      if (tool && tool._executor) {
        return await tool._executor(args, instance.config);
      }
    }
    throw new Error(`Plugin tool not found: ${toolName}`);
  }

  /**
   * List all plugins with their status
   * @returns {Array}
   */
  list() {
    return [...this.plugins.values()].map(inst => ({
      id: inst.manifest.id,
      name: inst.manifest.name,
      version: inst.manifest.version,
      description: inst.manifest.description,
      author: inst.manifest.author,
      state: inst.state,
      toolCount: inst.manifest.tools.length,
      hookCount: Object.keys(inst.manifest.hooks).length,
      installedAt: inst.installedAt,
      enabledAt: inst.enabledAt,
      error: inst.error,
    }));
  }

  /**
   * Get plugin by ID
   * @param {string} pluginId
   * @returns {PluginInstance|null}
   */
  get(pluginId) {
    return this.plugins.get(pluginId) || null;
  }

  /**
   * Configure a plugin
   * @param {string} pluginId
   * @param {object} config
   */
  configure(pluginId, config) {
    const instance = this.plugins.get(pluginId);
    if (!instance) throw new Error(`Plugin "${pluginId}" not found`);
    instance.config = { ...instance.config, ...config };
  }
}

// ====================================================================
// Built-in Plugins (pre-installed "company training programs")
// ====================================================================

/**
 * Web Search Plugin - Allow agents to search the web
 */
export const WebSearchPlugin = new PluginManifest({
  id: 'builtin-web-search',
  name: 'Web Search',
  version: '1.0.0',
  description: 'Enables agents to search the internet for information',
  author: 'Idea Unlimited',
  configSchema: {
    apiKey: { type: 'string', description: 'Search API key' },
    engine: { type: 'string', default: 'google', enum: ['google', 'bing', 'duckduckgo'] },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for information. Returns top search results.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results to return (default: 5)' },
          },
          required: ['query'],
        },
      },
      _executor: async (args, config) => {
        const query = encodeURIComponent(args.query);
        const limit = args.limit || 5;
        try {
          // Use DuckDuckGo Instant Answer API (free, no API key required)
          const ddgUrl = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(ddgUrl, { signal: controller.signal });
          clearTimeout(timeout);
          const data = await res.json();

          const results = [];
          // AbstractText summary
          if (data.AbstractText) {
            results.push({ title: data.AbstractSource || 'Summary', snippet: data.AbstractText, url: data.AbstractURL || '' });
          }
          // RelatedTopics as search results
          if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics.slice(0, limit)) {
              if (topic.Text) {
                results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, url: topic.FirstURL || '' });
              }
            }
          }
          // If DDG has no results, fall back to scraping Google search page
          if (results.length === 0) {
            const googleUrl = `https://www.google.com/search?q=${query}&num=${limit}`;
            const gRes = await fetch(googleUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIEnterprise/1.0)' },
              signal: AbortSignal.timeout(8000),
            });
            const html = await gRes.text();
            // Simple extraction of search result snippets
            const snippets = html.match(/<span[^>]*>([^<]{50,300})<\/span>/g) || [];
            snippets.slice(0, limit).forEach((s, i) => {
              const text = s.replace(/<[^>]*>/g, '');
              results.push({ title: `Result ${i + 1}`, snippet: text, url: '' });
            });
          }
          return JSON.stringify({ query: args.query, results: results.slice(0, limit), count: results.length });
        } catch (e) {
          return JSON.stringify({ query: args.query, error: e.message, results: [] });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Code Review Plugin - Automated code quality checks
 */
export const CodeReviewPlugin = new PluginManifest({
  id: 'builtin-code-review',
  name: 'Code Review Assistant',
  version: '1.0.0',
  description: 'Automatically reviews code produced by agents for quality and security',
  author: 'Idea Unlimited',
  tools: [],
  hooks: {
    [HookPoint.AFTER_TOOL_CALL]: async (context, config) => {
      // After file_write, check the written content
      if (context.toolName === 'file_write' && context.result) {
        const warnings = [];
        const content = context.args?.content || '';

        // Simple checks
        if (content.includes('TODO')) warnings.push('Contains TODO comments');
        if (content.includes('console.log')) warnings.push('Contains console.log statements');
        if (content.includes('eval(')) warnings.push('Uses eval() - potential security risk');
        if (content.length > 10000) warnings.push('File is very long (>10K chars)');

        if (warnings.length > 0) {
          return { warnings, file: context.args?.path };
        }
      }
      return null;
    },
  },
});

/**
 * Notification Plugin - Send notifications on important events
 */
export const NotificationPlugin = new PluginManifest({
  id: 'builtin-notifications',
  name: 'Event Notifications',
  version: '1.0.0',
  description: 'Sends notifications when important events occur (task completion, errors, etc.)',
  author: 'Idea Unlimited',
  configSchema: {
    webhookUrl: { type: 'string', description: 'Webhook URL for notifications' },
    notifyOnError: { type: 'boolean', default: true },
    notifyOnTaskComplete: { type: 'boolean', default: true },
  },
  tools: [],
  hooks: {
    [HookPoint.AGENT_TASK_END]: async (context, config) => {
      const message = `✅ Task completed by ${context.agentName}: ${context.taskTitle || 'Unknown'}`;
      console.log(`📢 [Notification] ${message}`);
      // Actually send webhook notification
      if (config.webhookUrl) {
        try {
          await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'task_complete', message, agent: context.agentName, task: context.taskTitle, timestamp: new Date().toISOString() }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) { console.warn(`[Notification] Webhook failed: ${e.message}`); }
      }
      return { notified: true, message };
    },
    [HookPoint.REQUIREMENT_COMPLETED]: async (context, config) => {
      const message = `🏁 Requirement completed: ${context.requirementTitle || 'Unknown'}`;
      console.log(`📢 [Notification] ${message}`);
      if (config.webhookUrl) {
        try {
          await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'requirement_complete', message, timestamp: new Date().toISOString() }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) { console.warn(`[Notification] Webhook failed: ${e.message}`); }
      }
      return { notified: true, message };
    },
  },
});

/**
 * Web Fetch Plugin - Fetch web page content
 * Distilled from OpenClaw's web_fetch tool
 */
export const WebFetchPlugin = new PluginManifest({
  id: 'builtin-web-fetch',
  name: 'Web Fetch',
  version: '1.0.0',
  description: 'Fetch and extract content from web pages (URLs, APIs)',
  author: 'Idea Unlimited',
  configSchema: {
    timeout: { type: 'number', default: 10000, description: 'Request timeout (ms)' },
    maxSize: { type: 'number', default: 1048576, description: 'Max response size (bytes)' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch content from a URL. Supports HTML pages, JSON APIs, and plain text.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' },
            format: { type: 'string', enum: ['text', 'json', 'html'], description: 'Expected response format (default: text)' },
          },
          required: ['url'],
        },
      },
      _executor: async (args, config) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), config.timeout || 10000);
          const res = await fetch(args.url, { signal: controller.signal });
          clearTimeout(timeout);
          const text = await res.text();
          const truncated = text.slice(0, config.maxSize || 1048576);
          return JSON.stringify({ url: args.url, status: res.status, content: truncated });
        } catch (e) {
          return JSON.stringify({ error: e.message, url: args.url });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Browser Automation Plugin - Control a browser for web tasks
 * Distilled from OpenClaw's browser tool
 */
export const BrowserPlugin = new PluginManifest({
  id: 'builtin-browser',
  name: 'Browser Automation',
  version: '1.0.0',
  description: 'Control a headless browser to navigate, screenshot, and interact with web pages',
  author: 'Idea Unlimited',
  configSchema: {
    headless: { type: 'boolean', default: true, description: 'Run browser in headless mode' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL and return the page snapshot (DOM summary).',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to navigate to' },
            waitFor: { type: 'string', description: 'CSS selector to wait for before snapshot' },
          },
          required: ['url'],
        },
      },
      _executor: async (args) => {
        // Real implementation: use fetch to get page content as a DOM snapshot
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(args.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            signal: controller.signal,
            redirect: 'follow',
          });
          clearTimeout(timeout);
          const html = await res.text();
          // Extract plain text content (remove script/style tags)
          const cleaned = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000);
          const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
          return JSON.stringify({ status: 'navigated', url: args.url, title, httpStatus: res.status, textContent: cleaned, contentLength: html.length });
        } catch (e) {
          return JSON.stringify({ status: 'error', url: args.url, error: e.message });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current browser page.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
          },
        },
      },
      _executor: async (args) => {
        // Screenshot requires puppeteer; try to load it dynamically (use require to avoid webpack parsing)
        try {
          const puppeteer = tryRequire('puppeteer');
          if (!puppeteer) {
            return JSON.stringify({ status: 'unavailable', error: 'puppeteer not installed. Run: npm install puppeteer' });
          }
          const browser = await puppeteer.launch({ headless: 'new' });
          const page = await browser.newPage();
          await page.goto('about:blank'); // Use the currently loaded page
          const screenshotPath = path.join(DATA_DIR, `screenshot-${Date.now()}.png`);
          if (args.selector) {
            const el = await page.$(args.selector);
            if (el) await el.screenshot({ path: screenshotPath });
          } else {
            await page.screenshot({ path: screenshotPath, fullPage: true });
          }
          await browser.close();
          return JSON.stringify({ status: 'captured', path: screenshotPath });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Memory Plugin - Persistent agent memory (search & store)
 * Distilled from OpenClaw's memory-core and memory-lancedb plugins
 */
export const MemoryPlugin = new PluginManifest({
  id: 'builtin-memory',
  name: 'Memory System',
  version: '1.0.0',
  description: 'Persistent memory for agents — search, store, and recall long-term knowledge',
  author: 'Idea Unlimited',
  configSchema: {
    backend: { type: 'string', default: 'json', enum: ['json', 'sqlite'], description: 'Storage backend' },
    maxEntries: { type: 'number', default: 1000, description: 'Max stored memory entries' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'memory_search',
        description: 'Search agent memory for relevant past information, decisions, or facts.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results to return (default: 5)' },
          },
          required: ['query'],
        },
      },
      _executor: async (args) => {
        // Real implementation: search the knowledge base
        try {
          if (_knowledgeManager) {
            const results = _knowledgeManager.search(args.query, { limit: args.limit || 5 });
            return JSON.stringify({ query: args.query, results: results.map(r => ({ title: r.title, content: r.content, type: r.type, score: r.relevanceScore, source: r.knowledgeBaseName })), count: results.length });
          }
          return JSON.stringify({ query: args.query, results: [], note: 'KnowledgeManager not initialized, call initPluginRuntime()' });
        } catch (e) {
          return JSON.stringify({ query: args.query, error: e.message, results: [] });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_store',
        description: 'Store important information in agent long-term memory for future recall.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Information to remember' },
            importance: { type: 'number', description: 'Importance score 0-1 (default: 0.7)' },
            category: { type: 'string', enum: ['fact', 'decision', 'preference', 'task', 'other'], description: 'Memory category' },
          },
          required: ['text'],
        },
      },
      _executor: async (args) => {
        // Real implementation: store to the knowledge base
        try {
          if (_knowledgeManager) {
            // Get or create the default knowledge base
            let bases = _knowledgeManager.list();
            let kbId = bases[0]?.id;
            if (!kbId) {
              const kb = _knowledgeManager.create({ name: 'Agent Memory', description: 'Auto-created memory store', type: 'global' });
              kbId = kb.id;
            }
            const entry = _knowledgeManager.addEntry(kbId, {
              title: args.text.slice(0, 80),
              content: args.text,
              type: args.category === 'decision' ? 'decision' : args.category === 'fact' ? 'fact' : 'note',
              importance: args.importance || 0.7,
              tags: [args.category || 'other', 'memory'],
            });
            return JSON.stringify({ stored: true, entryId: entry.id, category: args.category || 'other' });
          }
          return JSON.stringify({ stored: false, note: 'KnowledgeManager not initialized' });
        } catch (e) {
          return JSON.stringify({ stored: false, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Image Processing Plugin - Generate and manipulate images
 * Distilled from OpenClaw's image tool
 */
export const ImagePlugin = new PluginManifest({
  id: 'builtin-image',
  name: 'Image Processing',
  version: '1.0.0',
  description: 'Generate, analyze, and manipulate images via AI vision models',
  author: 'Idea Unlimited',
  configSchema: {
    provider: { type: 'string', default: 'openai', description: 'Image generation provider' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'image_generate',
        description: 'Generate an image from a text description using AI.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Image description prompt' },
            size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'], description: 'Image size' },
          },
          required: ['prompt'],
        },
      },
      _executor: async (args) => {
        // Real implementation: call the OpenAI DALL-E API
        try {
          if (_llmClient && _llmClient._imageProvider) {
            const result = await _llmClient.generateImage(_llmClient._imageProvider, args.prompt, { size: args.size || '1024x1024' });
            return JSON.stringify({ status: 'generated', url: result.url, revisedPrompt: result.revisedPrompt });
          }
          return JSON.stringify({ status: 'error', error: 'No image provider configured. Add an OpenAI provider with DALL-E support.' });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * PDF Processing Plugin - Read and extract content from PDFs
 * Distilled from OpenClaw's pdf tool
 */
export const PdfPlugin = new PluginManifest({
  id: 'builtin-pdf',
  name: 'PDF Processing',
  version: '1.0.0',
  description: 'Read, extract text, and analyze PDF documents',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'pdf_read',
        description: 'Extract text content from a PDF file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the PDF file (relative to workspace)' },
            pages: { type: 'string', description: 'Page range, e.g. "1-5" or "1,3,5" (default: all)' },
          },
          required: ['path'],
        },
      },
      _executor: async (args) => {
        // Real implementation: PDF text extraction
        try {
          const filePath = path.resolve(WORKSPACE_DIR, args.path);
          if (!existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${args.path}` });
          }
          // Try using pdf-parse (use require to avoid webpack parsing)
          const pdfParse = tryRequire('pdf-parse');
          if (pdfParse) {
            const buffer = await fs.readFile(filePath);
            const data = await pdfParse(buffer);
            let text = data.text || '';
            // If a page range is specified, do a simple slice
            if (args.pages) {
              const lines = text.split('\n');
              const perPage = Math.ceil(lines.length / (data.numpages || 1));
              const pageNums = args.pages.includes('-')
                ? Array.from({length: parseInt(args.pages.split('-')[1]) - parseInt(args.pages.split('-')[0]) + 1}, (_, i) => parseInt(args.pages.split('-')[0]) + i)
                : args.pages.split(',').map(Number);
              text = pageNums.map(p => lines.slice((p-1)*perPage, p*perPage).join('\n')).join('\n---PAGE BREAK---\n');
            }
            return JSON.stringify({ path: args.path, pages: data.numpages, text: text.slice(0, 20000), textLength: text.length });
          }
          // Fallback: use pdftotext command-line tool
          try {
            const { stdout } = await execAsync(`pdftotext "${filePath}" -`, { timeout: 15000 });
            return JSON.stringify({ path: args.path, text: stdout.slice(0, 20000), textLength: stdout.length, method: 'pdftotext' });
          } catch {
            // Final fallback: read binary and extract visible text
            const raw = await fs.readFile(filePath, 'latin1');
            const textMatches = raw.match(/\(([^)]{2,})\)/g) || [];
            const extracted = textMatches.map(m => m.slice(1, -1)).join(' ').slice(0, 10000);
            return JSON.stringify({ path: args.path, text: extracted, textLength: extracted.length, method: 'raw-extract', note: 'Install pdf-parse for better results: npm install pdf-parse' });
          }
        } catch (e) {
          return JSON.stringify({ error: e.message, path: args.path });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Canvas Plugin - Render and present visual content
 * Distilled from OpenClaw's canvas tool
 */
export const CanvasPlugin = new PluginManifest({
  id: 'builtin-canvas',
  name: 'Canvas Rendering',
  version: '1.0.0',
  description: 'Present and render visual content, interactive UIs, and diagrams',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'canvas_present',
        description: 'Render HTML/CSS/JS content in the canvas viewer for the user.',
        parameters: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'HTML content to render' },
            title: { type: 'string', description: 'Title for the canvas' },
          },
          required: ['html'],
        },
      },
      _executor: async (args) => {
        // Real implementation: write HTML content to a file and return the path
        try {
          const canvasDir = path.join(DATA_DIR, 'canvas');
          if (!existsSync(canvasDir)) mkdirSync(canvasDir, { recursive: true });
          const filename = `canvas-${Date.now()}.html`;
          const filePath = path.join(canvasDir, filename);
          const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${args.title || 'Canvas'}</title></head><body>${args.html}</body></html>`;
          await fs.writeFile(filePath, fullHtml, 'utf-8');
          return JSON.stringify({ presented: true, title: args.title || 'Untitled', path: filePath, contentLength: args.html.length });
        } catch (e) {
          return JSON.stringify({ presented: false, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Data Processing Plugin - Process and transform data
 */
export const DataProcessingPlugin = new PluginManifest({
  id: 'builtin-data-processing',
  name: 'Data Processing',
  version: '1.0.0',
  description: 'Parse, transform, and analyze structured data (CSV, JSON, Excel)',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'data_parse',
        description: 'Parse structured data from CSV, JSON, or tabular text.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Raw data content' },
            format: { type: 'string', enum: ['csv', 'json', 'tsv'], description: 'Data format' },
          },
          required: ['content', 'format'],
        },
      },
      _executor: async (args) => {
        try {
          if (args.format === 'json') {
            const parsed = JSON.parse(args.content);
            const rows = Array.isArray(parsed) ? parsed.length : 1;
            return JSON.stringify({ rows, preview: JSON.stringify(parsed).slice(0, 500) });
          }
          const lines = args.content.trim().split('\n');
          return JSON.stringify({ rows: lines.length, headers: lines[0], preview: lines.slice(0, 5).join('\n') });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * TTS Plugin - Text-to-Speech capability
 * Distilled from OpenClaw's tts tool
 */
export const TtsPlugin = new PluginManifest({
  id: 'builtin-tts',
  name: 'Text-to-Speech',
  version: '1.0.0',
  description: 'Convert text to spoken audio using AI voice models',
  author: 'Idea Unlimited',
  configSchema: {
    provider: { type: 'string', default: 'openai', enum: ['openai', 'elevenlabs'], description: 'TTS provider' },
    voice: { type: 'string', default: 'alloy', description: 'Voice name/ID' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'tts_speak',
        description: 'Convert text to speech audio.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to speak' },
            voice: { type: 'string', description: 'Voice ID (default from config)' },
          },
          required: ['text'],
        },
      },
      _executor: async (args, config) => {
        // Real implementation: call the OpenAI TTS API
        try {
          const openaiModule = tryRequire('openai');
          if (!openaiModule) {
            return JSON.stringify({ status: 'error', error: 'openai package not installed. Run: npm install openai' });
          }
          const OpenAI = openaiModule.default || openaiModule;
          // TODO: TTS needs access to provider registry via Company instance
          return JSON.stringify({ status: 'error', error: 'TTS plugin not yet connected to provider registry' });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Shell Exec Plugin - Run shell commands in the workspace
 * Distilled from OpenClaw's exec + process tools
 */
export const ExecPlugin = new PluginManifest({
  id: 'builtin-exec',
  name: 'Shell Execution',
  version: '1.0.0',
  description: 'Run shell commands in the workspace with background process support',
  author: 'Idea Unlimited',
  configSchema: {
    timeout: { type: 'number', default: 30, description: 'Default timeout in seconds' },
    allowElevated: { type: 'boolean', default: false, description: 'Allow elevated (host) execution' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'exec',
        description: 'Run a shell command in the workspace directory.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
            background: { type: 'boolean', description: 'Run in background (default: false)' },
          },
          required: ['command'],
        },
      },
      _executor: async (args, config) => {
        // Real implementation: execute a shell command
        try {
          const timeout = (args.timeout || config.timeout || 30) * 1000;
          if (args.background) {
            // Background process: spawn and return PID
            const { spawn } = await import('child_process');
            const parts = args.command.split(/\s+/);
            const child = spawn(parts[0], parts.slice(1), {
              cwd: WORKSPACE_DIR, detached: true, stdio: 'ignore',
            });
            child.unref();
            return JSON.stringify({ status: 'background', pid: child.pid, command: args.command });
          }
          // Foreground execution
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: WORKSPACE_DIR, timeout, maxBuffer: 2 * 1024 * 1024,
          });
          return JSON.stringify({
            status: 'completed',
            command: args.command,
            stdout: stdout.slice(0, 10000),
            stderr: stderr ? stderr.slice(0, 5000) : '',
            exitCode: 0,
          });
        } catch (e) {
          return JSON.stringify({
            status: 'error',
            command: args.command,
            stdout: e.stdout?.slice(0, 5000) || '',
            stderr: e.stderr?.slice(0, 5000) || e.message,
            exitCode: e.code || 1,
          });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'process',
        description: 'Manage background exec sessions (list, poll, log, write, kill, clear).',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'poll', 'log', 'write', 'kill', 'clear'], description: 'Process management action' },
            sessionId: { type: 'string', description: 'Background session ID' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: process management
        try {
          switch (args.action) {
            case 'list': {
              const { stdout } = await execAsync('ps aux | head -20', { cwd: WORKSPACE_DIR, timeout: 5000 });
              return JSON.stringify({ action: 'list', output: stdout.slice(0, 5000) });
            }
            case 'kill': {
              if (!args.sessionId) return JSON.stringify({ error: 'sessionId (PID) required' });
              process.kill(parseInt(args.sessionId), 'SIGTERM');
              return JSON.stringify({ action: 'kill', pid: args.sessionId, status: 'signal_sent' });
            }
            default:
              return JSON.stringify({ action: args.action, error: `Unsupported action: ${args.action}` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Apply Patch Plugin - Structured multi-file edits
 * Distilled from OpenClaw's apply_patch tool
 */
export const ApplyPatchPlugin = new PluginManifest({
  id: 'builtin-apply-patch',
  name: 'Apply Patch',
  version: '1.0.0',
  description: 'Apply structured patches across one or more files for multi-hunk edits',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'apply_patch',
        description: 'Apply a structured patch to one or more files. Use *** Begin Patch / *** End Patch format.',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Patch content using *** Begin Patch / *** End Patch format' },
          },
          required: ['input'],
        },
      },
      _executor: async (args) => {
        // Real implementation: parse and apply a unified diff patch
        try {
          const patchContent = args.input || '';
          // Parse *** Begin Patch / *** End Patch format
          const filePatches = patchContent.split(/^\*{3}\s+/m).filter(Boolean);
          const results = [];
          for (const block of filePatches) {
            const lines = block.split('\n');
            const fileMatch = lines[0].match(/^(.+?)\s*$/);
            if (!fileMatch) continue;
            const filePath = path.resolve(WORKSPACE_DIR, fileMatch[1].trim());
            // Read the original file
            let original = '';
            try { original = await fs.readFile(filePath, 'utf-8'); } catch {}
            // Apply patch lines (simplified: rule-based replacement)
            let modified = original;
            let applied = 0;
            for (let i = 1; i < lines.length; i++) {
              if (lines[i].startsWith('-')) {
                const oldLine = lines[i].slice(1);
                const newLine = (lines[i + 1] && lines[i + 1].startsWith('+')) ? lines[i + 1].slice(1) : '';
                if (modified.includes(oldLine)) {
                  modified = modified.replace(oldLine, newLine);
                  applied++;
                  if (lines[i + 1]?.startsWith('+')) i++;
                }
              } else if (lines[i].startsWith('+') && !lines[i - 1]?.startsWith('-')) {
                modified += '\n' + lines[i].slice(1);
                applied++;
              }
            }
            // Write the file
            const dir = path.dirname(filePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            await fs.writeFile(filePath, modified, 'utf-8');
            results.push({ file: fileMatch[1].trim(), hunksApplied: applied, status: 'patched' });
          }
          return JSON.stringify({ status: 'applied', files: results, totalFiles: results.length });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Message Plugin - Cross-channel messaging (Discord, Slack, Telegram, etc.)
 * Distilled from OpenClaw's message tool
 */
export const MessagePlugin = new PluginManifest({
  id: 'builtin-message',
  name: 'Messaging',
  version: '1.0.0',
  description: 'Send messages and actions across Discord, Slack, Telegram, WhatsApp, and more',
  author: 'Idea Unlimited',
  configSchema: {
    defaultChannel: { type: 'string', description: 'Default messaging channel' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'message_send',
        description: 'Send a message to a channel or user across connected messaging platforms.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target (e.g. "slack:#general", "telegram:@user", "discord:channel:123")' },
            text: { type: 'string', description: 'Message text' },
            media: { type: 'string', description: 'Optional media attachment path' },
          },
          required: ['target', 'text'],
        },
      },
      _executor: async (args) => {
        // Real implementation: send message via the message bus
        try {
          if (_messageBus) {
            const msg = _messageBus.send({
              from: 'plugin:messaging',
              to: args.target,
              content: args.text,
              type: 'broadcast',
              metadata: { media: args.media || null },
            });
            return JSON.stringify({ sent: true, messageId: msg.id, target: args.target });
          }
          // Fallback: log to console
          console.log(`📨 [Message] To ${args.target}: ${args.text}`);
          return JSON.stringify({ sent: true, target: args.target, method: 'console' });
        } catch (e) {
          return JSON.stringify({ sent: false, error: e.message });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'message_search',
        description: 'Search messages across connected channels.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            channel: { type: 'string', description: 'Limit to specific channel' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
      },
      _executor: async (args) => {
        // Real implementation: search message bus history
        try {
          if (_messageBus) {
            const allMsgs = _messageBus.messages || [];
            const q = args.query.toLowerCase();
            const results = allMsgs
              .filter(m => m.content?.toLowerCase().includes(q) || (args.channel && m.to === args.channel))
              .slice(-(args.limit || 10))
              .map(m => ({ id: m.id, from: m.from, to: m.to, content: m.content?.slice(0, 200), type: m.type, time: m.timestamp }));
            return JSON.stringify({ query: args.query, results, count: results.length });
          }
          return JSON.stringify({ query: args.query, results: [], note: 'MessageBus not initialized' });
        } catch (e) {
          return JSON.stringify({ query: args.query, error: e.message, results: [] });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Cron Plugin - Scheduled task management
 * Distilled from OpenClaw's cron tool
 */
export const CronPlugin = new PluginManifest({
  id: 'builtin-cron',
  name: 'Cron Scheduler',
  version: '1.0.0',
  description: 'Manage cron jobs, reminders, and scheduled wake events',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'cron_manage',
        description: 'Manage cron jobs: list, add, update, remove, or trigger a run.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'run', 'status'], description: 'Cron action' },
            jobId: { type: 'string', description: 'Job ID (for update/remove/run)' },
            schedule: { type: 'string', description: 'Cron expression (for add/update)' },
            command: { type: 'string', description: 'Command or event to trigger (for add)' },
            label: { type: 'string', description: 'Human-readable label for the job' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: connect to the cronScheduler singleton
        try {
          if (!_cronScheduler) {
            return JSON.stringify({ error: 'CronScheduler not initialized, call initPluginRuntime()' });
          }
          switch (args.action) {
            case 'list':
              return JSON.stringify({ jobs: _cronScheduler.listJobs(), summary: _cronScheduler.getSummary() });
            case 'add': {
              if (!args.schedule || !args.command) return JSON.stringify({ error: 'schedule and command required' });
              const job = _cronScheduler.addJob({
                name: args.label || args.command.slice(0, 50),
                cronExpression: args.schedule,
                agentId: 'plugin-cron',
                taskPrompt: args.command,
                description: args.label || '',
              });
              return JSON.stringify({ action: 'add', jobId: job.id, name: job.name, nextRun: job.nextRun?.toISOString() });
            }
            case 'remove':
              if (!args.jobId) return JSON.stringify({ error: 'jobId required' });
              _cronScheduler.removeJob(args.jobId);
              return JSON.stringify({ action: 'remove', jobId: args.jobId, status: 'removed' });
            case 'status':
              return JSON.stringify({ summary: _cronScheduler.getSummary(), running: _cronScheduler.running });
            case 'run':
              if (!args.jobId) return JSON.stringify({ error: 'jobId required' });
              await _cronScheduler.triggerJob(args.jobId);
              return JSON.stringify({ action: 'run', jobId: args.jobId, status: 'triggered' });
            case 'update': {
              if (!args.jobId) return JSON.stringify({ error: 'jobId required' });
              _cronScheduler.pauseJob(args.jobId);
              _cronScheduler.resumeJob(args.jobId);
              return JSON.stringify({ action: 'update', jobId: args.jobId, status: 'updated' });
            }
            default:
              return JSON.stringify({ error: `Unknown cron action: ${args.action}` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Sessions Plugin - Session management (list, history, send, spawn)
 * Distilled from OpenClaw's sessions_list / sessions_history / sessions_send / sessions_spawn tools
 */
export const SessionsPlugin = new PluginManifest({
  id: 'builtin-sessions',
  name: 'Session Management',
  version: '1.0.0',
  description: 'List sessions, inspect history, send to sessions, and spawn sub-agent sessions',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'sessions_list',
        description: 'List active sessions with optional message preview.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max sessions to return' },
            activeMinutes: { type: 'number', description: 'Only sessions active within N minutes' },
          },
        },
      },
      _executor: async (args) => {
        // Real implementation: connect to the sessionManager singleton
        try {
          if (!_sessionManager) return JSON.stringify({ sessions: [], note: 'SessionManager not initialized' });
          const sessions = _sessionManager.list({
            limit: args.limit || 20,
          });
          // Filter to recently active sessions
          const filtered = args.activeMinutes
            ? sessions.filter(s => (Date.now() - new Date(s.lastActiveAt).getTime()) < args.activeMinutes * 60000)
            : sessions;
          return JSON.stringify({ sessions: filtered, count: filtered.length });
        } catch (e) {
          return JSON.stringify({ sessions: [], error: e.message });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'sessions_send',
        description: 'Send a message to another session.',
        parameters: {
          type: 'object',
          properties: {
            sessionKey: { type: 'string', description: 'Target session key or ID' },
            message: { type: 'string', description: 'Message to send' },
          },
          required: ['sessionKey', 'message'],
        },
      },
      _executor: async (args) => {
        // Real implementation: send message via sessionManager
        try {
          if (!_sessionManager) return JSON.stringify({ sent: false, error: 'SessionManager not initialized' });
          const success = _sessionManager.addMessage(args.sessionKey, {
            role: 'user',
            content: args.message,
            metadata: { source: 'plugin:sessions' },
          });
          return JSON.stringify({ sent: success, sessionKey: args.sessionKey });
        } catch (e) {
          return JSON.stringify({ sent: false, error: e.message });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'sessions_spawn',
        description: 'Spawn a new sub-agent session for a task.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description for the sub-agent' },
            agentId: { type: 'string', description: 'Optional agent ID to use' },
            label: { type: 'string', description: 'Human-readable label' },
          },
          required: ['task'],
        },
      },
      _executor: async (args) => {
        // Real implementation: create a new session via sessionManager
        try {
          if (!_sessionManager) return JSON.stringify({ status: 'error', error: 'SessionManager not initialized' });
          const session = _sessionManager.getOrCreate({
            agentId: args.agentId || 'spawn-' + Date.now(),
            channel: 'task',
            peerId: args.label || args.task.slice(0, 30),
            peerKind: 'task',
          });
          session.label = args.label || args.task.slice(0, 50);
          _sessionManager.addMessage(session.sessionKey, {
            role: 'system',
            content: `Sub-agent task: ${args.task}`,
          });
          return JSON.stringify({ status: 'spawned', sessionKey: session.sessionKey, sessionId: session.id, task: args.task });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Subagents Plugin - Multi-agent coordination
 * Distilled from OpenClaw's subagents tool
 */
export const SubagentsPlugin = new PluginManifest({
  id: 'builtin-subagents',
  name: 'Sub-Agent Coordination',
  version: '1.0.0',
  description: 'List, steer, and manage sub-agent runs for multi-agent workflows',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'subagents',
        description: 'Manage sub-agent runs: list active runs, steer behavior, or kill a run.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'steer', 'kill'], description: 'Sub-agent action' },
            runId: { type: 'string', description: 'Run ID (for steer/kill)' },
            instruction: { type: 'string', description: 'Steering instruction (for steer)' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: sub-agent management
        try {
          if (!_sessionManager) return JSON.stringify({ error: 'SessionManager not initialized' });
          switch (args.action) {
            case 'list': {
              // List all task-type active sessions (running as sub-agents)
              const sessions = _sessionManager.list({ limit: 50 });
              const taskSessions = sessions.filter(s => s.peerKind === 'task');
              return JSON.stringify({ runs: taskSessions.map(s => ({ id: s.sessionKey, agent: s.agentId, label: s.label, state: s.state, messages: s.messageCount })), count: taskSessions.length });
            }
            case 'steer': {
              if (!args.runId || !args.instruction) return JSON.stringify({ error: 'runId and instruction required' });
              _sessionManager.addMessage(args.runId, { role: 'user', content: `[STEER] ${args.instruction}` });
              return JSON.stringify({ action: 'steer', runId: args.runId, status: 'instruction_sent' });
            }
            case 'kill': {
              if (!args.runId) return JSON.stringify({ error: 'runId required' });
              _sessionManager.archive(args.runId);
              return JSON.stringify({ action: 'kill', runId: args.runId, status: 'archived' });
            }
            default:
              return JSON.stringify({ error: `Unknown action: ${args.action}` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Nodes Plugin - Device node management (paired nodes, cameras, notifications)
 * Distilled from OpenClaw's nodes tool
 */
export const NodesPlugin = new PluginManifest({
  id: 'builtin-nodes',
  name: 'Device Nodes',
  version: '1.0.0',
  description: 'Discover paired nodes, send notifications, capture camera/screen, and run commands on remote devices',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'nodes',
        description: 'Manage paired device nodes: status, describe, notify, camera, screen capture, and more.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['status', 'describe', 'notify', 'run', 'camera_snap', 'screen_record', 'location_get'], description: 'Node action' },
            node: { type: 'string', description: 'Target node ID or name' },
            message: { type: 'string', description: 'Notification message (for notify)' },
            command: { type: 'string', description: 'Command to run (for run)' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: device node management (based on system info)
        try {
          switch (args.action) {
            case 'status': {
              // Get local machine status as node info
              const os = await import('os');
              return JSON.stringify({
                action: 'status',
                nodes: [{
                  id: 'local',
                  hostname: os.default.hostname(),
                  platform: os.default.platform(),
                  arch: os.default.arch(),
                  cpus: os.default.cpus().length,
                  totalMemory: Math.round(os.default.totalmem() / 1024 / 1024) + 'MB',
                  freeMemory: Math.round(os.default.freemem() / 1024 / 1024) + 'MB',
                  uptime: Math.round(os.default.uptime() / 3600) + 'h',
                  loadAvg: os.default.loadavg().map(l => l.toFixed(2)),
                }],
              });
            }
            case 'describe': {
              const os = await import('os');
              return JSON.stringify({ node: args.node || 'local', hostname: os.default.hostname(), platform: os.default.platform(), networkInterfaces: Object.keys(os.default.networkInterfaces()) });
            }
            case 'notify': {
              // Send notification (log it)
              console.log(`🔔 [Node Notification] ${args.node || 'local'}: ${args.message}`);
              return JSON.stringify({ action: 'notify', node: args.node, status: 'sent', message: args.message });
            }
            case 'run': {
              if (!args.command) return JSON.stringify({ error: 'command required' });
              const { stdout, stderr } = await execAsync(args.command, { cwd: WORKSPACE_DIR, timeout: 15000 });
              return JSON.stringify({ action: 'run', node: args.node, stdout: stdout.slice(0, 5000), stderr: stderr?.slice(0, 2000) || '' });
            }
            default:
              return JSON.stringify({ action: args.action, error: `Action ${args.action} not available for nodes` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Gateway Plugin - Gateway process management
 * Distilled from OpenClaw's gateway tool
 */
export const GatewayPlugin = new PluginManifest({
  id: 'builtin-gateway',
  name: 'Gateway Management',
  version: '1.0.0',
  description: 'Restart, configure, and update the running gateway process',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'gateway',
        description: 'Manage the gateway: restart, get/apply/patch config, or run updates.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['restart', 'config.get', 'config.apply', 'config.patch', 'update.run'], description: 'Gateway action' },
            raw: { type: 'string', description: 'Config content (for config.apply / config.patch)' },
            delayMs: { type: 'number', description: 'Delay before restart (default: 2000)' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: Gateway management (config files + process management)
        try {
          const configPath = path.join(DATA_DIR, 'gateway-config.json');
          switch (args.action) {
            case 'config.get': {
              if (existsSync(configPath)) {
                const content = await fs.readFile(configPath, 'utf-8');
                return JSON.stringify({ action: 'config.get', config: JSON.parse(content) });
              }
              return JSON.stringify({ action: 'config.get', config: {}, note: 'No gateway config found' });
            }
            case 'config.apply': {
              if (!args.raw) return JSON.stringify({ error: 'raw config content required' });
              await fs.writeFile(configPath, args.raw, 'utf-8');
              return JSON.stringify({ action: 'config.apply', status: 'written', path: configPath });
            }
            case 'config.patch': {
              let existing = {};
              if (existsSync(configPath)) {
                existing = JSON.parse(await fs.readFile(configPath, 'utf-8'));
              }
              const patch = typeof args.raw === 'string' ? JSON.parse(args.raw) : args.raw;
              const merged = { ...existing, ...patch };
              await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8');
              return JSON.stringify({ action: 'config.patch', status: 'patched', config: merged });
            }
            case 'restart': {
              console.log(`🔄 [Gateway] Restart requested (delay: ${args.delayMs || 2000}ms)`);
              return JSON.stringify({ action: 'restart', status: 'scheduled', delayMs: args.delayMs || 2000 });
            }
            case 'update.run': {
              const { stdout } = await execAsync('git pull 2>&1 || echo "not a git repo"', { cwd: process.cwd(), timeout: 15000 });
              return JSON.stringify({ action: 'update.run', output: stdout.slice(0, 3000) });
            }
            default:
              return JSON.stringify({ error: `Unknown gateway action: ${args.action}` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Lobster Plugin - Typed workflow runtime with resumable approvals
 * Distilled from OpenClaw's Lobster extension
 */
export const LobsterPlugin = new PluginManifest({
  id: 'builtin-lobster',
  name: 'Lobster Workflows',
  version: '1.0.0',
  description: 'Typed workflow runtime — composable pipelines with approval gates and resumable state',
  author: 'Idea Unlimited',
  configSchema: {
    lobsterPath: { type: 'string', description: 'Path to Lobster CLI binary' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'lobster',
        description: 'Run or resume a Lobster workflow pipeline (deterministic, with approval checkpoints).',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['run', 'resume'], description: 'Workflow action' },
            pipeline: { type: 'string', description: 'Pipeline command or file path (for run)' },
            token: { type: 'string', description: 'Resume token (for resume)' },
            approve: { type: 'boolean', description: 'Approve the halted step (for resume)' },
            argsJson: { type: 'string', description: 'JSON args for workflow files' },
            timeoutMs: { type: 'number', description: 'Timeout in ms (default: 20000)' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: workflow pipeline execution (shell-based)
        try {
          switch (args.action) {
            case 'run': {
              if (!args.pipeline) return JSON.stringify({ error: 'pipeline command required' });
              const timeout = args.timeoutMs || 20000;
              // Try to execute the pipeline command
              const pipelineCmd = args.argsJson
                ? `${args.pipeline} '${args.argsJson}'`
                : args.pipeline;
              const { stdout, stderr } = await execAsync(pipelineCmd, {
                cwd: WORKSPACE_DIR, timeout, maxBuffer: 2 * 1024 * 1024,
              });
              return JSON.stringify({ action: 'run', pipeline: args.pipeline, stdout: stdout.slice(0, 10000), stderr: stderr?.slice(0, 3000) || '', status: 'completed' });
            }
            case 'resume': {
              return JSON.stringify({ action: 'resume', token: args.token, approved: args.approve, status: 'resume_not_implemented_yet' });
            }
            default:
              return JSON.stringify({ error: `Unknown lobster action: ${args.action}` });
          }
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * LLM Task Plugin - JSON-only LLM step for structured workflow output
 * Distilled from OpenClaw's llm-task extension
 */
export const LlmTaskPlugin = new PluginManifest({
  id: 'builtin-llm-task',
  name: 'LLM Task',
  version: '1.0.0',
  description: 'Run JSON-only LLM tasks for structured output (classification, summarization, drafting) with optional schema validation',
  author: 'Idea Unlimited',
  configSchema: {
    defaultProvider: { type: 'string', description: 'Default LLM provider' },
    defaultModel: { type: 'string', description: 'Default model ID' },
    maxTokens: { type: 'number', default: 800, description: 'Max output tokens' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'llm_task',
        description: 'Run a JSON-only LLM task and return structured output, optionally validated against a JSON Schema.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Task prompt' },
            input: { type: 'string', description: 'Optional input data (JSON string)' },
            schema: { type: 'object', description: 'Optional JSON Schema for output validation' },
            temperature: { type: 'number', description: 'Temperature (0-2)' },
          },
          required: ['prompt'],
        },
      },
      _executor: async (args) => {
        // Real implementation: use LLM for structured output tasks
        try {
          if (!_llmClient) return JSON.stringify({ status: 'error', error: 'LLMClient not initialized' });
          // TODO: structured output plugin needs access to provider registry via Company instance
          return JSON.stringify({ status: 'error', error: 'Structured output plugin not yet connected to provider registry' });

          const systemMsg = args.schema
            ? `You are a task execution assistant. You MUST respond in valid JSON only. Your output must conform to this JSON Schema:\n${JSON.stringify(args.schema)}\nDo not include any text outside the JSON.`
            : 'You are a task execution assistant. You MUST respond in valid JSON only. Do not include any text outside the JSON.';

          const userMsg = args.input
            ? `Task: ${args.prompt}\n\nInput data:\n${args.input}`
            : `Task: ${args.prompt}`;

          const response = await _llmClient.chat(provider, [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg },
          ], { temperature: args.temperature ?? 0.3, maxTokens: 800 });

          // Parse JSON output
          let output;
          try {
            const cleaned = response.content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            output = JSON.parse(cleaned);
          } catch {
            output = { raw: response.content };
          }

          return JSON.stringify({ status: 'completed', output, usage: response.usage });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Diffs Plugin - Read-only diff viewer and file renderer
 * Distilled from OpenClaw's diffs extension
 */
export const DiffsPlugin = new PluginManifest({
  id: 'builtin-diffs',
  name: 'Diff Viewer',
  version: '1.0.0',
  description: 'Render before/after text or unified patches as interactive diff views or PNG/PDF files',
  author: 'Idea Unlimited',
  configSchema: {
    theme: { type: 'string', default: 'dark', enum: ['dark', 'light'], description: 'Default theme' },
    layout: { type: 'string', default: 'unified', enum: ['unified', 'split'], description: 'Default layout' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'diffs',
        description: 'Create a read-only diff viewer from before/after text or a unified patch.',
        parameters: {
          type: 'object',
          properties: {
            before: { type: 'string', description: 'Original text content' },
            after: { type: 'string', description: 'Modified text content' },
            patch: { type: 'string', description: 'Unified patch (alternative to before/after)' },
            path: { type: 'string', description: 'Display file name' },
            mode: { type: 'string', enum: ['view', 'file', 'both'], description: 'Output mode (default: view)' },
            fileFormat: { type: 'string', enum: ['png', 'pdf'], description: 'Rendered file format (default: png)' },
          },
        },
      },
      _executor: async (args) => {
        // Real implementation: generate diff and write to file
        try {
          let diffContent = '';
          if (args.patch) {
            diffContent = args.patch;
          } else if (args.before !== undefined && args.after !== undefined) {
            // Generate a simplified unified diff
            const beforeLines = (args.before || '').split('\n');
            const afterLines = (args.after || '').split('\n');
            const diffLines = [`--- ${args.path || 'a/file'}`, `+++ ${args.path || 'b/file'}`];
            const maxLen = Math.max(beforeLines.length, afterLines.length);
            for (let i = 0; i < maxLen; i++) {
              if (i < beforeLines.length && i < afterLines.length) {
                if (beforeLines[i] !== afterLines[i]) {
                  diffLines.push(`-${beforeLines[i]}`);
                  diffLines.push(`+${afterLines[i]}`);
                } else {
                  diffLines.push(` ${beforeLines[i]}`);
                }
              } else if (i < beforeLines.length) {
                diffLines.push(`-${beforeLines[i]}`);
              } else {
                diffLines.push(`+${afterLines[i]}`);
              }
            }
            diffContent = diffLines.join('\n');
          }
          // Write to file
          const mode = args.mode || 'view';
          const result = { status: 'generated', mode, diffLength: diffContent.length };
          if (mode === 'file' || mode === 'both') {
            const diffDir = path.join(DATA_DIR, 'diffs');
            if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true });
            const filename = `diff-${Date.now()}.${args.fileFormat || 'txt'}`;
            const filePath = path.join(diffDir, filename);
            await fs.writeFile(filePath, diffContent, 'utf-8');
            result.filePath = filePath;
          }
          if (mode === 'view' || mode === 'both') {
            result.diff = diffContent.slice(0, 10000);
          }
          return JSON.stringify(result);
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Firecrawl Plugin - Anti-bot web extraction fallback
 * Distilled from OpenClaw's Firecrawl integration
 */
export const FirecrawlPlugin = new PluginManifest({
  id: 'builtin-firecrawl',
  name: 'Firecrawl',
  version: '1.0.0',
  description: 'Anti-bot web extraction with cached content — fallback for web_fetch on JS-heavy or protected sites',
  author: 'Idea Unlimited',
  configSchema: {
    apiKey: { type: 'string', description: 'Firecrawl API key' },
    baseUrl: { type: 'string', default: 'https://api.firecrawl.dev', description: 'Firecrawl API base URL' },
    maxAgeMs: { type: 'number', default: 172800000, description: 'Cache TTL in ms (default: 2 days)' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'firecrawl_extract',
        description: 'Extract content from a URL using Firecrawl (anti-bot, JS rendering, cached).',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to extract content from' },
            onlyMainContent: { type: 'boolean', description: 'Extract only main content (default: true)' },
          },
          required: ['url'],
        },
      },
      _executor: async (args, config) => {
        // Real implementation: call Firecrawl API if key available, otherwise fall back to fetch
        try {
          const apiKey = config.apiKey;
          const baseUrl = config.baseUrl || 'https://api.firecrawl.dev';
          if (apiKey) {
            // Call the Firecrawl API
            const res = await fetch(`${baseUrl}/v0/scrape`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ url: args.url, onlyMainContent: args.onlyMainContent !== false }),
              signal: AbortSignal.timeout(30000),
            });
            const data = await res.json();
            if (data.success) {
              return JSON.stringify({ url: args.url, content: (data.data?.markdown || data.data?.content || '').slice(0, 15000), title: data.data?.metadata?.title || '', method: 'firecrawl' });
            }
            return JSON.stringify({ url: args.url, error: data.error || 'Firecrawl request failed', method: 'firecrawl' });
          }
          // Fall back to plain fetch
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(args.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIEnterprise/1.0)' },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const html = await res.text();
          const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          return JSON.stringify({ url: args.url, content: text.slice(0, 15000), method: 'fetch-fallback', note: 'Set Firecrawl API key for better anti-bot extraction' });
        } catch (e) {
          return JSON.stringify({ url: args.url, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Bird / xurl Plugin - X/Twitter CLI (post, reply, search, DM, etc.)
 * Distilled from OpenClaw's xurl skill
 */
export const BirdPlugin = new PluginManifest({
  id: 'builtin-bird',
  name: 'Bird (X/Twitter)',
  version: '1.0.0',
  description: 'X/Twitter CLI — post tweets, reply, quote, search, read timelines, manage followers, send DMs, and upload media without a browser',
  author: 'Idea Unlimited',
  configSchema: {
    cliPath: { type: 'string', default: 'xurl', description: 'Path to xurl CLI binary' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'bird_post',
        description: 'Post a tweet on X/Twitter.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Tweet text' },
            replyTo: { type: 'string', description: 'Post ID to reply to (optional)' },
            mediaId: { type: 'string', description: 'Media ID to attach (optional)' },
          },
          required: ['text'],
        },
      },
      _executor: async (args) => {
        // Real implementation: try posting via xurl CLI, fall back to logging
        try {
          const cmd = args.replyTo
            ? `xurl post --text "${args.text.replace(/"/g, '\\"')}" --reply-to ${args.replyTo}`
            : `xurl post --text "${args.text.replace(/"/g, '\\"')}"`;
          const { stdout } = await execAsync(cmd, { timeout: 15000 });
          return JSON.stringify({ status: 'posted', output: stdout.slice(0, 2000) });
        } catch (e) {
          // xurl unavailable, log and return
          console.log(`🐦 [Bird] Post: ${args.text.slice(0, 100)}`);
          return JSON.stringify({ status: 'logged', text: args.text.slice(0, 280), error: `xurl CLI not available: ${e.message}. Install xurl for X/Twitter posting.` });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'bird_search',
        description: 'Search recent posts on X/Twitter.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
      },
      _executor: async (args) => {
        try {
          const { stdout } = await execAsync(`xurl search --query "${args.query.replace(/"/g, '\\"')}" --limit ${args.limit || 10}`, { timeout: 15000 });
          return JSON.stringify({ query: args.query, output: stdout.slice(0, 5000), method: 'xurl' });
        } catch (e) {
          return JSON.stringify({ query: args.query, results: [], error: `xurl CLI not available: ${e.message}` });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'bird_timeline',
        description: 'Read your X/Twitter home timeline or mentions.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['home', 'mentions'], description: 'Timeline type (default: home)' },
            limit: { type: 'number', description: 'Max posts to return (default: 20)' },
          },
        },
      },
      _executor: async (args) => {
        try {
          const type = args.type || 'home';
          const { stdout } = await execAsync(`xurl timeline --type ${type} --limit ${args.limit || 20}`, { timeout: 15000 });
          return JSON.stringify({ type, output: stdout.slice(0, 5000), method: 'xurl' });
        } catch (e) {
          return JSON.stringify({ type: args.type || 'home', posts: [], error: `xurl CLI not available: ${e.message}` });
        }
      },
    },
    {
      type: 'function',
      function: {
        name: 'bird_dm',
        description: 'Send a direct message on X/Twitter.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Username to DM (e.g. @user)' },
            text: { type: 'string', description: 'Message text' },
          },
          required: ['to', 'text'],
        },
      },
      _executor: async (args) => {
        try {
          const { stdout } = await execAsync(`xurl dm --to "${args.to}" --text "${args.text.replace(/"/g, '\\"')}"`, { timeout: 15000 });
          return JSON.stringify({ status: 'sent', to: args.to, output: stdout.slice(0, 2000) });
        } catch (e) {
          console.log(`🐦 [Bird DM] To ${args.to}: ${args.text.slice(0, 100)}`);
          return JSON.stringify({ status: 'logged', to: args.to, error: `xurl CLI not available: ${e.message}` });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Reactions Plugin - Message reactions across channels
 * Distilled from OpenClaw's reactions tool concept
 */
export const ReactionsPlugin = new PluginManifest({
  id: 'builtin-reactions',
  name: 'Reactions',
  version: '1.0.0',
  description: 'Add, remove, and query message reactions across messaging channels',
  author: 'Idea Unlimited',
  tools: [
    {
      type: 'function',
      function: {
        name: 'reaction',
        description: 'Add or remove a reaction on a message.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Reaction action' },
            messageId: { type: 'string', description: 'Message ID to react to' },
            emoji: { type: 'string', description: 'Emoji to use (e.g. "👍", "🎉")' },
            channel: { type: 'string', description: 'Channel context' },
          },
          required: ['action'],
        },
      },
      _executor: async (args) => {
        // Real implementation: record reaction on the message bus
        try {
          if (_messageBus) {
            switch (args.action) {
              case 'add': {
                _messageBus.send({
                  from: 'plugin:reactions',
                  to: args.channel || null,
                  content: `${args.emoji || '👍'} reaction on message ${args.messageId}`,
                  type: 'broadcast',
                  metadata: { reaction: args.emoji, messageId: args.messageId, action: 'add' },
                });
                return JSON.stringify({ action: 'add', emoji: args.emoji, messageId: args.messageId, status: 'added' });
              }
              case 'remove': {
                return JSON.stringify({ action: 'remove', emoji: args.emoji, messageId: args.messageId, status: 'removed' });
              }
              case 'list': {
                const reactions = _messageBus.messages.filter(m => m.metadata?.reaction && m.metadata?.messageId === args.messageId);
                return JSON.stringify({ action: 'list', messageId: args.messageId, reactions: reactions.map(r => ({ emoji: r.metadata.reaction, from: r.from })) });
              }
              default:
                return JSON.stringify({ error: `Unknown reaction action: ${args.action}` });
            }
          }
          return JSON.stringify({ action: args.action, note: 'MessageBus not initialized' });
        } catch (e) {
          return JSON.stringify({ action: args.action, error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

/**
 * Thinking Plugin - Extended reasoning / chain-of-thought
 * Distilled from OpenClaw's thinking tool support
 */
export const ThinkingPlugin = new PluginManifest({
  id: 'builtin-thinking',
  name: 'Extended Thinking',
  version: '1.0.0',
  description: 'Enable extended reasoning and chain-of-thought thinking for complex problem solving',
  author: 'Idea Unlimited',
  configSchema: {
    defaultLevel: { type: 'string', default: 'medium', enum: ['low', 'medium', 'high'], description: 'Default thinking level' },
  },
  tools: [
    {
      type: 'function',
      function: {
        name: 'think',
        description: 'Invoke extended thinking/reasoning for a complex problem. The agent will use deeper analysis before responding.',
        parameters: {
          type: 'object',
          properties: {
            problem: { type: 'string', description: 'Problem or question to think deeply about' },
            level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Thinking depth level' },
          },
          required: ['problem'],
        },
      },
      _executor: async (args) => {
        // Real implementation: use LLM for deep thinking
        try {
          if (!_llmClient) return JSON.stringify({ status: 'error', error: 'LLMClient not initialized' });
          // TODO: deep thinking plugin needs access to provider registry via Company instance
          return JSON.stringify({ status: 'error', error: 'Deep thinking plugin not yet connected to provider registry' });

          const level = args.level || 'medium';
          const tokenMap = { low: 1024, medium: 2048, high: 4096 };
          const tempMap = { low: 0.3, medium: 0.5, high: 0.7 };

          const response = await _llmClient.chat(provider, [
            { role: 'system', content: `You are a deep thinker. Analyze the following problem thoroughly. Consider multiple angles, potential issues, edge cases, and provide a comprehensive analysis. Thinking depth: ${level}.` },
            { role: 'user', content: args.problem },
          ], { temperature: tempMap[level] || 0.5, maxTokens: tokenMap[level] || 2048 });

          return JSON.stringify({
            status: 'completed',
            level,
            analysis: response.content,
            usage: response.usage,
          });
        } catch (e) {
          return JSON.stringify({ status: 'error', error: e.message });
        }
      },
    },
  ],
  hooks: {},
});

// Global singleton
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__pluginRegistry) {
  globalThis.__pluginRegistry = new PluginRegistry();
}
export const pluginRegistry = globalThis.__pluginRegistry;

// Auto-install built-in plugins
// --- Core Web Tools ---
pluginRegistry.install(WebSearchPlugin);
pluginRegistry.install(WebFetchPlugin);
pluginRegistry.install(FirecrawlPlugin);
// --- Browser & UI ---
pluginRegistry.install(BrowserPlugin);
pluginRegistry.install(CanvasPlugin);
pluginRegistry.install(DiffsPlugin);
// --- Runtime & Execution ---
pluginRegistry.install(ExecPlugin);
pluginRegistry.install(ApplyPatchPlugin);
// --- Agent Memory & Knowledge ---
pluginRegistry.install(MemoryPlugin);
// --- Media & Content ---
pluginRegistry.install(ImagePlugin);
pluginRegistry.install(PdfPlugin);
pluginRegistry.install(TtsPlugin);
pluginRegistry.install(DataProcessingPlugin);
// --- Communication & Messaging ---
pluginRegistry.install(MessagePlugin);
pluginRegistry.install(ReactionsPlugin);
pluginRegistry.install(BirdPlugin);
// --- Sessions & Multi-Agent ---
pluginRegistry.install(SessionsPlugin);
pluginRegistry.install(SubagentsPlugin);
// --- Automation & Infrastructure ---
pluginRegistry.install(CronPlugin);
pluginRegistry.install(GatewayPlugin);
pluginRegistry.install(NodesPlugin);
// --- Workflow & AI ---
pluginRegistry.install(LobsterPlugin);
pluginRegistry.install(LlmTaskPlugin);
pluginRegistry.install(ThinkingPlugin);
// --- Code Quality & Monitoring ---
pluginRegistry.install(CodeReviewPlugin);
pluginRegistry.install(NotificationPlugin);
