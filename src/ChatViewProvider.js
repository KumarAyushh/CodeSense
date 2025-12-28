const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

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
        const { MultiProviderAgent } = require(path.join(this._extensionUri.fsPath, 'MultiProviderAgent.js'));
        const { toolFunctions, tools } = require(path.join(this._extensionUri.fsPath, 'index.js'));

        this._agent = new MultiProviderAgent(provider, apiKey);
        this._toolFunctions = toolFunctions;
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

      // Interaction Callback for the Agent
      const interactionCallback = async (question) => {
        return await this._askUserInWebview(question);
      };

      // Run the agent with the user's message
      await this._agent.runWithMessage(workspacePath, text, interactionCallback, messageCallback, this._toolFunctions, this._tools);

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
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} https://cdnjs.cloudflare.com;">
  <link
    href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
    rel="stylesheet"
  />

  <title>CodeSense AI</title>
  <style>
    :root {
      --bg-color: #0d1117;
      --sidebar-bg: #161b22;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent: #2563eb; /* Blue instead of green */
      --accent-hover: #3b82f6;
      --border: #30363d;
      --input-bg: #0d1117;
      --shimmer: rgba(255, 255, 255, 0.05);
      --danger: #ef4444;
      --danger-hover: #dc2626;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* UTILITY */
    .hidden { display: none !important; }
    .fade-in { animation: fadeIn 0.3s ease-in-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

    /* LAYOUTS */
    .screen {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 20px;
      box-sizing: border-box;
      height: 100%;
      overflow-y: auto;
    }

    .center-screen {
      justify-content: center;
      align-items: center;
      text-align: center;
    }

    /* WELCOME & CONFIG */
    .brand-logo {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, #58a6ff, #8b949e);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }

    h1 { font-size: 1.5rem; margin: 0 0 10px 0; font-weight: 600; }
    p.subtitle { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.5; max-width: 300px; }

    .card {
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      width: 100%;
      max-width: 320px;
      text-align: left;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }

    .form-group { margin-bottom: 1rem; }
    label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px; }
    
    input, select {
      width: 100%;
      padding: 10px;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.9rem;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s;
    }

    select {
      cursor: pointer;
    }
    input:focus, select:focus { border-color: #58a6ff; }

    .btn {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
    .btn-secondary:hover { border-color: var(--text-secondary); color: var(--text-primary); }

    /* CHAT SCREEN */
    #chat-screen { padding: 0; }
    
    .chat-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--sidebar-bg);
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 0.9rem;
    }

    .icon-btn {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
      padding: 0;
      color: #808080;
    }
    .icon-btn:hover {
      background: var(--border);
      border-color: var(--text-secondary);
    }

    .chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      display: flex;
      gap: 10px;
      max-width: 85%;
      margin-bottom: 4px;
    }

    .message.user { align-self: flex-end; flex-direction: row-reverse; }
    .message.ai { align-self: flex-start; }

    .avatar {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .message.user .avatar { background: #1f6feb; border: 1px solid #1f6feb; }
    .message.ai .avatar { background: var(--border); border: 1px solid var(--border); }

    .content {
      background: var(--sidebar-bg);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      line-height: 1.5;
      border: 1px solid var(--border);
      word-wrap: break-word; /* Ensure long text wraps */
      overflow-wrap: break-word;
    }
    
    .message.user .content {
      background: #1f6feb;
      color: white;
      border-color: #1f6feb;
    }

    .chat-input-area {
      padding: 16px;
      border-top: 1px solid var(--border);
      background: var(--sidebar-bg);
      display: flex;
      gap: 10px;
      align-items: center;
    }

    textarea {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      padding: 12px;
      resize: none;
      height: 48px;
      font-family: inherit;
      box-sizing: border-box;
      overflow: hidden;
    }
    textarea:focus { border-color: #58a6ff; outline: none; }

    .send-btn {
      width: 40px;
      height: 40px;
      border-radius: 6px;
      background: #2d333b;
      color: #e6edf3;
      border: 1px solid var(--border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .send-btn:hover { background: #444c56; border-color: #8b949e; }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .stop-btn {
      width: 40px;
      height: 40px;
      border-radius: 6px;
      background: #2d333b;
      color: #ef4444; /* Keep icon red for visibility or make white? Icon SVG has fill currentColor. I'll make text red so icon is red. */
      border: 1px solid var(--border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .stop-btn:hover { background: #444c56; border-color: #ef4444; }

    /* TYPING INDICATOR */
    .typing { display: flex; gap: 4px; padding: 4px 8px; }
    .dot { width: 6px; height: 6px; background: #8b949e; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out; }
    .dot:nth-child(1) { animation-delay: -0.32s; }
    .dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

    /* ================= SIDEBAR & HISTORY ================= */
    #history-sidebar {
      position: fixed;
      top: 0;
      left: 0;
      width: 250px;
      height: 100vh;
      background: #161b22;
      border-right: 1px solid var(--border);
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }
    
    #history-sidebar.open {
      transform: translateX(0);
      box-shadow: 2px 0 10px rgba(0,0,0,0.5);
    }
    
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--sidebar-bg);
    }
    
    .sidebar-title {
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
      text-transform: uppercase;
    }
    
    .close-sidebar-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 1.2rem;
      padding: 4px;
    }
    .close-sidebar-btn:hover { color: var(--text-primary); }
    
    #history-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }
    
    .history-item {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.2s;
      border-radius: 6px;
      margin-bottom: 4px;
      position: relative;
    }
    
    .history-item:hover {
      background: rgba(255,255,255,0.03);
    }
    
    .history-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }
    
    .history-meta {
      font-size: 0.75rem;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .delete-history-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.9rem;
      padding: 4px;
      opacity: 0;
      transition: opacity 0.2s, color 0.2s;
    }
    
    .history-item:hover .delete-history-btn { opacity: 1; }
    .delete-history-btn:hover { color: var(--danger); }

    /* ================= SETTINGS DROPDOWN ================= */
    .settings-dropdown {
      position: relative;
      display: inline-block;
    }

    .settings-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      min-width: 180px;
      z-index: 1000;
      display: none;
      overflow: hidden;
    }

    .settings-menu.show {
      display: block;
      animation: fadeInDown 0.2s ease;
    }

    @keyframes fadeInDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .settings-menu-item {
      padding: 12px 16px;
      cursor: pointer;
      color: var(--text-primary);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background 0.2s;
      border-bottom: 1px solid var(--border);
    }

    .settings-menu-item:last-child {
      border-bottom: none;
    }

    .settings-menu-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .settings-menu-item.danger {
      color: var(--danger);
    }

    .settings-menu-item.danger:hover {
      background: rgba(239, 68, 68, 0.1);
    }

    /* ================= CONFIRMATION MODAL ================= */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }

    .modal-overlay.show {
      display: flex;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-content {
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: slideUp 0.2s ease;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      color: var(--danger);
      font-size: 1.5rem;
    }

    .modal-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text-primary);
      text-align: center;
      margin-bottom: 8px;
    }

    .modal-message {
      font-size: 0.9rem;
      color: var(--text-secondary);
      text-align: center;
      line-height: 1.5;
      margin-bottom: 20px;
    }

    .modal-buttons {
      display: flex;
      gap: 12px;
    }

    .modal-btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .modal-btn-cancel {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }

    .modal-btn-cancel:hover {
      border-color: var(--text-secondary);
      color: var(--text-primary);
    }

    .modal-btn-confirm {
      background: var(--danger);
      border: none;
      color: white;
    }

    .modal-btn-confirm:hover {
      background: var(--danger-hover);
    }

    .settings-menu-item i {
      width: 16px;
      font-size: 0.9rem;
    }

    /* ================= LOGO ================= */

.code-logo {
  font-size: 4.2rem;                 /* 🔥 Bigger logo */
  font-weight: 800;
  letter-spacing: 2px;
  margin-bottom: 16px;

  /* Blue–White Gradient */
  background: linear-gradient(
    135deg,
    #e6f0ff 0%,
    #7fb0ff 35%,
    #3a7cff 65%,
    #1f4fd8 100%
  );

  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 4px 20px rgba(60, 120, 255, 0.35);
}

.code-logo.small {
  font-size: 2.4rem;
  margin-bottom: 14px;
}

/* ================= BUTTONS ================= */

.button-row {
  display: flex;
  gap: 14px;              /* ✅ Proper spacing between Back & Save */
  margin-top: 22px;
}

/* Primary (Save) Button — Dark Blue Theme */
.btn-primary {
  background: linear-gradient(
    135deg,
    #1f4fd8,
    #2b6bff
  );
  color: #ffffff;
  border: none;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(45, 100, 255, 0.35);
  transition: all 0.25s ease;
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(45, 100, 255, 0.5);
}

/* Secondary (Back) Button */
.btn-secondary {
  background: transparent;
  border: 1px solid rgba(120, 160, 255, 0.35);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  border-color: #5f8dff;
  color: #ffffff;
}

/* Password Toggle Button */
.password-field-wrapper {
  position: relative;
  width: 100%;
}

.password-toggle-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #ffffff;
  cursor: pointer;
  font-size: 18px;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
  opacity: 0.7;
}

