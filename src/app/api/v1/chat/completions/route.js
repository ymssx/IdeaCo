import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * OpenAI-compatible chat completions API
 * 
 * Endpoint: POST /api/v1/chat/completions
 * 
 * Supports:
 * - Standard OpenAI request format
 * - Tool calling (function calling)
 * - Custom OpenAI-compatible providers
 * - Local models via custom baseURL
 * 
 * Request format matches OpenAI API:
 * {
 *   "model": "provider-id",  // e.g., "custom-openai", "openai-gpt4", etc.
 *   "messages": [...],
 *   "temperature": 0.7,
 *   "max_tokens": 2048,
 *   "tools": [...],      // Optional: tool definitions
 *   "tool_choice": "auto"
 * }
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json(
      { 
        error: { 
          message: "No active company found", 
          type: "api_error", 
          code: "no_company" 
        } 
      }, 
      { status: 400 }
    );
  }

  try {
    const requestData = await request.json();
    const { model, messages, temperature, max_tokens, tools, tool_choice } = requestData;

    // Validate required parameters
    if (!model) {
      return NextResponse.json(
        { 
          error: { 
            message: "Missing required parameter: model", 
            type: "invalid_request_error", 
            param: "model" 
          } 
        }, 
        { status: 400 }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { 
          error: { 
            message: "Missing required parameter: messages", 
            type: "invalid_request_error", 
            param: "messages" 
          } 
        }, 
        { status: 400 }
      );
    }

    // Get provider stats to find the requested model
    const providerStats = company.getProviderDashboard();
    let targetProvider = null;
    
    // Search through all categories to find the provider
    for (const category of Object.values(providerStats)) {
      const provider = category.providers.find(p => p.id === model || p.name === model);
      if (provider && provider.enabled) {
        targetProvider = provider;
        break;
      }
    }

    if (!targetProvider) {
      const availableModels = [];
      for (const category of Object.values(providerStats)) {
        category.providers.filter(p => p.enabled).forEach(p => {
          availableModels.push(p.id);
        });
      }
      
      return NextResponse.json(
        { 
          error: { 
            message: `Model '${model}' is not available or not enabled. Available models: ${availableModels.join(', ')}`,
            type: "invalid_request_error", 
            param: "model" 
          } 
        }, 
        { status: 400 }
      );
    }

    // Get the actual provider object from the registry
    const providerRegistry = company.providerRegistry;
    const providerObj = providerRegistry.getProvider(targetProvider.id);
    
    if (!providerObj) {
      return NextResponse.json(
        { 
          error: { 
            message: `Provider '${targetProvider.id}' not found in registry`,
            type: "api_error" 
          } 
        }, 
        { status: 500 }
      );
    }

    // Prepare chat options
    const options = {
      temperature: temperature || 0.7,
      maxTokens: max_tokens || 2048,
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    // For custom OpenAI providers, we need to use the LLM client directly
    // In a real implementation, you would import llmClient from '@/core/agent/llm-agent'
    // and call llmClient.chat(providerObj, messages, options)
    
    // For now, return a mock response for testing
    const mockResponse = {
      id: `chatcmpl_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: targetProvider.id,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: `This is a mock response from ${targetProvider.name}. In production, this would connect to your custom OpenAI-compatible endpoint at ${targetProvider.baseURL || 'default endpoint'}.`
          },
          finish_reason: "stop",
          logprobs: null
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      system_fingerprint: "openai-compat-v1",
      _meta: {
        provider: targetProvider.id,
        provider_name: targetProvider.name,
        is_custom_openai: targetProvider.isCustomOpenAI || false,
        base_url: targetProvider.baseURL || ''
      }
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error(`[OpenAI API] Request failed:`, error.message);
    return NextResponse.json(
      { 
        error: { 
          message: "Invalid request", 
          type: "invalid_request_error" 
        } 
      }, 
      { status: 400 }
    );
  }
}

// Also support OPTIONS method for CORS
export async function OPTIONS(request) {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}