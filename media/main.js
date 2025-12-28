const vscode = acquireVsCodeApi();

const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const apiKeyContainer = document.getElementById('api-key-container');
const apiKeyInput = document.getElementById('api-key-input');
const saveApiKeyBtn = document.getElementById('save-api-key-btn');

// Professional Markdown Parser with full formatting support
function formatText(text) {
    if (!text) return '';
    
    // Store code blocks temporarily to prevent formatting inside them
    const codeBlocks = [];
    const inlineCodes = [];
    
    // Extract code blocks first (```language\ncode```)
    let formatted = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const index = codeBlocks.length;
        codeBlocks.push({ lang: lang || 'plaintext', code: code.trim() });
        return `%%CODEBLOCK_${index}%%`;
    });
    
    // Extract inline code (`code`)
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
        const index = inlineCodes.length;
        inlineCodes.push(code);
        return `%%INLINECODE_${index}%%`;
    });
    
    // Escape HTML for the rest
    formatted = formatted
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Headers (must be at start of line)
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
    
    // Bold (**text** or __text__)
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
    formatted = formatted.replace(/__([^_]+)__/g, '<strong class="md-bold">$1</strong>');
    
    // Italic (*text* or _text_) - be careful not to match inside words
    formatted = formatted.replace(/\*([^*\n]+)\*/g, '<em class="md-italic">$1</em>');
    formatted = formatted.replace(/(?:^|[\s])_([^_\n]+)_(?:[\s]|$)/g, ' <em class="md-italic">$1</em> ');
    
    // Strikethrough (~~text~~)
    formatted = formatted.replace(/~~([^~]+)~~/g, '<del class="md-strikethrough">$1</del>');
    
    // Links [text](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>');
    
    // Status indicators with icons
    formatted = formatted.replace(/\b(error|ERROR|Error)(:?\s*)([^\n]*)/g, '<span class="status-error"><span class="status-icon">✖</span><strong>$1</strong>$2$3</span>');
    formatted = formatted.replace(/\b(warning|WARNING|Warning)(:?\s*)([^\n]*)/g, '<span class="status-warning"><span class="status-icon">⚠</span><strong>$1</strong>$2$3</span>');
    formatted = formatted.replace(/\b(success|SUCCESS|Success)(:?\s*)([^\n]*)/g, '<span class="status-success"><span class="status-icon">✔</span><strong>$1</strong>$2$3</span>');
    formatted = formatted.replace(/\b(note|NOTE|Note|info|INFO|Info)(:?\s*)([^\n]*)/g, '<span class="status-info"><span class="status-icon">ℹ</span><strong>$1</strong>$2$3</span>');
    formatted = formatted.replace(/\b(tip|TIP|Tip)(:?\s*)([^\n]*)/g, '<span class="status-tip"><span class="status-icon">💡</span><strong>$1</strong>$2$3</span>');
    
    // Unordered lists (- item or * item at start of line)
    formatted = formatted.replace(/^[\t ]*[-*•]\s+(.+)$/gm, '<li class="md-list-item">$1</li>');
    
    // Ordered lists (1. item at start of line)  
    formatted = formatted.replace(/^[\t ]*(\d+)\.\s+(.+)$/gm, '<li class="md-list-item" value="$1">$2</li>');
    
    // Wrap consecutive list items in ul/ol
    formatted = formatted.replace(/(<li class="md-list-item"[^>]*>[\s\S]*?<\/li>\n?)+/g, (match) => {
        if (match.includes('value="')) {
            return `<ol class="md-ordered-list">${match}</ol>`;
        }
        return `<ul class="md-unordered-list">${match}</ul>`;
    });
    
    // Task lists
    formatted = formatted.replace(/\[x\]/gi, '<input type="checkbox" checked disabled class="md-checkbox">');
    formatted = formatted.replace(/\[\s?\]/g, '<input type="checkbox" disabled class="md-checkbox">');
    
    // Restore code blocks with syntax highlighting
    codeBlocks.forEach((block, index) => {
        const langLabel = block.lang !== 'plaintext' ? `<span class="code-lang">${block.lang}</span>` : '';
        const copyBtn = `<button class="copy-btn" onclick="copyCode(this)" title="Copy code">📋</button>`;
        const escapedCode = block.code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const highlightedCode = highlightSyntax(escapedCode, block.lang);
        formatted = formatted.replace(
            `%%CODEBLOCK_${index}%%`,
            `<div class="code-block-wrapper">${langLabel}${copyBtn}<pre class="md-code-block"><code class="language-${block.lang}">${highlightedCode}</code></pre></div>`
        );
    });
    
    // Restore inline code
    inlineCodes.forEach((code, index) => {
        const escapedCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        formatted = formatted.replace(
            `%%INLINECODE_${index}%%`,
            `<code class="md-inline-code">${escapedCode}</code>`
        );
    });
    
    // Convert line breaks to proper paragraphs
    const lines = formatted.split('\n');
    let result = '';
    let inParagraph = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const isBlockElement = /^<(h[1-6]|ul|ol|li|pre|div|blockquote|hr|table)/.test(line) || 
                               /<\/(h[1-6]|ul|ol|li|pre|div|blockquote|table)>$/.test(line);
        
        if (line === '') {
            if (inParagraph) {
                result += '</p>\n';
                inParagraph = false;
            }
        } else if (isBlockElement) {
            if (inParagraph) {
                result += '</p>\n';
                inParagraph = false;
            }
            result += line + '\n';
        } else {
            if (!inParagraph) {
                result += '<p class="md-paragraph">';
                inParagraph = true;
            } else {
                result += '<br>';
            }
            result += line;
        }
    }
    
    if (inParagraph) {
        result += '</p>';
    }
    
    return result;
}

