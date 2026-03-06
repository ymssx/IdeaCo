/**
 * DEPRECATED: Brain abstraction has been merged into the Agent subclass hierarchy.
 * 
 * - LLMBrain logic → LLMAgent (./agent/llm-agent.js)
 * - CLIBrain logic → CLIAgent (./agent/cli-agent.js)
 * 
 * This file is kept only for backward compatibility of any external references.
 */

// No-op exports for backward compatibility
export class AgentBrain {
  static deserialize() { return null; }
}
export class LLMBrain extends AgentBrain {}
export class CLIBrain extends AgentBrain {}