.password-toggle-btn:hover {
  color: var(--text-primary);
  opacity: 1;
}

  </style>
</head>
<body>
<!-- SIDEBAR -->
  <div id="history-sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title"><i class="fa-solid fa-comments"></i> Conversations</div>
      <button id="close-sidebar-btn" class="close-sidebar-btn"><i class="fa-solid fa-times"></i></button>
    </div>
    <div id="history-list">
      <!-- History items will be injected here -->
    </div>
  </div>

  <!-- WELCOME -->
  <div id="welcome-screen" class="screen center-screen fade-in${hasCredentials ? ' hidden' : ''}">
  <div class="logo-container">
    <div class="code-logo">&lt;/&gt;</div>
  </div>

  <h1 class="app-title">CodeSense AI</h1>

  <p class="subtitle">
    Your intelligent pair programmer.<br />
    Secure • Fast • Built directly into VS Code
  </p>

  <button id="get-started-btn" class="btn btn-primary">
    Connect API Key
  </button>

  <p class="security-note">
    🔒 API keys are stored securely using VS Code Secrets
  </p>
</div>

<!-- ================= CONFIG SCREEN ================= -->
<div id="config-screen" class="screen center-screen hidden fade-in">
  <div class="config-card">
    <div class="code-logo small">&lt;/&gt;</div>

    <h2 class="config-title">Connect your AI Provider</h2>

    <p class="config-subtitle">
      Choose a provider and enter your API key.<br />
      Keys are encrypted and never leave your machine.
    </p>

    <div class="form-group">
      <label for="provider-select">AI Provider</label>
      <select id="provider-select">
        <option value="gemini">Google Gemini</option>
        <option value="openai">OpenAI</option>
      </select>
    </div>

    <div class="form-group">
      <label for="api-key-input">API Key</label>
      <div class="password-field-wrapper">
        <input
          type="password"
          id="api-key-input"
          placeholder="sk-••••••••••••"
        />
        <button type="button" class="password-toggle-btn" id="toggle-password" title="Toggle visibility">
          <i class="fa-solid fa-eye"></i>
        </button>
      </div>
    </div>

    <div class="button-row">
      <button id="cancel-config-btn" class="btn btn-secondary">
        Back
      </button>
      <button id="save-key-btn" class="btn btn-primary">
        Save & Start
      </button>
    </div>
  </div>
