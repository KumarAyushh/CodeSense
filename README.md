# CodeSense AI - VS Code Extension

[![CI](https://github.com/KumarAyushh/CodeSense/actions/workflows/ci.yml/badge.svg)](https://github.com/KumarAyushh/CodeSense/actions/workflows/ci.yml)

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

### From Marketplace

Install directly from the Visual Studio Marketplace:

- Visual Studio Marketplace: https://marketplace.visualstudio.com/items?itemName=kumarayushh.codesense-ai

Or install from a VSIX file (manual install):

1. Download the latest `codesense-ai-<version>.vsix` file from the releases or build artifacts.
2. In VS Code, open the Command Palette and run `Extensions: Install from VSIX...` and select the downloaded file.

## Usage

1. **Open the Extension**
   - Click on the CodeSense icon in the Activity Bar (left sidebar)

2. **Configure API Key**
   - Select your AI provider (Google Gemini or OpenAI)
   - Enter your API key (stored securely)
   - Keys are stored locally in VS Code SecretStorage and sent only to the provider you choose.

3. **Start Chatting**
   - Ask questions about your code
   - Request code reviews
   - Generate new features
   - Get help with debugging

## Supported AI Providers

- ✅ **Google Gemini** (fully implemented)
- ✅ **OpenAI** (GPT-4o)
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
- Execute shell commands (each one needs your approval)
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
- **Review what changed** right after the AI writes a file (the change is already saved, so use undo or git to revert it)
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
│   ├── ChatViewProvider.js   # Webview host: messages, history, agent runs
│   ├── tools.js              # Agent tool functions and declarations
│   └── diffUtil.js           # Diff visualization utility
├── media/
│   ├── icon.svg              # Extension icon
│   ├── index.html            # Webview markup
│   ├── main.js               # Webview frontend
│   └── style.css             # Webview styles
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

3. Press `F5` to bundle the extension into `dist/` and launch the Extension Development Host. While working, `npm run watch` rebuilds on save; reload the host window to pick up changes.

4. Open any workspace and test the extension

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
- Your messages, plus the file contents and command output the AI reads, are sent to the provider you choose

### Security model

- **Workspace-only paths** - File tools can only touch the first folder open in your workspace. Paths outside it are refused, including through symlinks, and the workspace root itself can't be deleted.
- **Approval prompts** - Deleting a file or folder and running a terminal command each show a prompt with the exact path or command. Nothing runs unless you click **Allow**.
- **Command limits** - Commands run in the workspace folder and are killed after 60 seconds or when you press **Stop**. Long output is truncated before it reaches the AI.
- **Limits of this model** - Creating and overwriting files inside the workspace does not ask for approval. An approved command runs with your own user permissions and is not sandboxed, so it can reach anything you can. Read commands before you allow them.

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
- [x] Code bundling for reduced extension size

## Author

Created with ❤️ by [Kumar Ayush]

## Acknowledgments

- Google Gemini API
- OpenAI API
- VS Code Extension API
