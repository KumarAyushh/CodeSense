# CLAUDE.md — CodeSense AI

CodeSense AI is a VS Code extension (published on the Marketplace as `kumarayushh.codesense-ai`) that adds an AI chat sidebar. The AI can read/write/delete files and run terminal commands in the open workspace using tool calls. Providers: Google Gemini (working) and OpenAI (partially working — see Phase 1, task 3).

## Project layout

```
src/extension.js          Activation, command registration (addApiKey, resetApiKey)
src/ChatViewProvider.js   Webview sidebar: message handling, history, loads the page from media/
src/tools.js              Tool implementations + tool declarations (no vscode import, so it can be tested in plain Node)
src/diffUtil.js           Opens a VS Code diff view after a file is overwritten; cleans temp diff files
MultiProviderAgent.js     Agent loop (runWithMessage), Gemini <-> OpenAI format conversion, history sanitizing
media/index.html          Webview markup; {{placeholders}} are filled by _getHtmlForWebview
media/main.js, style.css  Webview frontend, loaded via asWebviewUri
```

## Commands

```bash
npm install          # install dependencies
npm run lint         # eslint
npm run build        # bundle src/ into dist/extension.js (npm run watch to rebuild on save)
# Run the extension: open in VS Code and press F5 (builds, then opens the Extension Development Host)
# Publish: npx @vscode/vsce publish patch   (needs Marketplace PAT)
```

## Rules for working in this repo

- **Never test the agent against a real project folder.** Until Phase 1 is done, the AI inside the extension can run any shell command and delete any path on disk. In the Extension Development Host, open an empty scratch folder only.
- Work on a branch per phase (`git checkout -b phase-1-security` etc.), commit after each task, merge when the phase works.
- Keep history format Gemini-style internally (`role: user|model`, `parts: [{text}|{functionCall}|{functionResponse}]`) and convert only at the provider boundary.
- Gemini rule: a model `functionCall` turn must be immediately followed by a `user` turn containing the matching `functionResponse` parts. `_validateAndSanitizeHistory` enforces this — don't break it when changing history code.
- OpenAI rule: an assistant message with `tool_calls` must be followed by one `{ role: "tool", tool_call_id, content }` message per call, with matching ids.
- After each task: run lint, run tests (once they exist), and manually try the feature in the dev host.

---

## Roadmap (do in order, tick as you go)

### Phase 1 — Critical fixes

- [x] **1. Sandbox all file tools to the workspace.**
  Turn the tools in `index.js` into a factory `createTools(workspaceRoot)` and resolve every path through:
  ```js
  function resolveInWorkspace(root, p) {
    const full = path.resolve(root, p);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path outside workspace: ${p}`);
    }
    return full;
  }
  ```
  Apply to `listDirectory`, `readFile`, `writeFile`, `deleteFile`, `deleteDirectory`, `createDirectory`. Also refuse to delete the workspace root itself. Fix `listDirectory`'s skip check to match path segments (it currently skips any path containing "build" or "dist", e.g. `src/builder.js`).

- [x] **2. Require user approval for destructive actions.**
  Before `deleteFile`, `deleteDirectory`, and `runTerminalCommand` execute, show
  `vscode.window.showWarningMessage(<exact path or command>, { modal: true }, 'Allow')`.
  If not allowed, return `{ success: false, error: 'User denied this action' }` to the model.
  For `exec`: set `cwd` to the workspace, `timeout: 60000`, and a `maxBuffer`; truncate very long stdout before sending to the model.
  Remove "Don't ask for permission" from both system prompts (`MultiProviderAgent.js` `run` and `runWithMessage`).

- [x] **3. Fix OpenAI tool calling.**
  - `_convertFromOpenAIResponse`: keep `tc.id` on each function call; wrap `JSON.parse(tc.function.arguments)` in try/catch.
  - Store that id in history (`{ functionCall: { id, name, args } }` and `{ functionResponse: { id, name, response } }`).
  - `_convertToOpenAIMessages`: emit all function calls of a model turn (not just `parts[0]`) with their real ids; emit each `functionResponse` as `{ role: 'tool', tool_call_id: id, content: JSON.stringify(response) }` instead of user text.
  - Test a multi-step task (list → read → write) end to end with an OpenAI key.

- [x] **4. Make the Stop button actually stop.**
  - Gemini: pass `abortSignal: this.abortController.signal` inside `config`.
  - OpenAI: pass `{ signal }` as the second argument to `chat.completions.create`.
  - Check `signal.aborted` before each tool call; keep a reference to the running `exec` child and `kill()` it on stop.

- [x] **5. Fix webview bugs.**
  - Copy buttons use inline `onclick`, which the nonce CSP blocks. Remove the inline handler and use one delegated click listener on the messages container. Then remove `'unsafe-inline'` from `script-src`.
  - Escape `conv.title` (and any other model/user text) before inserting into `innerHTML` in `renderHistory`.
  - Markdown links: only allow `http:`/`https:` URLs and escape `"` in the `href`.

