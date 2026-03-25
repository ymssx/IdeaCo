/**
 * ToolLoop — Unified agent tool execution loop.
 *
 * Extracts the common tool-call cycle from LLMClient / WebAgent / CLIAgent
 * into a single reusable class. All agents delegate to ToolLoop instead of
 * each implementing their own loop.
 *
 * Features:
 * - Supports both native tool_calls (OpenAI API) and embedded markup (DSML/XML/```tool_call```)
 * - Supports JSON actions protocol (structured JSON with "actions" array)
 * - Parallel execution for read-only tools (Promise.allSettled)
 * - Tool tiering with auto-escalation (progressive disclosure)
 * - Callbacks for UI progress (onToolCall, onLLMCall)
 * - Configurable max iterations and tool tier sets
 */

import { logLLMCall } from '../system/llm-debug-logger.js';

// ======================== Tool Tier Definitions ========================

/**
 * Tool tiers for progressive disclosure.
 * Lower tiers are always available; higher tiers are unlocked on demand.
 */
export const TOOL_TIERS = {
  // Tier 0: Always available — read-only + skill loading
  core: [
    'file_read', 'file_list', 'file_stats', 'file_search',
    'workspace_files', 'load_skill', 'grep_search', 'glob_search',
    // Management read-only tools (permission-gated via AgentToolKit)
    'query_department', 'list_departments', 'list_talent_market', 'list_job_templates',
  ],
  // Tier 1: Write tools — unlocked when task requires file mutation
  write: [
    'file_write', 'file_append', 'file_patch', 'file_delete',
    'multi_patch', 'mkdir',
    // Management write tools (permission-gated via AgentToolKit)
    'create_department', 'disband_department', 'assign_task',
  ],
  // Tier 2: Execution tools — unlocked when task needs shell/commands
  exec: [
    'shell_exec',
  ],
  // Tier 3: Collaboration tools — unlocked when task involves team communication
  social: [
    'send_message',
  ],
};

/**
 * Read-only tools that are safe to execute in parallel.
 * Write/exec tools are always executed serially to avoid races.
 */
const READ_ONLY_TOOLS = new Set([
  'file_read', 'file_list', 'file_stats', 'file_search',
  'workspace_files', 'grep_search', 'glob_search', 'load_skill',
  'query_department', 'list_departments', 'list_talent_market', 'list_job_templates',
]);

// ======================== Embedded Call Parsing ========================

/**
 * Parse JSON actions from a structured JSON response.
 * Detects when the LLM returns a JSON object with an "actions" array field
 * (the structured response protocol used in boss-chat and other scenarios).
 *
 * Returns { calls, fullJSON } where calls is the array of tool calls and
 * fullJSON is the parsed JSON object (so the caller can preserve it).
 *
 * @param {string} content - Raw LLM output text
 * @returns {{ calls: Array<{name: string, args: object}>, fullJSON: object } | null}
 */
function parseJSONActions(content) {
  if (!content) return null;
  const trimmed = content.trim();
  // Must look like a JSON object
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
      const calls = parsed.actions
        .filter(a => a && a.tool)
        .map(a => ({ name: a.tool, args: a.args || {} }));
      if (calls.length > 0) {
        return { calls, fullJSON: parsed };
      }
    }
  } catch {
    // Not valid JSON — fall through to other parsers
  }
  return null;
}

/**
 * Parse embedded tool calls from LLM content text.
 * Supports:
 *  - DeepSeek DSML format: <｜DSML｜function_calls>...<｜DSML｜invoke name="tool">...
 *  - Generic XML-style: <function_call>JSON</function_call>
 *  - <tool_call>JSON</tool_call>
 *  - ```tool_call blocks (WebAgent format)
 */
