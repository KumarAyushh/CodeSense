const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { MultiProviderAgent } = require('../MultiProviderAgent');

describe('API key saving', () => {
  const originalLoad = Module._load;
  const commands = new Map();
  let activate, provider, secrets, posted, onMessage;
  let shownItems, pick, typedKey;

  const fakeVscode = {
    window: {
      registerWebviewViewProvider: (id, viewProvider) => {
        provider = viewProvider;
        return {};
      },
      showQuickPick: async (items) => {
        shownItems = items;
        return pick(items);
      },
      showInputBox: async () => typedKey,
      showInformationMessage: async () => {}
    },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return {};
      }
    }
  };

  const addApiKey = () => commands.get('codesense.addApiKey')();
  const pickLabel = (label) => (items) => items.find(item => item.label === label);

  before(() => {
    mock.method(console, 'log', () => {});
    Module._load = (request, ...rest) => {
      if (request === 'vscode') return fakeVscode;
      if (request === './diffUtil') return { cleanupOldDiffs: () => {} };
      return originalLoad(request, ...rest);
    };
    ({ activate } = require('../src/extension'));
  });

  after(() => {
    Module._load = originalLoad;
    mock.restoreAll();
  });

  beforeEach(async () => {
    const stored = new Map();
    secrets = {
      stored,
      get: async (key) => stored.get(key),
      store: async (key, value) => { stored.set(key, value); },
      delete: async (key) => { stored.delete(key); }
    };
    posted = [];
    shownItems = undefined;
    pick = pickLabel('OpenAI');
    typedKey = 'sk-test';

    await activate({ extensionUri: {}, subscriptions: [], secrets });

    provider._initializeWebview = async () => {};
    await provider.resolveWebviewView({
      webview: {
        postMessage: (message) => posted.push(message),
        onDidReceiveMessage: (handler) => { onMessage = handler; }
      }
    });
  });

  it('only offers providers that are implemented', async () => {
    await addApiKey();

    assert.deepEqual(shownItems.map(item => item.label), ['Google Gemini', 'OpenAI']);
    for (const item of shownItems) {
      assert.doesNotThrow(() => new MultiProviderAgent(item.id, 'test-key'));
    }
  });

  it('saves the key where the agent reads it', async () => {
    await addApiKey();

    assert.equal(secrets.stored.get('ai_provider'), 'openai');
    assert.equal(secrets.stored.get('ai_api_key'), 'sk-test');
  });

  it('stores the same provider id as the webview screen', async () => {
    pick = pickLabel('Google Gemini');
    await addApiKey();

    assert.equal(secrets.stored.get('ai_provider'), 'gemini');
  });

  it('trims the key', async () => {
    typedKey = '  sk-test\n';
    await addApiKey();

    assert.equal(secrets.stored.get('ai_api_key'), 'sk-test');
  });

  it('saves nothing when a prompt is cancelled or the key is blank', async () => {
    pick = () => undefined;
    await addApiKey();

    pick = pickLabel('OpenAI');
    typedKey = undefined;
    await addApiKey();

    typedKey = '   ';
    await addApiKey();

    assert.equal(secrets.stored.size, 0);
  });

  it('opens the chat after saving', async () => {
    await addApiKey();

    assert.deepEqual(posted, [{ type: 'switchToChat' }]);
  });

  it('drops an agent built with the old key', async () => {
    provider._agent = new MultiProviderAgent('gemini', 'old-key');
    await addApiKey();

    assert.equal(provider._agent, null);
  });

  it('drops the old agent when the webview screen saves a key too', async () => {
    provider._agent = new MultiProviderAgent('gemini', 'old-key');
    await onMessage({ type: 'saveApiKey', provider: 'openai', key: 'sk-test' });

    assert.equal(provider._agent, null);
    assert.equal(secrets.stored.get('ai_provider'), 'openai');
    assert.equal(secrets.stored.get('ai_api_key'), 'sk-test');
  });
});
