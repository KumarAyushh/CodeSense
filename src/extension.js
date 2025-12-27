const vscode = require('vscode');
const { ChatViewProvider } = require('./ChatViewProvider');
const { cleanupOldDiffs } = require('./diffUtil');

async function activate(context) {
    console.log('Lec7 Code Reviewer extension is now active!');

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
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