function parseEmbeddedToolCalls(content) {
  if (!content) return null;
  const calls = [];

  // 1. ```tool_call blocks (WebAgent format)
  const codeBlockRegex = /```tool_call\s*\n([\s\S]*?)```/g;
  let codeMatch;
  while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(codeMatch[1].trim());
      if (parsed.name) {
        calls.push({ name: parsed.name, args: parsed.args || parsed.arguments || {} });
      }
    } catch { /* skip malformed */ }
  }

  // 2. DSML format: <｜DSML｜function_calls> ... </｜DSML｜function_calls>
  const dsmlBlockRegex = /<[｜|]DSML[｜|]function_calls>([\s\S]*?)(?:<\/[｜|]DSML[｜|]function_calls>|$)/g;
  let blockMatch;
  while ((blockMatch = dsmlBlockRegex.exec(content)) !== null) {
    const block = blockMatch[1];
    const invokeRegex = /<[｜|]DSML[｜|]invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]invoke>|$)/g;
    let invokeMatch;
    while ((invokeMatch = invokeRegex.exec(block)) !== null) {
      const toolName = invokeMatch[1];
      const paramsBlock = invokeMatch[2];
      const args = {};
      const paramRegex = /<[｜|]DSML[｜|]parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]parameter>|$)/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
        const paramValue = paramMatch[2].trim();
        try { args[paramMatch[1]] = JSON.parse(paramValue); } catch { args[paramMatch[1]] = paramValue; }
      }
      if (toolName) calls.push({ name: toolName, args });
    }
  }

  // 3. Generic XML <function_call>JSON</function_call> and <tool_call>JSON</tool_call>
  for (const tag of ['function_call', 'tool_call']) {
    const xmlRegex = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'g');
    let xmlMatch;
    while ((xmlMatch = xmlRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(xmlMatch[1].trim());
        if (parsed.name) {
          calls.push({ name: parsed.name, args: parsed.arguments || parsed.args || {} });
        }
      } catch { /* skip malformed */ }
    }
  }

  return calls.length > 0 ? calls : null;
}

/**
 * Strip tool-call markup from LLM output content.
 * Removes DSML blocks, <function_call>, <tool_call>, ```tool_call``` etc.
 */