// Basic syntax highlighting for common languages
function highlightSyntax(code, lang) {
    const keywords = {
        javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined'],
        python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'pass', 'self'],
        java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'super', 'static', 'final', 'void', 'int', 'boolean', 'String', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'true', 'false', 'null'],
        typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'implements', 'interface', 'type', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'public', 'private', 'protected', 'readonly'],
        css: ['color', 'background', 'margin', 'padding', 'border', 'font', 'display', 'position', 'width', 'height', 'top', 'left', 'right', 'bottom', 'flex', 'grid', 'important'],
        html: ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'script', 'style', 'link', 'meta', 'title'],
        bash: ['echo', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'chmod', 'chown', 'sudo', 'apt', 'npm', 'node', 'git', 'docker', 'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'export', 'source']
    };
    
    const langKeywords = keywords[lang] || keywords['javascript'] || [];
    
    // Highlight strings (double and single quotes)
    code = code.replace(/(&quot;|"|')([^"']*?)(\1)/g, '<span class="hl-string">$1$2$3</span>');
    
    // Highlight comments (// and /* */ and #)
    code = code.replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>');
    code = code.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>');
    code = code.replace(/(^|\s)(#[^\n]*)/gm, '$1<span class="hl-comment">$2</span>');
    
    // Highlight numbers
    code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
    
    // Highlight keywords
    langKeywords.forEach(keyword => {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
        code = code.replace(regex, '<span class="hl-keyword">$1</span>');
    });
    
    // Highlight function calls
    code = code.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '<span class="hl-function">$1</span>(');
    
    return code;
}

// Copy code to clipboard function (exposed globally for onclick)
window.copyCode = function(btn) {
    const codeBlock = btn.nextElementSibling.querySelector('code');
    const text = codeBlock.textContent;
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 2000);
    });
};

// Send Message
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    vscode.postMessage({ type: 'userMessage', text: text });
    messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// API Key Handling
saveApiKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        vscode.postMessage({ type: 'saveApiKey', key: key });
        apiKeyContainer.style.display = 'none';
        apiKeyInput.value = '';
    }
});

// Add Message to UI
function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = sender === 'user' ? '👤' : '🤖';

    const content = document.createElement('div');
    content.className = 'content';
    
    // Use formatted HTML for system messages, plain text for user messages
    if (sender === 'system') {
        content.innerHTML = formatText(text);
    } else {
        content.textContent = text;
    }

    div.appendChild(avatar);
    div.appendChild(content);

    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function addConfirmationRequest(text) {
    const div = document.createElement('div');
    div.className = 'message system';

    const content = document.createElement('div');
    content.className = 'content';

    const p = document.createElement('p');
    p.textContent = text;
    content.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Yes';
    yesBtn.onclick = () => {
        vscode.postMessage({ type: 'confirmationResponse', answer: true });
        div.remove();
        addMessage('Yes', 'user');
    };

    const noBtn = document.createElement('button');
    noBtn.textContent = 'No';
    noBtn.className = 'btn-secondary';
    noBtn.onclick = () => {
        vscode.postMessage({ type: 'confirmationResponse', answer: false });
        div.remove();
        addMessage('No', 'user');
    };

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    content.appendChild(actions);

    div.appendChild(content);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Handle Messages from Extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'aiResponse':
            addMessage(message.text, 'system');
            break;
        case 'systemMessage':
            addMessage(message.text, 'system');
            break;
        case 'requestApiKey':
            apiKeyContainer.style.display = 'flex';
            break;
        case 'confirmationRequest':
            addConfirmationRequest(message.text);
            break;
        case 'aiThinking':
            // Optional: Show/Hide spinner
            break;
    }
});
