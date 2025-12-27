const vscode = acquireVsCodeApi();

const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const apiKeyContainer = document.getElementById('api-key-container');
const apiKeyInput = document.getElementById('api-key-input');
const saveApiKeyBtn = document.getElementById('save-api-key-btn');

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
    avatar.textContent = sender === 'user' ? '👤' : '<i class="fa-solid fa-robot"></i>';

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;

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
