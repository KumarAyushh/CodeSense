const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const { MultiProviderAgent } = require('../MultiProviderAgent');

const userText = (text) => ({ role: 'user', parts: [{ text }] });
const modelText = (text) => ({ role: 'model', parts: [{ text }] });
const modelCall = (name) => ({ role: 'model', parts: [{ functionCall: { name, args: {} } }] });
const toolResult = (name) => ({
  role: 'user',
  parts: [{ functionResponse: { name, response: { result: 'ok' } } }]
});

describe('_validateAndSanitizeHistory', () => {
  let agent;

  before(() => {
    mock.method(console, 'warn', () => {}); // The sanitizer warns about everything it drops
    agent = new MultiProviderAgent('Google Gemini', 'test-key');
  });

  it('returns an empty list for missing or empty history', () => {
    assert.deepEqual(agent._validateAndSanitizeHistory(undefined), []);
    assert.deepEqual(agent._validateAndSanitizeHistory([]), []);
  });

  it('keeps a valid conversation unchanged', () => {
    const history = [
      userText('list files'),
      modelCall('listDirectory'),
      toolResult('listDirectory'),
      modelText('done')
    ];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), history);
  });

  it('drops invalid messages', () => {
    const history = [null, { role: 'user' }, { role: 'user', parts: [] }, userText('hi')];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), [userText('hi')]);
  });

  it('drops a function call that has no response', () => {
    const history = [userText('a'), modelCall('readFile'), userText('b')];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), [userText('a'), userText('b')]);
  });

  it('drops a trailing function call', () => {
    const history = [userText('a'), modelCall('readFile')];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), [userText('a')]);
  });

  it('drops a function response whose call is gone', () => {
    const history = [userText('a'), modelText('b'), toolResult('readFile'), modelText('c')];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), [userText('a'), modelText('b'), modelText('c')]);
  });

  it('resets history that starts with a model message', () => {
    assert.deepEqual(agent._validateAndSanitizeHistory([modelText('a'), userText('b')]), []);
  });

  it('resets history that starts with a function call once trimming removed the user turn', () => {
    const history = [modelCall('readFile'), toolResult('readFile'), userText('b')];
    assert.deepEqual(agent._validateAndSanitizeHistory(history), []);
  });

  it('does not change the history it was given', () => {
    const history = [userText('a'), modelCall('readFile')];
    agent._validateAndSanitizeHistory(history);
    assert.equal(history.length, 2);
  });
});
