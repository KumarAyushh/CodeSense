const vscode = acquireVsCodeApi();

// ==========================================
// Professional Markdown Parser
// ==========================================
function formatText(text) {
  if (!text) return '';
  
  const codeBlocks = [];
  const inlineCodes = [];
  
  // Extract code blocks first
  let formatted = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'plaintext', code: code.trim() });
    return '%%CODEBLOCK_' + index + '%%';
  });
  
  // Extract inline code
  formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(code);
    return '%%INLINECODE_' + index + '%%';
  });
  
  // Escape HTML
  formatted = formatted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Headers
  formatted = formatted.replace(/^######\s+(.+)$/gm, '<h6 class="md-header">$1</h6>');
  formatted = formatted.replace(/^#####\s+(.+)$/gm, '<h5 class="md-header">$1</h5>');
  formatted = formatted.replace(/^####\s+(.+)$/gm, '<h4 class="md-header">$1</h4>');
  formatted = formatted.replace(/^###\s+(.+)$/gm, '<h3 class="md-header">$1</h3>');
  formatted = formatted.replace(/^##\s+(.+)$/gm, '<h2 class="md-header">$1</h2>');
  formatted = formatted.replace(/^#\s+(.+)$/gm, '<h1 class="md-header">$1</h1>');
  
  // Horizontal rules
  formatted = formatted.replace(/^[-*_]{3,}$/gm, '<hr class="md-hr">');
  
  // Blockquotes
  formatted = formatted.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
  
  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
  formatted = formatted.replace(/__([^_]+)__/g, '<strong class="md-bold">$1</strong>');
  
  // Italic
  formatted = formatted.replace(/\*([^*\n]+)\*/g, '<em class="md-italic">$1</em>');
  
  // Strikethrough
  formatted = formatted.replace(/~~([^~]+)~~/g, '<del class="md-strikethrough">$1</del>');
  
  // Links
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    if (!/^https?:\/\//i.test(url)) return match;
    return '<a href="' + url.replace(/"/g, '&quot;') + '" class="md-link" target="_blank">' + label + '</a>';
  });
  
  // Status indicators
  formatted = formatted.replace(/\b(Error|ERROR|error)(:?\s*)([^\n]*)/g, '<span class="status-error"><span class="status-icon">✖</span><strong>$1</strong>$2$3</span>');
  formatted = formatted.replace(/\b(Warning|WARNING|warning)(:?\s*)([^\n]*)/g, '<span class="status-warning"><span class="status-icon">⚠</span><strong>$1</strong>$2$3</span>');
  formatted = formatted.replace(/\b(Success|SUCCESS|success)(:?\s*)([^\n]*)/g, '<span class="status-success"><span class="status-icon">✔</span><strong>$1</strong>$2$3</span>');
  formatted = formatted.replace(/\b(Note|NOTE|note|Info|INFO|info)(:?\s*)([^\n]*)/g, '<span class="status-info"><span class="status-icon">ℹ</span><strong>$1</strong>$2$3</span>');
  formatted = formatted.replace(/\b(Tip|TIP|tip)(:?\s*)([^\n]*)/g, '<span class="status-tip"><span class="status-icon">💡</span><strong>$1</strong>$2$3</span>');
  
  // Unordered lists
  formatted = formatted.replace(/^[\t ]*[-*•]\s+(.+)$/gm, '<li class="md-list-item">$1</li>');
  
  // Ordered lists
  formatted = formatted.replace(/^[\t ]*(\d+)\.\s+(.+)$/gm, '<li class="md-list-item" value="$1">$2</li>');
  
  // Wrap lists
  formatted = formatted.replace(/(<li class="md-list-item"[^>]*>[\s\S]*?<\/li>\n?)+/g, (match) => {
    if (match.includes('value="')) {
      return '<ol class="md-ordered-list">' + match + '</ol>';
    }
    return '<ul class="md-unordered-list">' + match + '</ul>';
  });
  
  // Restore inline code
  inlineCodes.forEach((code, index) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    formatted = formatted.replace('%%INLINECODE_' + index + '%%', () => '<code class="md-inline-code">' + escaped + '</code>');
  });
  
  // Convert line breaks
  const lines = formatted.split('\n');
  let result = '';
  let inParagraph = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isBlock = /^(<(h[1-6]|ul|ol|li|pre|div|blockquote|hr)|%%CODEBLOCK_)/.test(line) || /<\/(h[1-6]|ul|ol|li|pre|div|blockquote)>$/.test(line);
    
    if (line === '') {
      if (inParagraph) { result += '</p>\n'; inParagraph = false; }
    } else if (isBlock) {
      if (inParagraph) { result += '</p>\n'; inParagraph = false; }
      result += line + '\n';
    } else {
      if (!inParagraph) { result += '<p class="md-paragraph">'; inParagraph = true; }
      else { result += '<br>'; }
      result += line;
    }
  }
  if (inParagraph) result += '</p>';

  // Restore code blocks with highlighting (after the line handling above, which would strip their indentation)
  codeBlocks.forEach((block, index) => {
    const langLabel = block.lang !== 'plaintext' ? '<span class="code-lang">' + block.lang + '</span>' : '';
    const copyBtn = '<button class="copy-btn" title="Copy code">📋</button>';
    let code = block.code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    code = highlightSyntax(code, block.lang);
    result = result.replace(
      '%%CODEBLOCK_' + index + '%%',
      () => '<div class="code-block-wrapper">' + langLabel + copyBtn + '<pre class="md-code-block"><code>' + code + '</code></pre></div>'
    );
  });

  return result;
}

function highlightSyntax(code, lang) {
  const keywords = {
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'true', 'false', 'null', 'undefined'],
    python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'pass', 'self'],
    java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'new', 'this', 'static', 'final', 'void', 'int', 'boolean', 'String', 'try', 'catch', 'throw', 'import', 'package', 'true', 'false', 'null'],
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'interface', 'type', 'import', 'export', 'async', 'await', 'try', 'catch', 'throw', 'typeof', 'true', 'false', 'null', 'undefined', 'public', 'private', 'protected', 'readonly']
  };
  
  const langKw = keywords[lang] || keywords['javascript'] || [];

  // Match everything in one pass, so no rule can run inside the spans added by another
  const tokens = [
    { className: 'hl-comment', pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/.source },
    { className: 'hl-string', pattern: /".*?"|'.*?'/.source },
    { className: 'hl-number', pattern: /\b\d+\.?\d*\b/.source },
    { className: 'hl-keyword', pattern: '\\b(?:' + langKw.join('|') + ')\\b' },
    { className: 'hl-function', pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/.source }
  ];
  const tokenRegex = new RegExp(tokens.map(t => '(' + t.pattern + ')').join('|'), 'g');

  return code.replace(tokenRegex, (match, ...groups) => {
    const token = tokens[groups.findIndex(group => group !== undefined)];
    return '<span class="' + token.className + '">' + match + '</span>';
  });
}

