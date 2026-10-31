const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { MultiProviderAgent } = require('../MultiProviderAgent');

describe('model settings', () => {
  it('uses the default model for each provider', () => {
    assert.equal(new MultiProviderAgent('Google Gemini', 'test-key').model, 'gemini-2.5-flash');
    assert.equal(new MultiProviderAgent('OpenAI', 'test-key').model, 'gpt-4o');
  });

  it('uses the setting for the active provider only', () => {
    const models = { gemini: 'gemini-custom', openai: 'gpt-custom' };

    const gemini = new MultiProviderAgent('Google Gemini', 'test-key');
    gemini.setModels(models);
    assert.equal(gemini.model, 'gemini-custom');

    const openai = new MultiProviderAgent('OpenAI', 'test-key');
    openai.setModels(models);
    assert.equal(openai.model, 'gpt-custom');
  });

  it('falls back to the default when the setting is blank', () => {
    const agent = new MultiProviderAgent('OpenAI', 'test-key');
    agent.setModels({ openai: 'gpt-custom' });
    agent.setModels({ openai: '' });
    assert.equal(agent.model, 'gpt-4o');
  });

  it('sends the chosen model with the request', async () => {
    mock.method(console, 'log', () => {});
    const create = mock.fn(async () => ({ choices: [{ message: { content: 'hi' } }] }));

    const agent = new MultiProviderAgent('OpenAI', 'test-key');
    agent.client = { chat: { completions: { create } } };
    agent.setModels({ openai: 'gpt-custom' });
    await agent.runWithMessage('/workspace', 'hello', null, () => {}, null, {}, []);
    mock.restoreAll();

    assert.equal(create.mock.calls[0].arguments[0].model, 'gpt-custom');
  });
});
