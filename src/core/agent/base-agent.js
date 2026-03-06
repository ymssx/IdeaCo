/**
 * BaseAgent — Pure communication engine.
 *
 * This layer ONLY handles: sending/receiving messages via LLM or CLI,
 * provider management, and availability checks.
 *
 * All business logic (identity, memory, personality, tasks, performance,
 * org structure, serialization) lives in the Employee layer above.
 *
 * Subclasses: LLMAgent, CLIAgent
 */
export class BaseAgent {
  constructor() {
    if (new.target === BaseAgent) {
      throw new Error('BaseAgent is abstract — use LLMAgent or CLIAgent');
    }
  }

  // ======================== Abstract Methods ========================

  /** @returns {string} 'llm' | 'cli' */
  get agentType() {
    throw new Error('Subclass must implement get agentType()');
  }

  /** Whether this agent can execute tasks. @returns {boolean} */
  isAvailable() {
    throw new Error('Subclass must implement isAvailable()');
  }

  /** Whether this agent can do lightweight LLM-style chat. @returns {boolean} */
  canChat() {
    throw new Error('Subclass must implement canChat()');
  }

  /**
   * Send a chat request.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options] - { temperature, maxTokens }
   * @returns {Promise<{content: string, usage: object|null}>}
   */
  async chat(messages, options = {}) {
    throw new Error('Subclass must implement chat()');
  }

  /**
   * Send a chat request with tool calling support.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} toolExecutor - AgentToolKit instance
   * @param {object} [options]
   * @returns {Promise<{content: string, toolResults: Array, usage: object|null}>}
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    throw new Error('Subclass must implement chatWithTools()');
  }

  /**
   * Get display info about the agent's execution engine.
   * @returns {{ name: string, provider: string, model: string, type: string }}
   */
  getDisplayInfo() {
    throw new Error('Subclass must implement getDisplayInfo()');
  }

  /**
   * Get the provider display info for frontend rendering.
   * @returns {{ id: string, name: string, provider: string }}
   */
  getProviderDisplayInfo() {
    throw new Error('Subclass must implement getProviderDisplayInfo()');
  }

  /**
   * Get the fallback provider name (only meaningful for CLI agents).
   * @returns {string|null}
   */
  getFallbackProviderName() {
    return null;
  }

  /**
   * Switch this agent's provider.
   * @param {object} newProvider - Provider config from ProviderRegistry
   */
  switchProvider(newProvider) {
    throw new Error('Subclass must implement switchProvider()');
  }

  /**
   * Serialize agent-level (communication) fields.
   * @returns {object}
   */
  serializeAgent() {
    throw new Error('Subclass must implement serializeAgent()');
  }

  /**
   * Get cost per token for this agent. Subclasses can override.
   * @returns {number}
   */
  getCostPerToken() {
    return 0.001;
  }
}
