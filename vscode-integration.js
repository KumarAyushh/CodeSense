const vscode = require('vscode');
// Note: In a real extension, you would import this from the compiled file
// or use CommonJS require if your extension is CommonJS.
// const { CodeReviewerAgent } = require('./agent'); 

/**
 * Example of how to use the CodeReviewerAgent in a VS Code extension
 */
function activate(context) {
    // Register the command
    let disposable = vscode.commands.registerCommand('codelamp.reviewCode', async function () {

        // 1. Get API Key (e.g. from settings or secrets)
        const apiKey = await context.secrets.get("codelamp_gemini_key");
        if (!apiKey) {
            vscode.window.showErrorMessage("Please set your Gemini API Key first.");
            return;
        }

        // 2. Get Workspace Folder
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage("Please open a folder first.");
            return;
        }
        const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // 3. Initialize Agent
        // You'll need to handle the import based on your project structure (ESM vs CJS)
        // Here we assume CodeReviewerAgent is imported/required
        const agent = new CodeReviewerAgent(apiKey);

        // 4. Define Interaction Callback for VS Code
        // This replaces the CLI readlineSync
        const interactionCallback = async (question) => {
            const selection = await vscode.window.showInformationMessage(
                "CodeLamp AI: " + question,
                "Yes",
                "No"
            );
            return selection === "Yes";
        };

        // 5. Run the Agent
        // We use withProgress to show a loading indicator
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "CodeLamp: Reviewing Code...",
            cancellable: true
        }, async (progress, token) => {
            try {
                // Redirect console.log to an Output Channel so the user sees progress
                const outputChannel = vscode.window.createOutputChannel("CodeLamp");
                outputChannel.show();

                // Override console.log for the agent (optional, or modify Agent to accept logger)
                const originalLog = console.log;
                console.log = (...args) => {
                    outputChannel.appendLine(args.join(' '));
                    originalLog(...args); // Keep logging to debug console
                };

                await agent.run(folderPath, interactionCallback);

                console.log = originalLog; // Restore
                vscode.window.showInformationMessage("Code Review Complete!");
            } catch (error) {
                vscode.window.showErrorMessage("Agent Error: " + error.message);
                console.error(error);
            }
        });
    });

    context.subscriptions.push(disposable);
}

module.exports = {
    activate
};
