/**
 * AI Enterprise Management System - Core Engine Entry
 * Exports all core modules
 */

export { Company } from './organization/company.js';
export { createAgent, deserializeAgent, BaseAgent, LLMAgent, CLIAgent } from './agent/index.js';
export { Employee, createEmployee, deserializeEmployee, Secretary, HRAssistant } from './employee/index.js';
export { Department } from './organization/department.js';
export { HRSystem, JobTemplates } from './organization/workforce/hr.js';
export { ProviderRegistry, ModelProviders, JobCategory, JobCategoryLabel } from './organization/workforce/providers.js';
export { Memory } from './employee/memory/index.js';
export { PerformanceSystem, PerformanceReview, PerformanceDimensions, PerformanceLevel } from './employee/performance.js';
export { TalentMarket } from './organization/workforce/talent-market.js';
export { LLMClient, llmClient } from './agent/llm-agent/client.js';
export { AgentToolKit } from './agent/tools.js';
export { MessageBus, Message, MessageType } from './agent/message-bus.js';
export { WorkspaceManager } from './workspace.js';
export { saveState, loadState, clearState, debouncedSave } from './organization/persistence.js';
export { saveAgentMemory, loadAgentMemory, saveAllAgentMemories, deleteAgentMemory, listMemoryFiles, clearAllMemories } from './employee/memory/store.js';

// Distilled modules (inspired by OpenClaw - see THIRD-PARTY-NOTICES.md)
export { AuditLogger, SecurityGuard, auditLogger, securityGuard, AuditLevel, AuditCategory } from './system/audit.js';
export { PluginRegistry, pluginRegistry, PluginManifest, HookPoint, PluginState, initPluginRuntime } from './system/plugin.js';
export { CronScheduler, cronScheduler, JobStatus, parseCronExpression } from './system/cron.js';
export { HookRegistry, hookRegistry, HookEvent, HookEventType, createHookEvent } from '../lib/hooks.js';
export { SessionManager, sessionManager, SessionState, SendPolicy, buildSessionKey } from './agent/session.js';
export { ConfigValidator, configValidator, ConfigType, enterpriseConfigSchema } from '../lib/config-validator.js';
export { SkillRegistry, skillRegistry, SkillDefinition, SkillCategory, SkillState, SkillSource, parseSkillMarkdown } from './employee/skill/index.js';
export { EmployeeSkillSet } from './employee/skill/index.js';
export { CustomSkillManager, customSkillManager } from './employee/skill/index.js';
export { SkillMarketplace, skillMarketplace } from './employee/skill/index.js';
export { KnowledgeManager, knowledgeManager, KnowledgeType, EntryType } from './employee/knowledge.js';
export { ChatStore, chatStore } from './agent/chat-store.js';
export { CLIBackendRegistry, cliBackendRegistry, CLIBackendState } from './agent/cli-agent/backends/index.js';
export { GroupChatLoop, groupChatLoop } from './organization/group-chat-loop.js';
export { TeamManager, Team, Sprint, SprintStatus } from './organization/team.js';
// Prompt locale is now English-only (see core/prompts.js).
// Kept as no-op stubs for API backward compatibility.
export function setPromptLocale(_locale) { /* no-op: English only */ }
export function getPromptLocaleCode() { return 'en'; }
