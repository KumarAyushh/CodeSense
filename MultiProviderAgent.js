const { GoogleGenAI, Type } = require("@google/genai");
const OpenAI = require("openai");

/**
 * Multi-Provider AI Agent supporting Gemini, OpenAI, Anthropic, and Groq
 */
class MultiProviderAgent {
  constructor(provider, apiKey) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.client = null;
    this.model = null;
    this.abortController = null;

    this._initializeClient();
  }

  _initializeClient() {
    // Normalize provider name to handle case variations
    const normalizedProvider = this.provider.toLowerCase();

    if (normalizedProvider.includes('gemini') || normalizedProvider.includes('google')) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
      this.model = "gemini-2.5-flash";
    } else if (normalizedProvider.includes('openai') || normalizedProvider.includes('gpt')) {
      this.client = new OpenAI({ apiKey: this.apiKey });
      this.model = "gpt-4o";
    } else if (normalizedProvider.includes('anthropic') || normalizedProvider.includes('claude')) {
      this.model = "claude-3-5-sonnet-20241022";
      console.log("⚠️ Anthropic support requires '@anthropic-ai/sdk' package");
      throw new Error(`Anthropic is not yet fully implemented.`);
    } else if (normalizedProvider.includes('groq') || normalizedProvider.includes('llama')) {
      this.model = "llama-3.1-70b-versatile";
      console.log("⚠️ Groq support requires 'groq-sdk' package");
      throw new Error(`Groq is not yet fully implemented.`);
    } else {
      throw new Error(`Unsupported provider: ${this.provider}. Please use Google Gemini or OpenAI.`);
    }
  }

  /**
   * Stop ongoing generation
   */
  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      console.log('🛑 Generation stopped by user');
    }
  }

  /**
   * Validates and sanitizes conversation history to ensure proper turn order for Gemini API
   * Gemini requires: user -> model -> user (with function responses) -> model
   * Function calls MUST be followed by function responses from user
   */
  _validateAndSanitizeHistory(history) {
    if (!history || history.length === 0) return [];

    const sanitized = [];
    
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      
      // Skip invalid messages
      if (!msg || !msg.role || !msg.parts || msg.parts.length === 0) {
        console.warn(`⚠️ Skipping invalid message at index ${i}`);
        continue;
      }

      // Check if this is a function call from model
      const hasFunctionCall = msg.role === 'model' && msg.parts.some(p => p.functionCall);
      
      if (hasFunctionCall) {
        // Look ahead to check if there's a corresponding function response
        const nextMsg = history[i + 1];
        const hasValidResponse = nextMsg && 
          nextMsg.role === 'user' && 
          nextMsg.parts.some(p => p.functionResponse);
        
        if (!hasValidResponse) {
          // Skip this function call - no valid response follows
          console.warn(`⚠️ Skipping orphaned function call at index ${i}`);
          continue;
        }
      }

      sanitized.push(msg);
    }

    // Final validation: ensure history doesn't end with a function call
    if (sanitized.length > 0) {
      const lastMsg = sanitized[sanitized.length - 1];
      if (lastMsg.role === 'model' && lastMsg.parts.some(p => p.functionCall)) {
        // Remove the trailing function call
        sanitized.pop();
        console.warn('⚠️ Removed trailing function call from history');
      }
    }

    // Ensure first message is from user (Gemini requirement)
    if (sanitized.length > 0 && sanitized[0].role !== 'user') {
      console.warn('⚠️ History must start with user message, resetting');
      return [];
    }

    return sanitized;
  }

  /**
   * Simple validation check (legacy method for compatibility)
   */
  _validateHistory(history) {
    if (!history || history.length === 0) return true;
    
    const lastMessage = history[history.length - 1];
    
    // History should not end with a model function call
    if (lastMessage.role === 'model' && lastMessage.parts.some(p => p.functionCall)) {
      return false;
    }
    
    // First message must be user
    if (history[0].role !== 'user') {
      return false;
    }

    return true;
  }

  async generateContent(config) {
    const normalizedProvider = this.provider.toLowerCase();

    if (normalizedProvider.includes('gemini') || normalizedProvider.includes('google')) {
      return await this.client.models.generateContent(config);
    }

    if (normalizedProvider.includes('openai') || normalizedProvider.includes('gpt')) {
      // Convert Gemini-style config to OpenAI format
      const messages = this._convertToOpenAIMessages(config.contents);
      const tools = this._convertToOpenAITools(config.config.tools);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: config.config.systemInstruction },
          ...messages
        ],
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined
      });

      return this._convertFromOpenAIResponse(response);
    }

    // For other providers
    throw new Error(`${this.provider} integration not yet implemented.`);
  }

  _convertToOpenAIMessages(contents) {
    const messages = [];

    for (const content of contents) {
      if (content.role === 'user') {
        const text = content.parts.map(p => p.text || JSON.stringify(p)).join('\n');
        messages.push({ role: 'user', content: text });
      } else if (content.role === 'model') {
        // Check if this is a function call
        if (content.parts[0]?.functionCall) {
          const fc = content.parts[0].functionCall;
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_' + Date.now(),
              type: 'function',
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args)
              }
            }]
          });
        } else {
          const text = content.parts.map(p => p.text || '').join('\n');
          messages.push({ role: 'assistant', content: text });
        }
      }
    }

    return messages;
  }

  _convertToOpenAITools(geminiTools) {
    if (!geminiTools || geminiTools.length === 0) return [];

    const tools = [];
    for (const toolGroup of geminiTools) {
      for (const func of toolGroup.functionDeclarations || []) {
        tools.push({
          type: 'function',
          function: {
            name: func.name,
            description: func.description,
            parameters: this._convertGeminiParamsToOpenAI(func.parameters)
          }
        });
      }
    }

    return tools;
  }

  _convertGeminiParamsToOpenAI(params) {
    if (!params) return {};

    const converted = {
      type: 'object',
      properties: {},
      required: params.required || []
    };

    if (params.properties) {
      for (const [key, value] of Object.entries(params.properties)) {
        converted.properties[key] = {
          type: this._mapGeminiTypeToOpenAI(value.type),
          description: value.description
        };
      }
    }

    return converted;
  }

  _mapGeminiTypeToOpenAI(geminiType) {
    const typeMap = {
      'STRING': 'string',
      'NUMBER': 'number',
      'BOOLEAN': 'boolean',
      'OBJECT': 'object',
      'ARRAY': 'array'
    };
    return typeMap[geminiType] || 'string';
  }

  _convertFromOpenAIResponse(response) {
    const choice = response.choices[0];
    const message = choice.message;

    // Check if there are tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const functionCalls = message.tool_calls.map(tc => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments)
      }));

      return {
        functionCalls,
        text: () => message.content || ''
      };
    }

    // Regular text response
    return {
      text: () => message.content || '',
      functionCalls: []
    };
  }

  async run(directoryPath, interactionCallback, toolFunctions, tools) {
    const normalizedProvider = this.provider.toLowerCase();

    if (!normalizedProvider.includes('gemini') && !normalizedProvider.includes('google') &&
      !normalizedProvider.includes('openai') && !normalizedProvider.includes('gpt')) {
      throw new Error(`${this.provider} is not yet fully implemented. Please use Google Gemini or OpenAI.`);
    }

    console.log(`Starting Code Review with ${this.provider}...`);
    console.log(`Target: ${directoryPath}\n`);

    const initialPrompt = {
      role: "user",
      parts: [{ text: `Review and improve the codebase in: ${directoryPath}. If there are tests, run them. If there are bugs, fix them.` }],
    };

    const History = [initialPrompt];
    const MAX_HISTORY_LENGTH = 20;

    const trimHistory = () => {
      if (History.length > MAX_HISTORY_LENGTH) {
        const recentMessages = History.slice(-(MAX_HISTORY_LENGTH - 1));
        History.length = 0;
        History.push(initialPrompt, ...recentMessages);
        console.log(`📊 History trimmed to ${MAX_HISTORY_LENGTH} messages to save tokens`);
      }
    };

    while (true) {
      // Sanitize history before each API call
      const sanitizedHistory = this._validateAndSanitizeHistory(History);
      History.length = 0;
      History.push(...(sanitizedHistory.length > 0 ? sanitizedHistory : [initialPrompt]));

      let result;
      try {
        result = await this.generateContent({
          model: this.model,
          contents: History,
          config: {
            systemInstruction: `You are an AI Code Engineer assistant in a chat interface.

COMMUNICATION STYLE:
- Be conversational and direct - you're chatting, not writing documentation
- Use short, clear sentences
- Avoid bullet points and formal lists in responses
- Don't introduce yourself repeatedly
- Get straight to the point

YOUR CAPABILITIES:
You can read/write/delete files, create directories, and run terminal commands to analyze and fix code.

WORKFLOW:
1. When asked to create/build/make something: do it immediately, create all necessary files
2. When asked to review code: explore the directory, read key files, identify issues
3. When asked to fix bugs: analyze, then apply fixes directly
4. After making changes, briefly confirm what you did

IMPORTANT:
- Execute file operations immediately when requested
- Keep responses short and chat-like
- Use emojis sparingly (🔴 for critical bugs, 🟡 for improvements)
- Don't ask for permission - the user's request IS the permission
- Focus on doing what the user asked

Now help the user with their code.`,
            tools,
          },
        });
      } catch (apiError) {
        const errorMsg = apiError.message || String(apiError);
        if (errorMsg.includes('function call turn') || errorMsg.includes('INVALID_ARGUMENT')) {
          console.error('🔴 Conversation state error, resetting:', errorMsg);
          History.length = 0;
          History.push(initialPrompt);
          continue;
        }
        throw apiError;
      }

      if (result.functionCalls?.length > 0) {
        // Add the model's function call to history FIRST
        History.push({ 
          role: "model", 
          parts: result.functionCalls.map(fc => ({ functionCall: fc }))
        });

        // Execute all function calls and collect responses
        const functionResponses = [];
        for (const functionCall of result.functionCalls) {
          const { name, args } = functionCall;

          console.log(`🔧 Tool: ${name}`);
          
          try {
            const toolResponse = await toolFunctions[name](args);
            functionResponses.push({
              functionResponse: { 
                name, 
                response: { result: toolResponse } 
              }
            });
          } catch (toolError) {
            console.error(`🔴 Tool error for ${name}:`, toolError.message);
            functionResponses.push({
              functionResponse: { 
                name, 
                response: { error: toolError.message } 
              }
            });
          }
        }

        // Add all function responses in a single user turn
        // CRITICAL: function responses must be in a "user" turn for Gemini
        History.push({
          role: "user",
          parts: functionResponses
        });
      } else {
        let text = (typeof result.text === "function" ? result.text() : result.text) || "";
        text = text.trim();

        if (!text) break;

        console.log("\n🤖 AI:", text);
        History.push({ role: "model", parts: [{ text }] });
      }

      trimHistory();
    }
  }

  /**
   * Run agent with a single user message and send response back via callback
   */
  async runWithMessage(directoryPath, userMessage, interactionCallback, messageCallback, toolFunctions, tools) {
    const normalizedProvider = this.provider.toLowerCase();

    if (!normalizedProvider.includes('gemini') && !normalizedProvider.includes('google') &&
      !normalizedProvider.includes('openai') && !normalizedProvider.includes('gpt')) {
      throw new Error(`${this.provider} is not yet fully implemented. Please use Google Gemini or OpenAI.`);
    }

    console.log(`Processing message with ${this.provider}...`);
    console.log(`User: ${userMessage}`);

    // Initialize history if not exists
    if (!this.history) {
      this.history = [];
    }

    const MAX_HISTORY_LENGTH = 20;

    const trimHistory = () => {
      if (this.history.length > MAX_HISTORY_LENGTH) {
        // Keep first user message and recent messages
        const firstUserMsg = this.history.find(m => m.role === 'user' && m.parts.some(p => p.text));
        const recentMessages = this.history.slice(-(MAX_HISTORY_LENGTH - 1));
        this.history = firstUserMsg ? [firstUserMsg, ...recentMessages] : recentMessages;
        // Re-sanitize after trimming
        this.history = this._validateAndSanitizeHistory(this.history);
        console.log(`📊 History trimmed to ${this.history.length} messages`);
      }
    };

    // Sanitize existing history before adding new message
    this.history = this._validateAndSanitizeHistory(this.history);

    // Add user message to history
    this.history.push({
      role: "user",
      parts: [{ text: `${userMessage}. Working directory: ${directoryPath}` }]
    });

    // Create abort controller for this request
    this.abortController = new AbortController();

    const MAX_TURNS = 15;
    let turn = 0;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    try {
      while (turn < MAX_TURNS) {
        turn++;
        console.log(`\n🔄 Turn ${turn}/${MAX_TURNS}`);

        // Validate and sanitize history before making API call
        this.history = this._validateAndSanitizeHistory(this.history);
        
        if (this.history.length === 0) {
          // History was completely cleared, add user message back
          this.history.push({
            role: "user",
            parts: [{ text: `${userMessage}. Working directory: ${directoryPath}` }]
          });
        }

        // Generate response with error handling
        let result;
        try {
          result = await this.generateContent({
            model: this.model,
            contents: this.history,
            config: {
              systemInstruction: `You are CodeSense an AI coding assistant built by Kumar Ayush. 🤖

YOUR GOAL: Analyze, Debug, and Improve the codebase.

CAPABILITIES:
1.  **File Ops**: Read, Write, Delete files, Create directories.
2.  **Terminal**: Run commands (npm test, node filename.js, eslint, etc.) to verify your code.

PROCESS:
1.  **Execution**: When asked to create/build/make something: do it immediately. Create all necessary files.
2.  **Exploration**: When asked to review: scan the directory, read key files.
3.  **Diagnosis**: Identify bugs, security risks, or bad practices.
4.  **Verification**: After creating or fixing files, verify they exist and work.
5.  **Reporting**: Generate a concise report of your findings.

IMPORTANT:
-   Execute file operations IMMEDIATELY when requested.
-   Do NOT ask for permission for creation tasks - the user's request IS the permission.
-   Keep responses professional and concise.
-   Use emojis sparingly (🔴 for critical bugs, 🟡 for improvements).`,
              tools,
            },
          });
        } catch (apiError) {
          // Handle specific API errors
          const errorMsg = apiError.message || String(apiError);
          
          if (errorMsg.includes('function call turn') || errorMsg.includes('INVALID_ARGUMENT')) {
            console.error('🔴 Conversation state error:', errorMsg);
            
            if (retryCount < MAX_RETRIES) {
              retryCount++;
              console.log(`🔄 Retry ${retryCount}/${MAX_RETRIES}: Resetting conversation state...`);
              messageCallback('⚠️ Fixing conversation state, please wait...');
              
              // Reset history completely and start fresh
              this.history = [{
                role: "user",
                parts: [{ text: `${userMessage}. Working directory: ${directoryPath}` }]
              }];
              continue; // Retry with clean history
            } else {
              throw new Error('Conversation state could not be recovered. Please start a new conversation.');
            }
          } else if (errorMsg.includes('fetch failed') || apiError.name === 'TypeError') {
            console.error('🔴 Network error:', errorMsg);
            throw new Error('Network connection failed. Please check your internet connection and try again.');
          } else {
            throw apiError; // Re-throw other errors
          }
        }

        // Reset retry count on successful response
        retryCount = 0;

        // Handle tool calls
        if (result.functionCalls?.length > 0) {
          // Add the model's function call to history
          const functionCallParts = result.functionCalls.map(fc => ({ functionCall: fc }));
          this.history.push({ 
            role: "model", 
            parts: functionCallParts
          });

          // Execute all function calls and collect responses
          const functionResponses = [];
          for (const functionCall of result.functionCalls) {
            const { name, args } = functionCall;

            console.log(`🔧 Tool: ${name}`);
            
            try {
              const toolResponse = await toolFunctions[name](args);
              functionResponses.push({
                functionResponse: { 
                  name, 
                  response: { result: toolResponse } 
                }
              });
            } catch (toolError) {
              console.error(`🔴 Tool error for ${name}:`, toolError.message);
              functionResponses.push({
                functionResponse: { 
                  name, 
                  response: { error: toolError.message } 
                }
              });
            }
          }

          // Add all function responses in a single user turn
          // This is CRITICAL for Gemini - function responses MUST be in a user turn
          this.history.push({
            role: "user",
            parts: functionResponses
          });

          // Loop continues to generate next response based on tool output
        } else {
          // Text response - likely final answer or question
          let text = (typeof result.text === "function" ? result.text() : result.text) || "";
          text = text.trim();

          if (text) {
            console.log("🤖 AI:", text);
            this.history.push({ role: "model", parts: [{ text }] });
            messageCallback(text);
          }
          break; // Exit loop if no tool calls
        }

        trimHistory();
      }
    } catch (error) {
      // Handle abort error
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        console.log('✅ Generation canceled successfully');
        messageCallback('Generation stopped.');
        return;
      }

      // Re-throw other errors
      console.error('Error in runWithMessage:', error);
      throw error;
    } finally {
      // Clean up abort controller
      this.abortController = null;
    }
  }
}

module.exports = { MultiProviderAgent };