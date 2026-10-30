# Changelog

## 1.0.8

### Security

- File tools are limited to the workspace. Paths outside it are refused, including through symlinks, and the workspace root can't be deleted.
- Deleting files or folders and running terminal commands now require your approval in a prompt that shows the exact path or command.
- Commands run in the workspace folder with a 60 second timeout, and long output is truncated before it reaches the AI.
- Stricter webview security: removed `'unsafe-inline'` scripts, escaped conversation titles and activity text, and only allow `http`/`https` links in AI responses.

### Fixed

- OpenAI: multi-step tasks now work. Tool calls keep their ids, a turn can contain several calls, and long tasks no longer fail after history trimming.
- The Stop button now cancels the AI request and kills the running command, including processes the command started.
- Copy buttons on code blocks work again.
- Code blocks no longer show stray `class="hl-keyword">` text, and they keep their line breaks and indentation.
- The file list no longer skips paths that merely contain "build" or "dist", such as `src/builder.js`.

### Docs

- README corrected on where keys and data go, and now describes the security model.
