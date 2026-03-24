import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { llmClient } from '@/core/agent/llm-agent/client.js';

/**
 * OpenAI-compatible chat completions API
 * 
 * This endpoint serves both external Channels (e.g. OpenClaw Gateway -> WeChat)
 * and standard OpenAI API-compatible third-party tools.
 * 
 * Two modes supported:
 * 1. model = "secretary" -> Routes to Secretary conversation (for Channel scenarios)
 * 2. model = <provider-id> -> Forwards directly to the corresponding LLM Provider
 * 
 * Request format matches OpenAI API:
 * {
 *   "model": "secretary" | "provider-id",
 *   "messages": [...],
 *   "temperature": 0.7,
 *   "max_tokens": 2048,
 *   "tools": [...],
 *   "tool_choice": "auto"
 * }
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json(
      { error: { message: "No active company found", type: "api_error", code: "no_company" } },
      { status: 400 }
    );
  }

  try {
    const requestData = await request.json();
    const { model, messages, temperature, max_tokens, tools, tool_choice } = requestData;

    if (!model) {
      return NextResponse.json(
        { error: { message: "Missing required parameter: model", type: "invalid_request_error", param: "model" } },
        { status: 400 }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: "Missing required parameter: messages", type: "invalid_request_error", param: "messages" } },
        { status: 400 }
      );
    }

    // ── Mode 1: Secretary conversation ──────────────────────────
    // When model = "secretary", extract the last user message and route through chatWithSecretary
    if (model === 'secretary') {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) {
        return NextResponse.json(
          { error: { message: "No user message found in messages array", type: "invalid_request_error" } },
          { status: 400 }
        );
      }

      const reply = await company.chatWithSecretary(lastUserMsg.content);
      return NextResponse.json({
        id: `chatcmpl_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "secretary",
        choices: [{
          index: 0,
          message: { role: "assistant", content: reply.content || '' },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    // ── Mode 2: Forward directly to LLM Provider ────────────────
    const providerStats = company.getProviderDashboard();
    let targetProvider = null;

    for (const category of Object.values(providerStats)) {
      const provider = category.providers.find(p => p.id === model || p.name === model);
      if (provider && provider.enabled) {
        targetProvider = provider;
        break;
      }
    }

    if (!targetProvider) {
      const availableModels = ['secretary'];
      for (const category of Object.values(providerStats)) {
        category.providers.filter(p => p.enabled).forEach(p => availableModels.push(p.id));
      }
      return NextResponse.json(
        { error: { message: `Model '${model}' not available. Available: ${availableModels.join(', ')}`, type: "invalid_request_error", param: "model" } },
        { status: 400 }
      );
    }

    const providerRegistry = company.providerRegistry;
    const providerObj = providerRegistry.getProvider(targetProvider.id);
    if (!providerObj) {
      return NextResponse.json(
        { error: { message: `Provider '${targetProvider.id}' not found in registry`, type: "api_error" } },
        { status: 500 }
      );
    }

    // Call LLM via LLMClient
    const options = {
      temperature: temperature || 0.7,
      maxTokens: max_tokens || 2048,
    };
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    const response = await llmClient.chat(providerObj, messages, options);

    return NextResponse.json({
      id: `chatcmpl_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: targetProvider.id,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: response.content || '',
          ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
        },
        finish_reason: response.finish_reason || "stop",
      }],
      usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      system_fingerprint: "ai-enterprise-v1",
    });
  } catch (error) {
    console.error(`[OpenAI API] Request failed:`, error.message);
    return NextResponse.json(
      { error: { message: error.message || "Internal error", type: "api_error" } },
      { status: 500 }
    );
  }
}

// CORS support
export async function OPTIONS(request) {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}