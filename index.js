const { GoogleGenAI, Type } = require("@google/genai");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");
const readlineSync = require("readline-sync");

// Import diff utility (will be undefined in CLI mode, only works in VS Code)
let showDiff = null;
try {
  const diffUtil = require("./src/diffUtil");
  showDiff = diffUtil.showDiff;
} catch (e) {
  // Running in CLI mode, diff not available
  showDiff = null;
}



// ✅ No fetch polyfill needed in VS Code extension
// Node 18+ already provides global fetch

dotenv.config();

// // Polyfill fetch for Node.js (ESM)
// if (typeof globalThis !== "undefined" && !globalThis.fetch) {
//   try {
//     // Node 18+ (undici is built-in)
//     const { fetch } = await import("undici");
//     globalThis.fetch = fetch;
//   } catch {
//     try {
//       // Fallback for older Node versions
//       const fetchModule = await import("node-fetch");
//       globalThis.fetch = fetchModule.default;
//     } catch {
//       console.warn("⚠️ No fetch polyfill available.");
//     }
//   }
// }


// ============================================
// WORKSPACE SANDBOX
// ============================================

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

function assertInWorkspace(root, full, p) {
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path outside workspace: ${p}`);
  }
}

function pathExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    return false;
  }
}

function resolveInWorkspace(root, p) {
  const full = path.resolve(root, p);
  assertInWorkspace(root, full, p);

  // A symlink inside the workspace can point outside it, so check the real
  // location too. New files don't exist yet: check their closest existing parent.
  let existing = full;
  while (!pathExists(existing)) {
    existing = path.dirname(existing);
  }
  assertInWorkspace(fs.realpathSync(root), fs.realpathSync(existing), p);

  return full;
}

// ============================================
// TOOL FUNCTIONS
// ============================================

const USER_DENIED = "User denied this action";
const STOPPED_BY_USER = "Stopped by user";
const COMMAND_TIMEOUT_MS = 60000;
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 20000;

function truncateOutput(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated ${text.length - MAX_OUTPUT_CHARS} characters]`;
}

function killProcessTree(child) {
  if (process.platform === "win32") {
    // child.kill() would only end the cmd.exe shell and leave npm, node etc. running
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  } else {
    child.kill();
  }
  // Don't wait on pipes a surviving process may still hold open
  child.stdout?.destroy();
  child.stderr?.destroy();
}