// Copy code function
function copyCode(btn) {
  const codeBlock = btn.nextElementSibling.querySelector('code');
  const text = codeBlock.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '📋'; }, 2000);
  }).catch(() => {
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '📋'; }, 2000);
  });
}

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

// One listener for every copy button, including ones added later
messagesContainer.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) copyCode(copyBtn);
});

// Track AI processing state

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
    messagesContainer.innerHTML = `
      <div class="message ai">
        <div class="avatar">🤖</div>
        <div class="content">Hello! I'm ready to help you with your code. What would you like to build today?</div>
      </div>
    `;
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

    item.innerHTML = `
      <div class="history-title">${escapeHtml(conv.title || 'New Chat')}</div>
      <div class="history-meta">
        <span>${escapeHtml(date)}</span>
        <button class="delete-history-btn" title="Delete conversation" data-id="${escapeHtml(conv.id)}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

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
let apiConfigured = previousState.apiConfigured || document.body.dataset.hasCredentials === 'true';

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
  div.className = `message ${sender}`;
  
  // Use formatted HTML for AI messages, plain text for user
  const formattedText = sender === 'ai' ? formatText(text) : escapeHtml(text);
  
  div.innerHTML = `
    <div class="avatar">${sender === 'ai' ? '🤖' : '👤'}</div>
    <div class="content">${formattedText}</div>
  `;
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  // Start a new activity feed (one left over from a stopped run stays on screen)
  clearActivityContainer();

  addMessage(text, 'user');
  vscode.postMessage({ type: 'userMessage', text });
  inputs.message.value = '';
  
  // Toggle buttons
  buttons.send.classList.add('hidden');
  buttons.stop.classList.remove('hidden');
  
  // Show local typing indicator
  const typingId = 'typing-' + Date.now();
  const typingDiv = document.createElement('div');
  typingDiv.id = typingId;
  typingDiv.className = `message ai`;
  typingDiv.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="content typing">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    </div>
  `;
  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

