const { GoogleGenAI, Type } = require("@google/genai");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
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
// TOOL FUNCTIONS
// ============================================

async function listDirectory({ directory }) {
  const files = [];
  const extension = [".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".json", ".md"]; // Added json/md for context

  function scanDir(dir) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (
          fullPath.includes("node_modules") ||
          fullPath.includes("dist") ||
          fullPath.includes("build") ||
          fullPath.includes(".git")
        )
          continue;

        const stat = fs.statSync(fullPath);
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

  scanDir(directory);
  console.log(`Found ${files.length} files in ${directory}`);
  return { files };
}

async function readFile({ file_path }) {
  try {
    const contents = fs.readFileSync(file_path, "utf-8");
    console.log(`Reading: ${file_path}`);
    return { contents };
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` };
  }
}

async function writeFile({ file_path, contents }) {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(file_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
    
    // Read original content if file exists (for diff)
    let originalContent = '';
    const fileExists = fs.existsSync(file_path);
    if (fileExists) {
      originalContent = fs.readFileSync(file_path, 'utf-8');
    }
    
    // Write new content
    fs.writeFileSync(file_path, contents, "utf-8");
    console.log(`✅ Writing: ${file_path}`);
    
    // Show diff if modifying existing file and running in VS Code
    if (fileExists && originalContent !== contents && showDiff) {
      try {
        await showDiff(file_path, originalContent, contents);
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
    if (fs.existsSync(file_path)) {
      fs.unlinkSync(file_path);
      console.log(`🗑️ Deleted: ${file_path}`);
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createDirectory({ directory_path }) {
  try {
    if (!fs.existsSync(directory_path)) {
      fs.mkdirSync(directory_path, { recursive: true });
      console.log(`📁 Created Directory: ${directory_path}`);
      return { success: true };
    }
    return { success: true, message: "Directory already exists" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function runTerminalCommand({ command }) {
  console.log(`💻 Executing Command: ${command}`);
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stderr });
        return;
      }
      resolve({ success: true, stdout, stderr });
    });
  });
}

// Map of tool functions
const toolFunctions = {
  listDirectory,
  readFile,
  writeFile,
  deleteFile,
  createDirectory,
  runTerminalCommand,
};

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

module.exports = { CodeReviewerAgent, toolFunctions, tools };