// `confirm(message)` asks the user to approve a destructive action. Without one, those actions are denied.
function createTools(workspaceRoot, { confirm = async () => false } = {}) {
  const root = path.resolve(workspaceRoot);

  async function listDirectory({ directory }) {
    const files = [];
    const extension = [".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".json", ".md"]; // Added json/md for context

    function scanDir(dir) {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (SKIPPED_DIRS.has(item)) continue;

          const fullPath = path.join(dir, item);
          const stat = fs.lstatSync(fullPath); // lstat: don't follow symlinks out of the workspace
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (stat.isFile()) {
            const ext = path.extname(item);
            if (extension.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (err) {
        console.error(`Error scanning directory ${dir}:`, err.message);
      }
    }

    try {
      const fullDirectory = resolveInWorkspace(root, directory);
      scanDir(fullDirectory);
      console.log(`Found ${files.length} files in ${fullDirectory}`);
      return { files };
    } catch (err) {
      return { error: err.message };
    }
  }

  async function readFile({ file_path }) {
    try {
      const fullPath = resolveInWorkspace(root, file_path);
      const contents = fs.readFileSync(fullPath, "utf-8");
      console.log(`Reading: ${fullPath}`);
      return { contents };
    } catch (err) {
      return { error: `Failed to read file: ${err.message}` };
    }
  }

  async function writeFile({ file_path, contents }) {
    try {
      const fullPath = resolveInWorkspace(root, file_path);

      // Ensure parent directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }

      // Read original content if file exists (for diff)
      let originalContent = '';
      const fileExists = fs.existsSync(fullPath);
      if (fileExists) {
        originalContent = fs.readFileSync(fullPath, 'utf-8');
      }

      // Write new content
      fs.writeFileSync(fullPath, contents, "utf-8");
      console.log(`✅ Writing: ${fullPath}`);

      // Show diff if modifying existing file and running in VS Code
      if (fileExists && originalContent !== contents && showDiff) {
        try {
          await showDiff(fullPath, originalContent, contents);
        } catch (e) {
          console.warn('Could not show diff:', e.message);
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteFile({ file_path }) {
    try {
      const fullPath = resolveInWorkspace(root, file_path);
      if (fs.existsSync(fullPath)) {
        if (!(await confirm(`Delete file: ${fullPath}`))) {
          return { success: false, error: USER_DENIED };
        }
        fs.unlinkSync(fullPath);
        console.log(`🗑️ Deleted: ${fullPath}`);
        return { success: true };
      }
      return { success: false, error: "File not found" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteDirectory({ directory_path, recursive = true }) {
    try {
      const fullPath = resolveInWorkspace(root, directory_path);
      if (path.relative(root, fullPath) === "") {
        return { success: false, error: "Refusing to delete the workspace root" };
      }

      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) {
          return { success: false, error: "Path is not a directory" };
        }

        if (!(await confirm(`Delete folder${recursive ? " and everything in it" : ""}: ${fullPath}`))) {
          return { success: false, error: USER_DENIED };
        }

        if (recursive) {
          // Recursively delete directory and all contents
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          // Only delete if empty
          const contents = fs.readdirSync(fullPath);
          if (contents.length > 0) {
            return { success: false, error: "Directory is not empty. Use recursive=true to delete non-empty directories." };
          }
          fs.rmdirSync(fullPath);
        }

        console.log(`🗑️ Deleted Directory: ${fullPath}`);
        return { success: true };
      }
      return { success: false, error: "Directory not found" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function createDirectory({ directory_path }) {
    try {
      const fullPath = resolveInWorkspace(root, directory_path);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`📁 Created Directory: ${fullPath}`);
        return { success: true };
      }
      return { success: true, message: "Directory already exists" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function runTerminalCommand({ command }, { signal } = {}) {
    if (!command) {
      return { success: false, error: "No command given" };
    }
    if (!(await confirm(`Run command: ${command}`))) {
      return { success: false, error: USER_DENIED };
    }

    console.log(`💻 Executing Command: ${command}`);
    return new Promise((resolve) => {
      let stopReason = null;

      const child = exec(command, { cwd: root, maxBuffer: COMMAND_MAX_BUFFER }, (error, stdout, stderr) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);

        if (error) {
          resolve({ success: false, error: truncateOutput(stopReason || error.message), stdout: truncateOutput(stdout), stderr: truncateOutput(stderr) });
          return;
        }
        resolve({ success: true, stdout: truncateOutput(stdout), stderr: truncateOutput(stderr) });
      });

      const stop = (reason) => {
        stopReason = reason;
        killProcessTree(child);
      };
      const onAbort = () => stop(STOPPED_BY_USER);

      // Not exec's `timeout` option: that uses child.kill(), see killProcessTree
      const timer = setTimeout(() => stop(`Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`), COMMAND_TIMEOUT_MS);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  return {
    listDirectory,
    readFile,
    writeFile,
    deleteFile,
    deleteDirectory,
    createDirectory,
    runTerminalCommand,
  };
}

// ============================================
// TOOL DECLARATIONS
// ============================================
const tools = [
  {
    functionDeclarations: [
      {
        name: "listDirectory",
        description: "Lists all files in a directory.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            directory: { type: Type.STRING, description: "Directory path to scan" },
          },
          required: ["directory"],
        },
      },
      {
        name: "readFile",
        description: "Reads a file's content.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            file_path: { type: Type.STRING, description: "Path of the file" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "writeFile",
        description: "Writes content to a file. Overwrites if exists.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            file_path: { type: Type.STRING, description: "Path of the file" },
            contents: { type: Type.STRING, description: "Content to write" },
          },
          required: ["file_path", "contents"],
        },
      },
      {
        name: "deleteFile",
        description: "Deletes a file.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            file_path: { type: Type.STRING, description: "Path of the file to delete" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "deleteDirectory",
        description: "Deletes a directory/folder. Can recursively delete all contents.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            directory_path: { type: Type.STRING, description: "Path of the directory to delete" },
            recursive: { type: Type.BOOLEAN, description: "If true, deletes all contents recursively. Default is true." },
          },
          required: ["directory_path"],
        },
      },
      {
        name: "createDirectory",
        description: "Creates a new directory.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            directory_path: { type: Type.STRING, description: "Path of the directory" },
          },
          required: ["directory_path"],
        },
      },
      {
        name: "runTerminalCommand",
        description: "Executes a shell command.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING, description: "Command to execute" },
          },
          required: ["command"],
        },
      },
    ],
  },
];

// ============================================
// CORE AGENT CLASS
// ============================================

class CodeReviewerAgent {
  constructor(apiKey) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = "gemini-2.5-flash"; // Upgraded model
  }

  async run(directoryPath, interactionCallback) {
    const toolFunctions = createTools(directoryPath, {
      confirm: async (message) => readlineSync.keyInYN(`\n${message}`) === true,
    });

    console.log("Starting Code Review Agent...");
    console.log(`Target: ${directoryPath}\n`);

    const initialPrompt = {
      role: "user",
      parts: [{ text: `Review and improve the codebase in: ${directoryPath}. If there are tests, run them. If there are bugs, fix them.` }],
    };

    const History = [initialPrompt];
    const MAX_HISTORY_LENGTH = 20;

    let mode = "dry-run";

    // Helper function to trim history while keeping initial prompt
    const trimHistory = () => {
      if (History.length > MAX_HISTORY_LENGTH) {
        // Keep the initial prompt and the most recent messages
        const recentMessages = History.slice(-(MAX_HISTORY_LENGTH - 1));
        History.length = 0;
        History.push(initialPrompt, ...recentMessages);
        console.log(`📊 History trimmed to ${MAX_HISTORY_LENGTH} messages to save tokens`);
      }
    };

    while (true) {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: History,
        config: {
          systemInstruction: `You are CodeSense an AI coding assistant built by Kumar Ayush. 🤖

YOUR GOAL: Analyze, Debug, and Improve the codebase.

CAPABILITIES:
1.  **File Ops**: Read, Write, Delete files, Create directories.
2.  **Terminal**: Run commands (npm test, node filename.js, eslint, etc.) to verify your code.

PROCESS:
1.  **Exploration**: Scan the directory. Read key files (package.json, index.js, etc.).
2.  **Diagnosis**: Identify bugs, security risks, or bad practices.
3.  **Verification**: If possible, write a small test script or run existing tests using 'runTerminalCommand' to confirm bugs.
4.  **Reporting**: Generate a concise report of your findings.
5.  **Proposal**: Ask the user if they want to apply fixes.
6.  **Action**: If User says YES, apply the fixes using 'writeFile', 'deleteFile', etc.
7.  **Final Check**: Run tests again to ensure fixes worked.

FORMATTING & OUTPUT STYLE:
- DO NOT use Markdown bold (** **) anywhere in responses.
- ALWAYS use inline code formatting (` `) for:
  - File names (e.g., index.html, styles.css)
  - Folder paths (e.g., ./todos-project)
  - Commands
  - Technologies (HTML, CSS, JavaScript)
- Responses must look like VS Code / terminal-style documentation.


CRITICAL RULES:
-   Do NOT apply changes (writeFile, deleteFile) unless the user explicitly confirms or you are in 'apply-fix' mode.
-   If you need to run a command to check something (like node -v or running a script), do it.
-   Keep responses professional and concise.
`,
          tools,
        },
      });

      // Handle Tool Calls
      if (result.functionCalls?.length > 0) {
        let hasDestructiveAction = false;

        for (const functionCall of result.functionCalls) {
          const { name, args } = functionCall;
          const isDestructive = ["writeFile", "deleteFile"].includes(name);

          // In dry-run, block destructive actions unless confirmed
          if (isDestructive && mode === "dry-run") {
            console.log(`🚫 Blocked ${name} (dry-run mode)`);

            // Add failure to history so AI knows it didn't happen
            History.push({ role: "model", parts: [{ functionCall }] });
            History.push({
              role: "user",
              parts: [{ functionResponse: { name, response: { error: "Action blocked: User confirmation required." } } }]
            });
            continue;
          }

          if (isDestructive) hasDestructiveAction = true;

          console.log(`🔧 Tool: ${name}`);
          const toolResponse = await toolFunctions[name](args);

          History.push({ role: "model", parts: [{ functionCall }] });
          History.push({
            role: "user",
            parts: [{ functionResponse: { name, response: { result: toolResponse } } }],
          });
        }
      } else {
        // Text Response
        let text = (typeof result.text === "function" ? result.text() : result.text) || "";
        text = text.trim();

        if (!text) {
          // No text and no tool calls implied by else block -> likely done
          break;
        }

        console.log("\n🤖 AI:", text);

        // Check for confirmation request
        if (text.includes("Yes") || text.toLowerCase().includes("apply these fixes") || text.includes("?")) {
          const answer = await interactionCallback(text);

          if (answer) {
            mode = "apply-fix";
            console.log("\n✅ User confirmed. Applying fixes...");
            History.push({
              role: "user",
              parts: [{ text: "YES. Proceed with applying the fixes and running verification commands." }]
            });
          } else {
            console.log("\n❌ User declined.");
            History.push({
              role: "user",
              parts: [{ text: "NO. Do not apply fixes. Stop." }]
            });
            break; // Exit loop
          }
        }
        // Stop conditions
        else if (
          text.toLowerCase().includes("code review complete") ||
          text.toLowerCase().includes("all fixes applied") ||
          text.toLowerCase().includes("verified")
        ) {
          // If we are in apply-fix mode and the AI says it's done/verified, we stop.
          if (mode === "apply-fix") {
            console.log("\n✅ Task completed.");
            break;
          }
        }

        // Add model text to history to continue context
        History.push({ role: "model", parts: [{ text }] });
      }

      // Trim history to maintain context window limit
      trimHistory();
    }
  }
}

// ============================================
// CLI ENTRY POINT
// ============================================

// Check if run directly (CommonJS)
if (require.main === module) {
  // Simple CLI interaction callback
  const cliCallback = async (question) => {
    const answer = readlineSync.question("\n> (Yes/No): ").toLowerCase();
    return answer === "yes" || answer === "y";
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Please set GEMINI_API_KEY in .env");
    process.exit(1);
  }

  const agent = new CodeReviewerAgent(apiKey);
  const directory = process.argv[2] || '.';
  agent.run(directory, cliCallback);
}

module.exports = { CodeReviewerAgent, createTools, resolveInWorkspace, tools };