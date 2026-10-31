# Changelog

## 1.1.0

### Security

- File tools are limited to the workspace. Paths outside it are refused, including through symlinks, and the workspace root can't be deleted.
- Deleting files or folders and running terminal commands now require your approval in a prompt that shows the exact path or command.
- Commands run in the workspace folder with a 60 second timeout, and long output is truncated before it reaches the AI.
- Stricter webview security: removed `'unsafe-inline'` scripts, escaped conversation titles and activity text, and only allow `http`/`https` links in AI responses.
- Updated bundled dependencies to fix known vulnerabilities, including `ws`.

### Added

- `codesense.model.gemini` and `codesense.model.openai` settings choose the model. Changes apply from your next message and keep the current conversation.

### Changed

- Command and view ids changed from `lec7.*` to `codesense.*`. Custom keybindings for the old command ids need updating, and the sidebar may return to its default position once.
- The extension is now bundled into a single file, which makes the download much smaller.

### Removed

- The standalone CLI mode (`node index.js`).

### Fixed

- OpenAI: multi-step tasks now work. Tool calls keep their ids, a turn can contain several calls, and long tasks no longer fail after history trimming.
- The Stop button now cancels the AI request and kills the running command, including processes the command started.
- Copy buttons on code blocks work again.
- Code blocks no longer show stray `class="hl-keyword">` text, and they keep their line breaks and indentation.
- The file list no longer skips paths that merely contain "build" or "dist", such as `src/builder.js`.
- The API key screen no longer says keys never leave your machine. They are sent to the provider you choose.
- File and folder names that start with two dots, such as `..config`, are no longer refused as outside the workspace.
- The **CodeSense: Add API Key** command now works. It used to save keys where the AI never read them. It also no longer offers Anthropic and Groq, which aren't available yet.
- A new API key now takes effect on your next message instead of possibly staying on the old key until VS Code reloads. Saving a key starts a new AI conversation.

### Docs

- README corrected on where keys and data go, and now describes the security model.