function stripToolCallMarkup(text) {
  if (!text) return '';
  let cleaned = text;
  // DSML blocks (complete - closed tags)
  cleaned = cleaned.replace(/<[｜|]DSML[｜|]function_calls>[\s\S]*?<\/[｜|]DSML[｜|]function_calls>/g, '');
  cleaned = cleaned.replace(/<\|DSML\|function_calls>[\s\S]*?<\/\|DSML\|function_calls>/g, '');
  // Trailing incomplete DSML blocks
  cleaned = cleaned.replace(/<[｜|]DSML[｜|]function_calls>(?=[\s\S]*<[｜|]DSML[｜|]invoke)[\s\S]*$/g, '');
  cleaned = cleaned.replace(/<\|DSML\|function_calls>(?=[\s\S]*<\|DSML\|invoke)[\s\S]*$/g, '');
  // Generic XML-style (closed)
  cleaned = cleaned.replace(/<function_call>[\s\S]*?<\/function_call>/g, '');
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // Trailing incomplete generic XML
  cleaned = cleaned.replace(/<function_call>\s*\{[\s\S]*$/g, '');
  cleaned = cleaned.replace(/<tool_call>\s*\{[\s\S]*$/g, '');
  // ```tool_call blocks
  cleaned = cleaned.replace(/```tool_call\s*\n[\s\S]*?```/g, '');
  return cleaned.trim();
}

/**
 * Build a human-readable summary from tool execution results.
 * Used as fallback when LLM returns empty content after tool calls.
 */
function summarizeToolResults(results) {
  if (!results || results.length === 0) return '';
  const parts = [];
  for (const r of results) {
    if (r.success && r.result != null) {
      const text = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
      if (text.trim()) parts.push(text.trim());
    } else if (!r.success && r.error) {
      parts.push(`⚠️ ${r.tool}: ${r.error}`);
    }
  }
  return parts.join('\n\n') || '';
}

// ======================== Tier Inference ========================

/**
 * Infer which tool tiers are needed based on task context text.
 * Returns a Set of tier names.
 *
 * @param {string} taskContext - Task description or system prompt text
 * @returns {Set<string>}
 */
export function inferTiersFromContext(taskContext) {
  const tiers = new Set(['core']); // core is always active
  if (!taskContext) {
    // No context — unlock all tiers for safety
    tiers.add('write');
    tiers.add('exec');
    tiers.add('social');
    return tiers;
  }

  const ctx = taskContext.toLowerCase();

  // Write tier: file creation/modification keywords
  if (/\b(write|create|build|implement|fix|patch|edit|modify|generate|develop|refactor|add|update|delete|remove|install|setup|scaffold)\b/.test(ctx)) {
    tiers.add('write');
  }

  // Exec tier: shell/command execution keywords
  if (/\b(run|test|deploy|install|execute|npm|pip|build|compile|lint|format|start|serve|docker|git|curl|wget|make|yarn|pnpm)\b/.test(ctx)) {
    tiers.add('exec');
  }

  // Social tier: team collaboration keywords
  if (/\b(send|message|collaborate|ask|team|colleague|review|feedback|communicate|coordinate|share|notify|report)\b/.test(ctx)) {
    tiers.add('social');
  }

  return tiers;
}

// ======================== ToolLoop ========================

/**
 * Unified Tool Loop — runs the LLM ↔ tool execution cycle.
 *
 * @example
 * const loop = new ToolLoop({
 *   chatFn: (msgs, opts) => llmClient.chat(provider, msgs, opts),
 *   toolExecutor: agentToolKit,
 *   maxIterations: 15,
 * });
 * const result = await loop.run(messages, options);
 */
export class ToolLoop {
  /**
   * @param {object} config
   * @param {function} config.chatFn - (messages, chatOpts) => Promise<{content, toolCalls, finishReason, usage}>
   * @param {object} config.toolExecutor - AgentToolKit instance with { definitions, execute(name, args) }
   * @param {number} [config.maxIterations=15]
   * @param {boolean} [config.supportsNativeToolCalls=true] - Whether the chat API supports tool_calls field
   * @param {Set<string>} [config.activeTiers] - Initial active tiers (defaults to all)
   * @param {string} [config.taskContext] - Task description for tier inference (only used if activeTiers not set)
   */
  constructor(config) {
    this.chatFn = config.chatFn;
    this.toolExecutor = config.toolExecutor;
    this.maxIterations = config.maxIterations || 15;
    this.supportsNativeToolCalls = config.supportsNativeToolCalls !== false;

    // Tool tiering
    if (config.activeTiers) {
      this.activeTiers = new Set(config.activeTiers);
    } else if (config.taskContext) {
      this.activeTiers = inferTiersFromContext(config.taskContext);
    } else {
      // Default: all tiers active (backward compat)
      this.activeTiers = new Set(['core', 'write', 'exec', 'social']);
    }
  }

  /**
   * Get tool definitions filtered by active tiers.
   * Plugin tools (not in any tier) are always included.
   */
  _getActiveToolDefinitions() {
    const allDefs = this.toolExecutor.definitions;
    const allTieredTools = new Set(Object.values(TOOL_TIERS).flat());
    const activeTieredTools = new Set();

    for (const tier of this.activeTiers) {
      const tools = TOOL_TIERS[tier];
      if (tools) {
        for (const t of tools) activeTieredTools.add(t);
      }
    }

    return allDefs.filter(def => {
      const name = def.function?.name;
      if (!name) return false;
      // Plugin tools (not in any tier) are always available
      if (!allTieredTools.has(name)) return true;
      // Tiered tools are only available if their tier is active
      return activeTieredTools.has(name);
    });
  }

  /**
   * Auto-escalate: if LLM tried to call tools not in active tiers, unlock those tiers.
   * Returns true if tiers were escalated.
   */
  _autoEscalate(requestedToolNames) {
    let escalated = false;
    const currentActive = this._getActiveToolNames();

    for (const name of requestedToolNames) {
      if (currentActive.has(name)) continue;
      // Find which tier contains this tool
      for (const [tier, tools] of Object.entries(TOOL_TIERS)) {
        if (tools.includes(name) && !this.activeTiers.has(tier)) {
          this.activeTiers.add(tier);
          escalated = true;
          console.log(`  🔓 [ToolLoop] Auto-escalated tier "${tier}" (tool "${name}" requested)`);
        }
      }
    }
    return escalated;
  }

  /**
   * Get a Set of currently active tool names.
   */
  _getActiveToolNames() {
    const names = new Set();
    for (const def of this._getActiveToolDefinitions()) {
      const name = def.function?.name;
      if (name) names.add(name);
    }
    return names;
  }

  /**
   * Check if a tool execution result contains skill_required_tools metadata.
   * If so, auto-escalate tiers for those tools.
   * This implements the Skill→Tool linkage: loading a skill unlocks its required tools.
   */
  _checkSkillToolLinkage(execResults) {
    for (const r of execResults) {
      if (r.tool !== 'load_skill' || !r.success) continue;
      const resultStr = typeof r.result === 'string' ? r.result : '';
      const marker = resultStr.match(/<!-- skill_required_tools: (\[.*?\]) -->/);
      if (marker) {
        try {
          const requiredTools = JSON.parse(marker[1]);
          if (requiredTools.length > 0) {
            this._autoEscalate(requiredTools);
            console.log(`  🔗 [ToolLoop] Skill→Tool linkage: unlocked tools [${requiredTools.join(', ')}]`);
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }

  /**
   * Execute tool calls — parallel for read-only, serial for writes.
   *
   * @param {Array<{name: string, args: object, id?: string}>} calls - Tool calls to execute
   * @param {function|null} onToolCall - Progress callback
   * @returns {Promise<Array<{tool, args, result, success, error?}>>}
   */
  async _executeToolCalls(calls, onToolCall) {
    const allReadOnly = calls.every(c => READ_ONLY_TOOLS.has(c.name));

    if (allReadOnly && calls.length > 1) {
      // Parallel execution for read-only tools
      return this._executeParallel(calls, onToolCall);
    }

    // Serial execution (default for writes or mixed)
    return this._executeSerial(calls, onToolCall);
  }

  async _executeParallel(calls, onToolCall) {
    // Notify all starting
    for (const call of calls) {
      if (onToolCall) {
        try { onToolCall({ tool: call.name, args: call.args, status: 'start' }); } catch {}
      }
    }

    const settled = await Promise.allSettled(
      calls.map(async (call) => {
        const result = await this.toolExecutor.execute(call.name, call.args);
        return { call, result };
      })
    );

    const results = [];
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      const call = calls[i];
      if (s.status === 'fulfilled') {
        results.push({ tool: call.name, args: call.args, result: s.value.result, success: true });
        if (onToolCall) {
          try { onToolCall({ tool: call.name, args: call.args, status: 'done', success: true }); } catch {}
        }
      } else {
        const errMsg = s.reason?.message || String(s.reason);
        results.push({ tool: call.name, args: call.args, error: errMsg, success: false });
        if (onToolCall) {
          try { onToolCall({ tool: call.name, args: call.args, status: 'error', error: errMsg }); } catch {}
        }
      }
    }
    return results;
  }

  async _executeSerial(calls, onToolCall) {
    const results = [];
    for (const call of calls) {
      console.log(`  🔧 [Tool Call] ${call.name}(${JSON.stringify(call.args).slice(0, 100)}...)`);
      if (onToolCall) {
        try { onToolCall({ tool: call.name, args: call.args, status: 'start' }); } catch {}
      }

      let result;
      try {
        result = await this.toolExecutor.execute(call.name, call.args);
        results.push({ tool: call.name, args: call.args, result, success: true });
        if (onToolCall) {
          try { onToolCall({ tool: call.name, args: call.args, status: 'done', success: true }); } catch {}
        }
      } catch (error) {
        result = `Tool execution error: ${error.message}`;
        results.push({ tool: call.name, args: call.args, error: error.message, success: false });
        if (onToolCall) {
          try { onToolCall({ tool: call.name, args: call.args, status: 'error', error: error.message }); } catch {}
        }
      }
    }
    return results;
  }

  /**
   * Run the full tool loop.
   *
   * @param {Array} messages - Initial conversation messages
   * @param {object} [options]
   * @param {number} [options.temperature]
   * @param {number} [options.maxTokens]
   * @param {string} [options._agentId]
   * @param {string} [options._agentName]
   * @param {function} [options.onToolCall] - Callback: tool execution progress
   * @param {function} [options.onLLMCall] - Callback: LLM call progress
   * @returns {Promise<{content: string, toolResults: Array, messages: Array, usage: object}>}
   */
  async run(messages, options = {}) {
    const { onToolCall, onLLMCall, temperature, maxTokens, _agentId, _agentName, ...extraOpts } = options;
    const conversationMessages = [...messages];
    const toolResults = [];
    const startTime = Date.now();

    // Track whether we just executed embedded tool calls.
    // If so, the next LLM call should NOT include tool definitions —
    // we want the model to summarize the tool results.
    let justDidEmbeddedCalls = false;

    for (let i = 0; i < this.maxIterations; i++) {
      // Notify: about to call LLM
      if (onLLMCall) {
        try { onLLMCall({ iteration: i + 1, maxIterations: this.maxIterations }); } catch {}
      }

      const chatOpts = {
        temperature,
        maxTokens,
        _agentId,
        _agentName,
        ...extraOpts,
      };

      // Only pass tool definitions when NOT in "summarize embedded results" phase
      if (!justDidEmbeddedCalls && this.supportsNativeToolCalls) {
        chatOpts.tools = this._getActiveToolDefinitions();
      }

      const wasEmbeddedSummaryRound = justDidEmbeddedCalls;
      justDidEmbeddedCalls = false;

      const response = await this.chatFn(conversationMessages, chatOpts);

      // ---- Handle native tool calls (OpenAI API format) ----
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Parse tool call arguments
        const parsedCalls = response.toolCalls.map(tc => {
          const { name, arguments: argsStr } = tc.function;
          let args;
          try {
            args = JSON.parse(argsStr);
          } catch {
            try {
              const cleaned = (argsStr || '{}').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"');
              args = JSON.parse(cleaned);
            } catch {
              args = {};
            }
          }
          return { name, args, id: tc.id };
        });

        // Auto-escalate tiers if needed
        const requestedNames = parsedCalls.map(c => c.name);
        const escalated = this._autoEscalate(requestedNames);
        if (escalated) {
          // Tiers changed — but we can still execute the current calls
          // (they were already requested). Next LLM call will see the expanded tool set.
        }

        // Push assistant message with tool_calls
        conversationMessages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls,
        });

        // Execute tools (parallel for read-only, serial for writes)
        const execResults = await this._executeToolCalls(parsedCalls, onToolCall);

        // Skill→Tool linkage: if load_skill was called, auto-unlock required tool tiers
        this._checkSkillToolLinkage(execResults);

        // Push tool result messages
        for (let j = 0; j < execResults.length; j++) {
          const r = execResults[j];
          const toolCallId = parsedCalls[j].id;
          toolResults.push(r);

          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: r.success
              ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result))
              : `Tool execution error: ${r.error}`,
          });
        }

        continue; // Next iteration
      }

      // ---- Handle JSON actions protocol (structured JSON with "actions" array) ----
      if (!wasEmbeddedSummaryRound) {
        const jsonActions = parseJSONActions(response.content);
        if (jsonActions) {
          console.log(`  🔄 [ToolLoop] Detected ${jsonActions.calls.length} JSON action(s): ${jsonActions.calls.map(c => c.name).join(', ')}`);

          // Auto-escalate tiers
          this._autoEscalate(jsonActions.calls.map(c => c.name));

          conversationMessages.push({
            role: 'assistant',
            content: response.content,
          });

          const execResults = await this._executeToolCalls(jsonActions.calls, onToolCall);
          toolResults.push(...execResults);

          // Skill→Tool linkage
          this._checkSkillToolLinkage(execResults);

          // Feed results back so LLM can continue (use same pattern as embedded calls)
          const callResultTexts = execResults.map(r => {
            const resultText = r.success
              ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))
              : `Tool execution error: ${r.error}`;
            return `[Tool Result: ${r.tool}]\n${resultText}`;
          });

          conversationMessages.push({
            role: 'user',
            content: `The tool(s) you requested have been executed. Here are the results:\n\n${callResultTexts.join('\n\n')}\n\nPlease review the tool results above and continue. If you need to call more tools, include them in your "actions" array. If all tasks are complete, return your final response with an empty "actions" array.`,
          });

          justDidEmbeddedCalls = true;
          continue;
        }
      }

      // ---- Handle embedded tool calls (DSML / XML / ```tool_call```) ----
      const embeddedCalls = wasEmbeddedSummaryRound ? null : parseEmbeddedToolCalls(response.content);
      if (embeddedCalls && embeddedCalls.length > 0) {
        console.log(`  🔄 [ToolLoop] Detected ${embeddedCalls.length} embedded tool call(s), executing...`);

        // Auto-escalate tiers
        this._autoEscalate(embeddedCalls.map(c => c.name));

        conversationMessages.push({
          role: 'assistant',
          content: response.content,
        });

        const execResults = await this._executeToolCalls(embeddedCalls, onToolCall);
        toolResults.push(...execResults);

        // Skill→Tool linkage: if load_skill was called, auto-unlock required tool tiers
        this._checkSkillToolLinkage(execResults);

        // Feed results back as user message (embedded calls don't use tool_calls protocol)
        const callResultTexts = execResults.map(r => {
          const resultText = r.success
            ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))
            : `Tool execution error: ${r.error}`;
          return `[Tool Result: ${r.tool}]\n${resultText}`;
        });

        conversationMessages.push({
          role: 'user',
          content: `The tool(s) you requested have been executed. Here are the results:\n\n${callResultTexts.join('\n\n')}\n\nPlease review the tool results above. If you need more information or need to run additional tools to complete the task, go ahead and call them. If you have enough information, provide a complete, helpful answer to the user's original question.`,
        });

        justDidEmbeddedCalls = true;
        continue;
      }

      // ---- No tool calls — final response ----
      const strippedContent = stripToolCallMarkup(response.content);
      const finalContent = strippedContent || summarizeToolResults(toolResults);

      // Log summary if tool calls were made
      if (toolResults.length > 0) {
        logLLMCall({
          agentId: _agentId,
          agentName: _agentName,
          providerId: extraOpts._providerId,
          model: extraOpts._model,
          messages: conversationMessages,
          response: { content: finalContent },
          toolResults,
          options: { ...options, _isChatWithToolsSummary: true, iterationsUsed: i + 1 },
          latency: Date.now() - startTime,
          usage: response.usage,
          streamed: false,
        });
      }

      return {
        content: finalContent,
        toolResults,
        messages: conversationMessages,
        usage: response.usage,
      };
    }

    // Exceeded max iterations — one final call without tools
    const finalResponse = await this.chatFn(conversationMessages, {
      temperature,
      maxTokens,
      _agentId,
      _agentName,
    });

    const strippedFinal = stripToolCallMarkup(finalResponse.content);
    const finalContent = strippedFinal || summarizeToolResults(toolResults);

    if (toolResults.length > 0) {
      logLLMCall({
        agentId: _agentId,
        agentName: _agentName,
        providerId: extraOpts._providerId,
        model: extraOpts._model,
        messages: conversationMessages,
        response: { content: finalContent },
        toolResults,
        options: { ...options, _isChatWithToolsSummary: true, iterationsUsed: this.maxIterations, maxIterationsReached: true },
        latency: Date.now() - startTime,
        usage: finalResponse.usage,
        streamed: false,
      });
    }

    return {
      content: finalContent,
      toolResults,
      messages: conversationMessages,
      usage: finalResponse.usage,
    };
  }
}

// Export utilities for backward compat / shared use
export { parseEmbeddedToolCalls, parseJSONActions, stripToolCallMarkup, summarizeToolResults };
