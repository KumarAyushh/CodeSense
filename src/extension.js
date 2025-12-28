const vscode = require('vscode');
const { ChatViewProvider } = require('./ChatViewProvider');
const { cleanupOldDiffs } = require('./diffUtil');

async function activate(context) {
    console.log('CodeSense AI extension is now active!');

    // Cleanup old diff temp files on startup
    cleanupOldDiffs();

    // // ⚠️ DEV ONLY: reset API keys on every launch (clear all known keys)
    // try {
    //     const keysToDelete = [
    //         'ai_api_key',
    //         'ai_provider',
    //         'gemini_api_key',
    //         'google_gemini_api_key',
    //         'openai_api_key',
    //         'anthropic_api_key',
    //         'groq_api_key'
    //     ];
    //     for (const k of keysToDelete) {
    //         try {
    //             await context.secrets.delete(k);
    //         } catch (e) {
    //             // ignore individual delete errors
    //         }
    //     }
    // } catch (e) {
    //     console.warn('Error clearing secrets on startup:', e);
    // }

    const provider = new ChatViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('lec7.chatView', provider)
        
    );

    // 🔹 Command fallback (optional manual key entry)
    context.subscriptions.push(
        vscode.commands.registerCommand('lec7.addApiKey', async () => {
            const provider = await vscode.window.showQuickPick(
                ['Google Gemini', 'OpenAI', 'Anthropic', 'Groq'],
                { placeHolder: 'Select AI Provider' }
            );

            if (!provider) return;

            const key = await vscode.window.showInputBox({
                prompt: `Enter your ${provider} API Key`,
                password: true,
                ignoreFocusOut: true
            });

            if (!key) return;

            const secretKey = `${provider.toLowerCase().replace(/\s/g, '_')}_api_key`;
            await context.secrets.store(secretKey, key);

            vscode.window.showInformationMessage(`${provider} API key saved securely.`);
        })
    );

    // 🔹 Reset API Key Command
    context.subscriptions.push(
        vscode.commands.registerCommand('lec7.resetApiKey', async () => {
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
