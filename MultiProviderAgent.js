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
      const result = await this.generateContent({
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

      if (result.functionCalls?.length > 0) {
        for (const functionCall of result.functionCalls) {
          const { name, args } = functionCall;

          console.log(`🔧 Tool: ${name}`);
          const toolResponse = await toolFunctions[name](args);

          History.push({ role: "model", parts: [{ functionCall }] });
          History.push({
            role: "user",
            parts: [{ functionResponse: { name, response: { result: toolResponse } } }],
          });
        }
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
        this.history = this.history.slice(-MAX_HISTORY_LENGTH);
        console.log(`📊 History trimmed to ${MAX_HISTORY_LENGTH} messages`);
      }
    };

    // Add user message to history
    this.history.push({
      role: "user",
      parts: [{ text: `${userMessage}. Working directory: ${directoryPath}` }]
    });

    // Create abort controller for this request
    this.abortController = new AbortController();

    const MAX_TURNS = 15;
    let turn = 0;

    try {
      while (turn < MAX_TURNS) {
        turn++;
        console.log(`\n🔄 Turn ${turn}/${MAX_TURNS}`);

        // Generate response
        const result = await this.generateContent({
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

        // Handle tool calls
        if (result.functionCalls?.length > 0) {
          for (const functionCall of result.functionCalls) {
            const { name, args } = functionCall;

            console.log(`🔧 Tool: ${name}`);
            const toolResponse = await toolFunctions[name](args);

            this.history.push({ role: "model", parts: [{ functionCall }] });
            this.history.push({
              role: "user",
              parts: [{ functionResponse: { name, response: { result: toolResponse } } }],
            });
          }
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