buttons.send.addEventListener('click', sendMessage);

// Stop button handler
buttons.stop.addEventListener('click', () => {
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
      apiConfigured = true;
      saveState();
      showScreen('chat');
      break;
    case 'activityUpdate':
      handleActivityUpdate(message.activity);
      break;
    case 'aiResponse':
      // Remove typing indicators and activity container when AI responds
      document.querySelectorAll('.message.ai .content.typing').forEach(el => el.closest('.message').remove());
      
      // Clear activity container
      clearActivityContainer();
      
      // Reset buttons
      buttons.stop.classList.add('hidden');
      buttons.send.classList.remove('hidden');
      
      addMessage(message.text, 'ai');
      break;
    case 'systemMessage':
      // System messages are displayed but NOT saved to conversation history
      document.querySelectorAll('.message.ai .content.typing').forEach(el => el.closest('.message').remove());
      
      // Clear activity container
      clearActivityContainer();
      
      // Reset buttons
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

// ==========================================
// Activity Feed Functions (Premium Feature)
// ==========================================

let activityContainer = null;
const activityItems = new Map();

function getActivityIcon(toolType) {
  const icons = {
    'writeFile': { icon: '📄', class: 'file' },
    'readFile': { icon: '👁️', class: 'read' },
    'deleteFile': { icon: '🗑️', class: 'delete' },
    'deleteDirectory': { icon: '🗑️', class: 'delete' },
    'createDirectory': { icon: '📁', class: 'folder' },
    'listDirectory': { icon: '🔍', class: 'scan' },
    'runTerminalCommand': { icon: '⌨️', class: 'terminal' }
  };
  return icons[toolType] || { icon: '⚙️', class: 'file' };
}

function getStatusIcon(status) {
  if (status === 'running') {
    return '<div class="activity-spinner"></div>';
  } else if (status === 'success') {
    return '✓';
  } else if (status === 'error') {
    return '✗';
  }
  return '';
}

function handleActivityUpdate(activity) {
  // Create activity container if doesn't exist
  if (!activityContainer || !document.contains(activityContainer)) {
    // Remove typing indicator first
    const typingIndicators = document.querySelectorAll('.message.ai .content.typing');
    typingIndicators.forEach(el => el.closest('.message').remove());
    
    // Create new activity message
    const activityMessage = document.createElement('div');
    activityMessage.className = 'message ai';
    activityMessage.innerHTML = `
      <div class="avatar">🤖</div>
      <div class="content">
        <div class="activity-container" id="activity-feed"></div>
      </div>
    `;
    messagesContainer.appendChild(activityMessage);
    activityContainer = activityMessage.querySelector('#activity-feed');
  }
  
  const activityId = activity.type + '-' + (activity.details || activity.name);
  const iconInfo = getActivityIcon(activity.type);
  
  // Check if activity item already exists
  let existingItem = activityItems.get(activityId);
  
  if (existingItem) {
    // Update existing item status
    const statusEl = existingItem.querySelector('.activity-status');
    statusEl.innerHTML = getStatusIcon(activity.status);
    statusEl.className = 'activity-status ' + activity.status;
  } else {
    // Create new activity item
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div class="activity-icon ${iconInfo.class}">${iconInfo.icon}</div>
      <div class="activity-content">
        <div class="activity-name">${escapeHtml(activity.name)}</div>
        ${activity.details ? '<div class="activity-details">' + escapeHtml(truncatePath(activity.details)) + '</div>' : ''}
      </div>
      <div class="activity-status ${activity.status}">${getStatusIcon(activity.status)}</div>
    `;
    
    activityContainer.appendChild(item);
    activityItems.set(activityId, item);
  }
  
  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function truncatePath(path) {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length > 3) {
    return '.../' + parts.slice(-3).join('/');
  }
  return path;
}

function clearActivityContainer() {
  activityContainer = null;
  activityItems.clear();
}
