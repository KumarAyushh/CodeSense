const { Type } = require("@google/genai");
const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");

// ============================================
// WORKSPACE SANDBOX
// ============================================

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

function assertInWorkspace(root, full, p) {
  const rel = path.relative(root, full);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
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
// `showDiff(path, before, after)` is optional and shows what a write changed.
function createTools(workspaceRoot, { confirm = async () => false, showDiff } = {}) {
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

module.exports = { createTools, resolveInWorkspace, tools };