</div>


  <!-- CHAT -->
  <div id="chat-screen" class="screen${hasCredentials ? '' : ' hidden'} fade-in">
    <div class="chat-header">
      <button id="menu-btn" class="icon-btn" title="Menu"><i class="fa-solid fa-bars"></i></button>
      <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; align-items: center; justify-content: center;">
        <span style="font-weight: 700; font-size: 1.1rem; background: linear-gradient(135deg, #58a6ff, #3a7cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1;">&lt;/&gt;</span>
        <span style="font-weight: 700; font-size: 1.1rem; background: linear-gradient(135deg, #58a6ff, #3a7cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1;">CodeSense</span>
      </div>
      <button id="reset-btn" class="icon-btn" title="Reset Conversation"><i class="fa-solid fa-rotate-right"></i></button>
      <div class="settings-dropdown">
        <button id="settings-btn" class="icon-btn" title="Settings"><i class="fa-solid fa-gear"></i></button>
        <div id="settings-menu" class="settings-menu">
          <div class="settings-menu-item" id="change-api-key-btn">
            <i class="fa-solid fa-key"></i>
            <span>Change API Key</span>
          </div>
          <div class="settings-menu-item danger" id="reset-api-key-btn">
            <i class="fa-solid fa-trash-can"></i>
            <span>Reset API Key</span>
          </div>
        </div>
      </div>
    </div>
    
    <div id="messages-container" class="chat-messages">
      <div class="message ai">
        <div class="avatar">🤖</div>
        <div class="content">Hello! I'm ready to help you with your code. What would you like to build today?</div>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea id="message-input" placeholder="Ask me anything..."></textarea>
      <button id="send-btn" class="send-btn" title="Send Message">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
      <button id="stop-btn" class="stop-btn hidden" title="Stop Generation">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
      </button>
    </div>
  </div>

  <!-- CONFIRMATION MODAL -->
  <div id="confirm-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-icon">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </div>
      <div class="modal-title">Reset API Key?</div>
      <div class="modal-message">
        This will permanently delete your stored API key. You'll need to re-enter it to continue using CodeSense AI.
      </div>
      <div class="modal-buttons">
        <button class="modal-btn modal-btn-cancel" id="modal-cancel-btn">Cancel</button>
        <button class="modal-btn modal-btn-confirm" id="modal-confirm-btn">Reset</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Elements
    const screens = {
      welcome: document.getElementById('welcome-screen'),
      config: document.getElementById('config-screen'),
      chat: document.getElementById('chat-screen')
    };

    const inputs = {
      provider: document.getElementById('provider-select'),
      apiKey: document.getElementById('api-key-input'),
      message: document.getElementById('message-input')
    };

    const buttons = {
      getStarted: document.getElementById('get-started-btn'),
      cancelConfig: document.getElementById('cancel-config-btn'),
      saveKey: document.getElementById('save-key-btn'),
      send: document.getElementById('send-btn'),
      stop: document.getElementById('stop-btn')
    };

    const messagesContainer = document.getElementById('messages-container');

    // Track AI processing state
    let isAIProcessing = false;

    // Track where we came from for cancel button
    let previousScreen = 'welcome';

    // Navigation
    function showScreen(screenName) {
      Object.keys(screens).forEach(key => {
        screens[key].classList.add('hidden');
      });
      screens[screenName].classList.remove('hidden');
    }

    // Password toggle functionality
    const toggleBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('api-key-input');

    if (toggleBtn && passwordInput) {
      const icon = toggleBtn.querySelector('i');

      toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';

        passwordInput.type = isPassword ? 'text' : 'password';

        icon.classList.toggle('fa-eye', !isPassword);
        icon.classList.toggle('fa-eye-slash', isPassword);

        toggleBtn.title = isPassword ? 'Hide password' : 'Show password';
      });
    }


    buttons.getStarted.addEventListener('click', () => {
      previousScreen = 'welcome';
      showScreen('config');
    });
    
    buttons.cancelConfig.addEventListener('click', () => {
      showScreen(previousScreen);
    });

    // Settings dropdown menu
    const settingsBtn = document.getElementById('settings-btn');
    const settingsMenu = document.getElementById('settings-menu');
    const changeApiKeyBtn = document.getElementById('change-api-key-btn');
    const resetApiKeyBtn = document.getElementById('reset-api-key-btn');

    // Toggle settings menu
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('show');
      });

      // Close menu when clicking outside
      document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
          settingsMenu.classList.remove('show');
        }
      });
    }

    // Change API Key option
    if (changeApiKeyBtn) {
      changeApiKeyBtn.addEventListener('click', () => {
        settingsMenu.classList.remove('show');
        previousScreen = 'chat';
        inputs.apiKey.value = '';
        inputs.apiKey.style.borderColor = '';
        showScreen('config');
      });
    }

    // Confirmation Modal elements
    const confirmModal = document.getElementById('confirm-modal');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    function showConfirmModal() {
      confirmModal.classList.add('show');
    }

    function hideConfirmModal() {
      confirmModal.classList.remove('show');
    }

    // Modal cancel button
    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', () => {
        hideConfirmModal();
      });
    }

    // Modal confirm button - actually reset the API key
    if (modalConfirmBtn) {
      modalConfirmBtn.addEventListener('click', () => {
        hideConfirmModal();
        // Set previous screen to welcome so user can't go back to chat without key
        previousScreen = 'welcome';
        // Clear API key input
        inputs.apiKey.value = '';
        inputs.apiKey.style.borderColor = '';
        // Clear apiConfigured flag so user must re-enter key
        apiConfigured = false;
        saveState();
        // Send reset message to extension
        vscode.postMessage({ type: 'resetApiKey' });
      });
    }

    // Close modal when clicking overlay
    if (confirmModal) {
      confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
          hideConfirmModal();
        }
      });
    }

    // Reset API Key option - show custom modal
    if (resetApiKeyBtn) {
      resetApiKeyBtn.addEventListener('click', () => {
        settingsMenu.classList.remove('show');
        showConfirmModal();
      });
    }

    // Reset button - reset conversation
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        // Reset conversation - no confirm dialog (not supported well in webviews)
        vscode.postMessage({ type: 'resetConversation' });
        // Reset conversation state variables
        currentConversationId = null;
        currentMessages = [];
        // Clear persisted state
        saveState();
        // Clear messages and show welcome message
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.innerHTML = \`
          <div class="message ai">
            <div class="avatar">🤖</div>
            <div class="content">Hello! I'm ready to help you with your code. What would you like to build today?</div>
          </div>
        \`;
      });
    }

    // ================= SIDEBAR LOGIC =================
    const menuBtn = document.getElementById('menu-btn');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const sidebar = document.getElementById('history-sidebar');
    const historyList = document.getElementById('history-list');

    function toggleSidebar() {
      const isOpen = sidebar.classList.contains('open');
      sidebar.classList.toggle('open', !isOpen);
      if (!isOpen) {
        // Load history when opening
        vscode.postMessage({ type: 'fetchHistory' });
      }
    }

    if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);

    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && 
          !sidebar.contains(e.target) && 
          !menuBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });

    function renderHistory(conversations) {
      historyList.innerHTML = '';
      if (!conversations || conversations.length === 0) {
        historyList.innerHTML = '<div style="padding: 20px; color: var(--text-secondary); text-align: center;">No history yet.</div>';
        return;
      }

      conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const date = new Date(conv.timestamp).toLocaleString();

        item.innerHTML = \`
          <div class="history-title">\${conv.title || 'New Chat'}</div>
          <div class="history-meta">
            <span>\${date}</span>
            <button class="delete-history-btn" title="Delete conversation" data-id="\${conv.id}">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        \`;

        // Click to load conversation
        item.addEventListener('click', (e) => {
          if (e.target.closest('.delete-history-btn')) return; // Ignore delete click
          loadConversation(conv);
          toggleSidebar();
        });

        // Delete button click
        const deleteBtn = item.querySelector('.delete-history-btn');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'deleteHistory', id: conv.id });
        });

        historyList.appendChild(item);
      });
    }

    // Current Conversation State - restore from persisted state if available
    const previousState = vscode.getState() || {};
    let currentConversationId = previousState.currentConversationId || null;
    let currentMessages = previousState.currentMessages || [];
    let apiConfigured = previousState.apiConfigured || ${hasCredentials};

    // Save state to persist across webview visibility changes
    function saveState() {
      vscode.setState({
        currentConversationId,
        currentMessages,
        apiConfigured
      });
    }

    // Restore screen and messages from previous state on load
    if (apiConfigured) {
      // Make sure we show chat screen if API was previously configured
      showScreen('chat');
    }
    if (currentMessages.length > 0) {
      messagesContainer.innerHTML = '';
      currentMessages.forEach(msg => {
        addMessageUI(msg.text, msg.sender);
      });
    }

    function generateId() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    function saveCurrentConversation() {
      if (currentMessages.length === 0) return;

      if (!currentConversationId) {
        currentConversationId = generateId();
      }

      // Title is first user message
      const firstUserMsg = currentMessages.find(m => m.sender === 'user');
      const title = firstUserMsg ? firstUserMsg.text.substring(0, 30) + '...' : 'New Chat';

      const conversation = {
        id: currentConversationId,
        title: title,
        timestamp: Date.now(),
        messages: currentMessages
      };

      vscode.postMessage({ type: 'saveConversation', conversation });
    }

    function loadConversation(conv) {
      currentConversationId = conv.id;
      currentMessages = conv.messages || [];
      // Persist state for webview restoration
      saveState();
      
      messagesContainer.innerHTML = '';
      currentMessages.forEach(msg => {
        addMessageUI(msg.text, msg.sender);
      });
    }

    // Save Logic
    buttons.saveKey.addEventListener('click', () => {
      const provider = inputs.provider.value;
      const key = inputs.apiKey.value.trim();
      
      if (!key) {
        inputs.apiKey.style.borderColor = '#fa7970'; // Red error
        return;
      }

      vscode.postMessage({ type: 'saveApiKey', provider, key });
      // Mark API as configured and persist
      apiConfigured = true;
      saveState();
      showScreen('chat');
    });

    // Chat Logic
    function addMessageUI(text, sender) {
      const div = document.createElement('div');
      div.className = \`message \${sender}\`;
      div.innerHTML = \`
        <div class="avatar">\${sender === 'ai' ? '🤖' : '👤'}</div>
        <div class="content">\${text}</div>
      \`;
      messagesContainer.appendChild(div);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function addMessage(text, sender) {
      addMessageUI(text, sender);
      
      // Save logic
      currentMessages.push({ text, sender });
      // Persist state for webview restoration
      saveState();
      if (sender === 'user' || sender === 'ai') {
        saveCurrentConversation();
      }
    }

    function sendMessage() {
      const text = inputs.message.value.trim();
      if (!text) return;

      addMessage(text, 'user');
      vscode.postMessage({ type: 'userMessage', text });
      inputs.message.value = '';
      
      // Set AI processing state and toggle buttons
      isAIProcessing = true;
      buttons.send.classList.add('hidden');
      buttons.stop.classList.remove('hidden');
      
      // Show local typing indicator
      const typingId = 'typing-' + Date.now();
      const typingDiv = document.createElement('div');
      typingDiv.id = typingId;
      typingDiv.className = \`message ai\`;
      typingDiv.innerHTML = \`
        <div class="avatar">🤖</div>
        <div class="content typing">
          <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        </div>
      \`;
      messagesContainer.appendChild(typingDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    buttons.send.addEventListener('click', sendMessage);
    
    // Stop button handler
    buttons.stop.addEventListener('click', () => {
      isAIProcessing = false;
      buttons.stop.classList.add('hidden');
      buttons.send.classList.remove('hidden');
      
      // Remove typing indicators
      const indicators = document.querySelectorAll('.message.ai .content.typing');
      indicators.forEach(el => el.closest('.message').remove());
      
      // Send stop message to extension
      vscode.postMessage({ type: 'stopGeneration' });
      
      // Add canceled message
      addMessage('Generation stopped by user.', 'ai');
    });
    
    inputs.message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Handle Messages from Extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'switchToChat':
          showScreen('chat');
          break;
        case 'aiResponse':
          // Remove typing indicators only when AI responds
          const aiIndicators = document.querySelectorAll('.message.ai .content.typing');
          aiIndicators.forEach(el => el.closest('.message').remove());
          
          // Reset buttons
          isAIProcessing = false;
          buttons.stop.classList.add('hidden');
          buttons.send.classList.remove('hidden');
          
          addMessage(message.text, 'ai');
          break;
        case 'systemMessage':
          // System messages are displayed but NOT saved to conversation history
          const sysIndicators = document.querySelectorAll('.message.ai .content.typing');
          sysIndicators.forEach(el => el.closest('.message').remove());
          
          // Reset buttons
          isAIProcessing = false;
          buttons.stop.classList.add('hidden');
          buttons.send.classList.remove('hidden');
          
          // Only display UI, don't save to history
          addMessageUI(message.text, 'ai');
          break;
        case 'requestApiKey':
          // Set previous screen to welcome so cancel button goes to welcome, not chat
          previousScreen = 'welcome';
          // Clear the input field
          inputs.apiKey.value = '';
          inputs.apiKey.style.borderColor = '';
          // Clear apiConfigured since backend says we need a key
          apiConfigured = false;
          saveState();
          // Show config screen
          showScreen('config');
          break;
        case 'historyList':
            renderHistory(message.conversations);
            break;
      }
    });

  </script>
</body>
</html>`;
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
