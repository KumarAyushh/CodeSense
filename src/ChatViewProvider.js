const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { showDiff } = require('./diffUtil');

// We need to import the agent using dynamic import because index.js is an ES Module
// or we need to bundle it. For simplicity in this environment, let's try dynamic import.
// However, 'require' inside a VS Code extension with 'type: module' in package.json usually works 
// if we stick to CommonJS for the extension entry point.
// But index.js is ESM. This might be tricky without a bundler.
// Strategy: require the ESM file might fail.
// Alternative: We will assume we can use dynamic import().

class ChatViewProvider {
  constructor(extensionUri, context) {
    this._extensionUri = extensionUri;
    this._context = context;
    this._agent = null;
  }

  async resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    // Retain webview content when hidden (prevents losing chat on tab switch)
    webviewView.onDidChangeVisibility(() => {
      // Webview visibility changed - state is preserved via getState/setState
    });

    // Check for existing API key BEFORE setting HTML
    await this._initializeWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'userMessage':
          await this._handleUserMessage(data.text);
          break;
        case 'saveApiKey':
          await this._context.secrets.store('ai_provider', data.provider);
          await this._context.secrets.store('ai_api_key', data.key);
          this._view.webview.postMessage({ type: 'systemMessage', text: `${data.provider} API Key saved successfully! You can now start chatting.` });
          break;
        case 'clearApiKey':
          // For testing: clear stored credentials
          await this._context.secrets.delete('ai_provider');
          await this._context.secrets.delete('ai_api_key');
          this._view.webview.postMessage({ type: 'apiKeyCleared' });
          break;
        case 'resetApiKey':
          // Reset API Key - delete all stored keys
          const keysToDelete = [
            'ai_api_key',
            'ai_provider',
            'gemini_api_key',
            'google_gemini_api_key',
            'openai_api_key',
            'anthropic_api_key',
            'groq_api_key'
          ];
          for (const k of keysToDelete) {
            try {
              await this._context.secrets.delete(k);
            } catch (e) {
              // Ignore individual delete errors
            }
          }
          // Reset agent
          this._agent = null;
          // Show success message and request new API key
          this._view.webview.postMessage({ type: 'systemMessage', text: '✅ API key reset successfully. Please enter your API key to continue.' });
          this._view.webview.postMessage({ type: 'requestApiKey' });
          break;
        case 'stopGeneration':
          // Stop ongoing AI generation
          if (this._agent) {
            this._agent.stopGeneration();
          }
          break;
        case 'resetConversation':
          // Reset the agent to clear conversation history
          this._agent = null;
          this._view.webview.postMessage({ type: 'systemMessage', text: '🔄 Conversation reset. Starting fresh!' });
          break;
        case 'saveConversation':
          await this._saveConversation(data.conversation);
          break;
        case 'fetchHistory':
          const history = await this._getConversations();
          this._view.webview.postMessage({ type: 'historyList', conversations: history });
          break;
        case 'deleteHistory':
          await this._deleteConversation(data.id);
          const updatedHistory = await this._getConversations();
          this._view.webview.postMessage({ type: 'historyList', conversations: updatedHistory });
          break;
      }
    });
  }

  async _initializeWebview() {
    // Check for existing credentials first
    const apiKey = await this._context.secrets.get('ai_api_key');
    const provider = await this._context.secrets.get('ai_provider');
    
    // Set HTML with initial screen based on whether we have credentials
    const hasCredentials = !!(apiKey && provider);
    this._view.webview.html = this._getHtmlForWebview(this._view.webview, hasCredentials);
  }

  async _handleUserMessage(text) {
    // Check API Key and Provider
    const apiKey = await this._context.secrets.get('ai_api_key');
    const provider = await this._context.secrets.get('ai_provider') || 'Google Gemini';

    if (!apiKey) {
      this._view.webview.postMessage({ type: 'requestApiKey' });
      return;
    }

    // Initialize Agent if needed
    if (!this._agent) {
      try {
        // Load the multi-provider agent
        const { MultiProviderAgent } = require('../MultiProviderAgent');
        const { createTools, tools } = require('./tools');

        this._agent = new MultiProviderAgent(provider, apiKey);
        this._createTools = createTools;
        this._tools = tools;
      } catch (e) {
        this._view.webview.postMessage({ type: 'aiResponse', text: 'Error loading Agent: ' + e.message });
        return;
      }
    }

    // Identify Workspace
    let workspacePath = '';
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
      this._view.webview.postMessage({ type: 'aiResponse', text: 'Please open a folder/workspace first to review code.' });
      return;
    }

    // Run Agent with message callback
    try {
      this._view.webview.postMessage({ type: 'aiThinking', active: true });

      // Message callback to send AI responses back to webview
      const messageCallback = (message) => {
        this._view.webview.postMessage({ type: 'aiResponse', text: message });
      };

      // Activity callback for real-time progress updates (premium feature)
      const activityCallback = (activity) => {
        this._view.webview.postMessage({ type: 'activityUpdate', activity });
      };

      // Interaction Callback for the Agent
      const interactionCallback = async (question) => {
        return await this._askUserInWebview(question);
      };

      // Run the agent with the user's message
      const toolFunctions = this._createTools(workspacePath, {
        confirm: async (message) => {
          const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Allow');
          return choice === 'Allow';
        },
        showDiff
      });
      await this._agent.runWithMessage(workspacePath, text, interactionCallback, messageCallback, activityCallback, toolFunctions, this._tools);

    } catch (error) {
      // Provide user-friendly error messages
      let errorMessage = 'Error: ';
      const errMsg = error.message || '';
      
      if (errMsg.includes('Network connection failed') || errMsg.includes('fetch failed')) {
        errorMessage += '🌐 Network connection failed. Please check your internet connection and try again.';
      } else if (errMsg.includes('Invalid conversation state') || errMsg.includes('could not be recovered')) {
        errorMessage += '⚠️ Conversation state error. Please click the reset button to start a new conversation.';
        // Reset agent to clear history
        this._agent = null;
      } else if (errMsg.includes('API key') || errMsg.includes('PERMISSION_DENIED')) {
        errorMessage += '🔑 API key error. Please check your API key and try again.';
        this._view.webview.postMessage({ type: 'requestApiKey' });
      } else if (errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('function call')) {
        errorMessage += '⚠️ API error. Resetting conversation...';
        this._agent = null;
      } else {
        errorMessage += errMsg || 'An unexpected error occurred.';
      }
      
      this._view.webview.postMessage({ type: 'aiResponse', text: errorMessage });
      console.error('Error in _handleUserMessage:', error);
    } finally {
      this._view.webview.postMessage({ type: 'aiThinking', active: false });
    }
  }

  async _askUserInWebview(question) {
    return new Promise(resolve => {
      this._view.webview.postMessage({ type: 'confirmationRequest', text: question });
      const disposable = this._view.webview.onDidReceiveMessage(data => {
        if (data.type === 'confirmationResponse') {
          disposable.dispose();
          resolve(data.answer);
        }
      });
    });
  }

  // =========================================================================
  // HISTORY MANAGEMENT
  // =========================================================================

  async _getConversations() {
    return this._context.globalState.get('chat_history') || [];
  }

  async _saveConversation(conversation) {
    if (!conversation || !conversation.id) return;

    let history = await this._getConversations();
    const index = history.findIndex(c => c.id === conversation.id);

    if (index !== -1) {
      history[index] = conversation; // Update existing
    } else {
      history.unshift(conversation); // Add new to top
    }

    // Limit history size to 50 conversations to save state space
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await this._context.globalState.update('chat_history', history);
  }

  async _deleteConversation(id) {
    let history = await this._getConversations();
    history = history.filter(c => c.id !== id);
    await this._context.globalState.update('chat_history', history);
  }

  _getHtmlForWebview(webview, hasCredentials = false) {
    const mediaUri = (file) => webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', file));
    const template = fs.readFileSync(path.join(this._extensionUri.fsPath, 'media', 'index.html'), 'utf-8');

    const values = {
      nonce: getNonce(),
      cspSource: webview.cspSource,
      styleUri: mediaUri('style.css'),
      scriptUri: mediaUri('main.js'),
      hasCredentials,
      welcomeHidden: hasCredentials ? ' hidden' : '',
      chatHidden: hasCredentials ? '' : ' hidden'
    };

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => values[key]);
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

module.exports = { ChatViewProvider };
