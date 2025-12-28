# CodeSense AI - VS Code Extension

An intelligent AI-powered code reviewer and assistant built directly into VS Code.

## Features

- 🤖 **Multi-Provider AI Support** - Works with Google Gemini and OpenAI
- 💬 **Interactive Chat Interface** - Beautiful chat UI with persistent conversation state
- 🔒 **Secure API Key Storage** - Keys stored securely using VS Code Secrets
- 💾 **Chat Persistence** - Conversations persist across view switches and VS Code restarts
- 🛠️ **Code Operations** - Read, write, create, and delete files with AI assistance
- 📁 **Directory Management** - Create folders and manage project structure
- ⚡ **Terminal Integration** - Run commands directly from the AI assistant
- 📝 **Conversation History** - Save and reload past conversations
- 🎨 **Dark Theme UI** - Beautiful gradient design that matches VS Code
- 🔄 **Diff Visualization** - Side-by-side code comparison for AI-suggested changes
- ♻️ **Reset Conversation** - Clear chat history instantly with one click

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/KumarAyushh/CodeSense.git
   cd CodeSense
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Press `F5` in VS Code to launch the Extension Development Host

### From VSIX (Coming Soon)

Install directly from the Visual Studio Marketplace (when published).

## Usage

1. **Open the Extension**
   - Click on the CodeSense icon in the Activity Bar (left sidebar)

2. **Configure API Key**
   - Select your AI provider (Google Gemini or OpenAI)
   - Enter your API key (stored securely)
   - Keys are encrypted and never leave your machine

3. **Start Chatting**
   - Ask questions about your code
   - Request code reviews
   - Generate new features
   - Get help with debugging

## Supported AI Providers

- ✅ **Google Gemini** (fully implemented)
- ✅ **OpenAI** (GPT-4o and GPT-4o-mini)
- 🚧 **Anthropic Claude** (coming soon)
- 🚧 **Groq** (coming soon)

## Get API Keys

- **Google Gemini**: [Get API Key](https://makersuite.google.com/app/apikey)
- **OpenAI**: [Get API Key](https://platform.openai.com/api-keys)

## Features in Detail

### Code Analysis
- Read and analyze files in your workspace
- Understand project structure
- Review code quality and suggest improvements

### File Operations
- Create new files with AI-generated content
- Modify existing files
- Delete files (with confirmation)
- Create directory structures

### Terminal Commands
- Execute shell commands
- Install packages
- Run build scripts
- Manage git operations

### Conversation Management
- Auto-save conversations
- Load previous chats
- Delete unwanted history
- Context-aware responses (20 message history)
- **Persistent chat state** - Messages remain when switching between VS Code views
- **One-click reset** - Clear current conversation and start fresh instantly

### Diff Visualization
- **Automatic side-by-side comparison** when AI modifies existing code
- **Visual changes display** with green additions and red deletions
- **One-click review** before accepting AI changes
- **Native VS Code diff viewer** - familiar interface
- **Auto-cleanup** of temporary diff files (1 hour expiration)

When you ask AI to fix or modify code, CodeSense automatically opens the diff view with the title **"CodeSense: AI Suggested Changes"** showing exactly what changed.

## Configuration

The extension stores settings securely:
- `ai_provider` - Selected AI provider
- `ai_api_key` - Your API key (encrypted)

No manual configuration files needed!

## Development

### Project Structure
```
CodeSense/
├── src/
│   ├── extension.js          # Extension entry point
│   ├── ChatViewProvider.js   # Webview UI and logic
│   └── diffUtil.js           # Diff visualization utility
├── media/
│   ├── icon.svg              # Extension icon
│   ├── main.js               # Webview frontend
│   └── style.css             # Webview styles
├── index.js                  # Agent tool functions
├── MultiProviderAgent.js     # AI provider abstraction
└── package.json              # Extension manifest
```

### Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Open in VS Code:
   ```bash
   code .
   ```

3. Press `F5` to launch Extension Development Host

4. Open any workspace and test the extension

## Standalone CLI Mode

The agent can also run standalone (outside VS Code):

```bash
# Set your API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Run the agent
node index.js
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## Security

- API keys are stored using VS Code's secure secret storage
- Keys are never transmitted except to the official AI provider APIs
- No telemetry or data collection
- All processing happens locally

## License

MIT License - see LICENSE file for details

## Troubleshooting

### Extension not activating
- Ensure you're using VS Code 1.80.0 or later
- Check the Output panel (Help → Toggle Developer Tools → Console)

### API key not saving
- Restart VS Code after entering the key
- Check VS Code's secret storage permissions

### AI not responding
- Verify your API key is correct
- Check your internet connection
- Ensure you have API quota remaining

## Roadmap

- [x] Chat persistence across view switches
- [x] One-click conversation reset
- [x] System message handling
- [ ] Support for Anthropic Claude
- [ ] Support for Groq
- [ ] Multi-file refactoring
- [ ] Custom prompt templates
- [ ] Export conversations to markdown
- [ ] Settings UI for customization
- [ ] Code bundling for reduced extension size

## Author

Created with ❤️ by [Kumar Ayush]

## Acknowledgments

- Google Gemini API
- OpenAI API
- VS Code Extension API
