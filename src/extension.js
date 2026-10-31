const vscode = require('vscode');
const { ChatViewProvider } = require('./ChatViewProvider');
const { cleanupOldDiffs } = require('./diffUtil');

async function activate(context) {
    console.log('CodeSense AI extension is now active!');

    // Cleanup old diff temp files on startup
    cleanupOldDiffs();

    const provider = new ChatViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codesense.chatView', provider)
        
    );

    // 🔹 Command fallback (optional manual key entry)
    context.subscriptions.push(
        vscode.commands.registerCommand('codesense.addApiKey', async () => {
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Google Gemini', id: 'gemini' },
                    { label: 'OpenAI', id: 'openai' }
                ],
                { placeHolder: 'Select AI Provider' }
            );

            if (!choice) return;

            const key = (await vscode.window.showInputBox({
                prompt: `Enter your ${choice.label} API Key`,
                password: true,
                ignoreFocusOut: true
            }))?.trim();

            if (!key) return;

            await provider.saveCredentials(choice.id, key);

            vscode.window.showInformationMessage(`${choice.label} API key saved securely.`);
        })
    );

    // 🔹 Reset API Key Command
    context.subscriptions.push(
        vscode.commands.registerCommand('codesense.resetApiKey', async () => {
            const confirmation = await vscode.window.showWarningMessage(
                'Are you sure you want to reset your API key? You will need to re-enter it to use CodeSense AI.',
                { modal: true },
                'Yes, Reset',
                'Cancel'
            );

            if (confirmation === 'Yes, Reset') {
                // Delete all known API keys from secret storage
                const keysToDelete = [
                    'ai_api_key',
                    'ai_provider',
                    'gemini_api_key',
                    'google_gemini_api_key',
                    'openai_api_key',
                    'anthropic_api_key',
                    'groq_api_key'
                ];

                for (const k of keysToDelete) {
                    try {
                        await context.secrets.delete(k);
                    } catch (e) {
                        // Ignore individual delete errors
                    }
                }

                vscode.window.showInformationMessage('✅ API key reset successfully. Please re-enter your key when prompted.');
                
                // Notify the webview to show the config screen
                if (provider && provider._view) {
                    provider._view.webview.postMessage({ type: 'requestApiKey' });
                }
            }
        })
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
