const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Opens a VS Code diff view comparing original and AI-modified code
 * @param {string} filePath - Path to the original file
 * @param {string} originalContent - Original file content
 * @param {string} modifiedContent - AI-modified content
 * @returns {Promise<boolean>} - Returns true if diff was shown successfully
 */
async function showDiff(filePath, originalContent, modifiedContent) {
    try {
        const fileName = path.basename(filePath);
        const tmpDir = path.join(os.tmpdir(), 'codesense-diffs');
        
        // Create temp directory if it doesn't exist
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Create temp files for diff
        const timestamp = Date.now();
        const originalUri = vscode.Uri.file(path.join(tmpDir, `${timestamp}-original-${fileName}`));
        const modifiedUri = vscode.Uri.file(path.join(tmpDir, `${timestamp}-modified-${fileName}`));

        // Write content to temp files
        fs.writeFileSync(originalUri.fsPath, originalContent, 'utf8');
        fs.writeFileSync(modifiedUri.fsPath, modifiedContent, 'utf8');

        // Open diff view
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            modifiedUri,
            `CodeSense: AI Suggested Changes - ${fileName}`
        );

        console.log(`📊 Diff view opened for: ${fileName}`);
        return true;
    } catch (error) {
        console.error('Error showing diff:', error);
        vscode.window.showErrorMessage(`Failed to show diff: ${error.message}`);
        return false;
    }
}

/**
 * Cleanup old diff temp files (older than 1 hour)
 */
function cleanupOldDiffs() {
    try {
        const tmpDir = path.join(os.tmpdir(), 'codesense-diffs');
        if (!fs.existsSync(tmpDir)) return;

        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        const files = fs.readdirSync(tmpDir);
        files.forEach(file => {
            const filePath = path.join(tmpDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > oneHour) {
                fs.unlinkSync(filePath);
                console.log(`🧹 Cleaned up old diff file: ${file}`);
            }
        });
    } catch (error) {
        console.warn('Error cleaning up diff files:', error);
    }
}

module.exports = { showDiff, cleanupOldDiffs };