- [x] **6. Make the README accurate.**
  - Replace "Keys are encrypted and never leave your machine" with "Keys are stored locally in VS Code SecretStorage and sent only to the provider you choose."
  - Fix the stale `codesense-ai-1.0.4.vsix` reference.
  - Add a short **Security model** section: workspace-only paths, approval prompts for deletes/commands, command timeout.

- [x] **Release 1.0.8** — bump version, add CHANGELOG.md entry, publish.

### Phase 2 — Cleanup

- [x] **7. Rename `lec7` → `codesense`** for all command, view, and container ids in `package.json` and code.
- [x] **8. Move webview code out of `ChatViewProvider.js`** into `media/main.js` and `media/style.css`, loaded via `webview.asWebviewUri(...)` with the nonce on the script tag. Goal: `ChatViewProvider.js` under ~300 lines.
- [x] **9. Split `index.js`.** Move extension tools to `src/tools.js`. Either delete the standalone CLI agent (`CodeReviewAgent` / duplicate `run()` loop) or move it to `cli/`. Remove `readline-sync` and `dotenv` from extension dependencies if unused.
- [x] **10. Remove dead code**: commented-out blocks in `extension.js` and `index.js`, the stale ESM comment at the top of `ChatViewProvider.js`, the unused `run()` in `MultiProviderAgent.js`, the unused `clearApiKey` message case, the no-op `onDidChangeVisibility` handler.
- [x] **11. Bundle with esbuild.** Output to `dist/extension.js`, point `main` at it, and exclude `node_modules` in `.vscodeignore` (it is currently shipped in the .vsix).

### Phase 3 — Quality

- [ ] **12. Add tests** (`node:test` or mocha) for pure logic:
  - `resolveInWorkspace` (inside, `../`, absolute path, root itself)
  - `_validateAndSanitizeHistory` (orphan function calls, trailing call, history starting with model)
  - OpenAI conversion round trip (multiple tool calls, ids match)
- [ ] **13. ESLint config + GitHub Actions CI** running `npm ci`, lint, tests, and `vsce package` on every push/PR. Add the CI badge to the README.
- [ ] **14. Settings for models.** Replace hard-coded `gemini-2.5-flash` / `gpt-4o` with `codesense.model.gemini` / `codesense.model.openai` settings in `contributes.configuration`.
- [ ] **Release 1.1.0** — CHANGELOG, publish.

### Phase 4 — New features (pick 1–2 that make the project stand out)

- [ ] **15. Preview-before-write.** Show the diff *before* writing, with Accept / Reject buttons. Only write on Accept. (Today the diff appears after the file is already changed.)
- [ ] **16. Review mode.** A "Review workspace" command that runs ESLint and the project's test script first, then gives the results to the model so the review is grounded in real output.
- [ ] **17. Demo + write-up.** Add a GIF of the extension in action to the README and a short "How it works" section: agent loop, history sanitizing, Gemini↔OpenAI tool-call conversion, security model.
- [ ] **18. Anthropic provider** (optional) — implement with `@anthropic-ai/sdk` using the same internal history format, or remove Anthropic/Groq from the provider picker until done.