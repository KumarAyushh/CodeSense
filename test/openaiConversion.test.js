const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { MultiProviderAgent } = require('../MultiProviderAgent');

const toolCall = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
});
const toolCallResponse = (...tool_calls) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls } }]
});
const textResponse = (content) => ({
  choices: [{ message: { role: 'assistant', content } }]
});

describe('OpenAI conversion', () => {
  let agent;

  beforeEach(() => {
    agent = new MultiProviderAgent('OpenAI', 'test-key');
  });

  describe('_convertFromOpenAIResponse', () => {
    it('keeps the id, name and arguments of every tool call', () => {
      const result = agent._convertFromOpenAIResponse(toolCallResponse(
        toolCall('call_1', 'readFile', { file_path: 'a.js' }),
        toolCall('call_2', 'readFile', { file_path: 'b.js' })
      ));

      assert.deepEqual(result.functionCalls, [
        { id: 'call_1', name: 'readFile', args: { file_path: 'a.js' } },
        { id: 'call_2', name: 'readFile', args: { file_path: 'b.js' } }
      ]);
    });

    it('falls back to empty arguments when the JSON is invalid', (t) => {
      t.mock.method(console, 'warn', () => {});
      const result = agent._convertFromOpenAIResponse(toolCallResponse(toolCall('call_1', 'readFile', '{oops')));

      assert.deepEqual(result.functionCalls, [{ id: 'call_1', name: 'readFile', args: {} }]);
    });

    it('returns text and no function calls for a plain answer', () => {
      const result = agent._convertFromOpenAIResponse(textResponse('hello'));

      assert.equal(result.text(), 'hello');
      assert.deepEqual(result.functionCalls, []);
    });
  });

  describe('_convertToOpenAIMessages', () => {
    it('emits every function call of a model turn, then one tool message per response', () => {
      const messages = agent._convertToOpenAIMessages([
        { role: 'user', parts: [{ text: 'read both' }] },
        {
          role: 'model',
          parts: [
            { functionCall: { id: 'call_1', name: 'readFile', args: { file_path: 'a.js' } } },
            { functionCall: { id: 'call_2', name: 'readFile', args: { file_path: 'b.js' } } }
          ]
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { id: 'call_1', name: 'readFile', response: { result: 'A' } } },
            { functionResponse: { id: 'call_2', name: 'readFile', response: { result: 'B' } } }
          ]
        }
      ]);

      assert.deepEqual(messages, [
        { role: 'user', content: 'read both' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            toolCall('call_1', 'readFile', { file_path: 'a.js' }),
            toolCall('call_2', 'readFile', { file_path: 'b.js' })
          ]
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"result":"A"}' },
        { role: 'tool', tool_call_id: 'call_2', content: '{"result":"B"}' }
      ]);
    });

    it('puts tool messages before text in the same user turn', () => {
      const messages = agent._convertToOpenAIMessages([
        {
          role: 'user',
          parts: [
            { text: 'and then this' },
            { functionResponse: { id: 'call_1', name: 'readFile', response: { result: 'A' } } }
          ]
        }
      ]);

      assert.deepEqual(messages.map(m => m.role), ['tool', 'user']);
    });

    it('keeps text sent alongside function calls', () => {
      const [message] = agent._convertToOpenAIMessages([
        {
          role: 'model',
          parts: [{ text: 'Reading it' }, { functionCall: { id: 'call_1', name: 'readFile', args: {} } }]
        }
      ]);

      assert.equal(message.content, 'Reading it');
      assert.equal(message.tool_calls[0].function.arguments, '{}');
    });
  });

  describe('round trip through runWithMessage', () => {
    it('answers each tool call with its own id on the next request', async () => {
      const responses = [
        toolCallResponse(
          toolCall('call_1', 'readFile', { file_path: 'a.js' }),
          toolCall('call_2', 'readFile', { file_path: 'b.js' })
        ),
        toolCallResponse(toolCall('call_3', 'writeFile', { file_path: 'c.js', contents: 'x' })),
        textResponse('All done')
      ];
      const requests = [];
      const replies = [];

      agent.client = {
        chat: {
          completions: {
            create: async (body) => {
              requests.push(structuredClone(body.messages));
              return responses.shift();
            }
          }
        }
      };
      mock.method(console, 'log', () => {});

      const toolFunctions = {
        readFile: async ({ file_path }) => ({ contents: `contents of ${file_path}` }),
        writeFile: async () => ({ success: true })
      };

      await agent.runWithMessage('/workspace', 'go', null, (text) => replies.push(text), null, toolFunctions, []);
      mock.restoreAll();

      assert.equal(requests.length, 3);
      assert.deepEqual(replies, ['All done']);

      const last = requests[2];
      const toolCallIds = last.filter(m => m.role === 'assistant').flatMap(m => m.tool_calls.map(tc => tc.id));
      const toolMessageIds = last.filter(m => m.role === 'tool').map(m => m.tool_call_id);
      assert.deepEqual(toolCallIds, ['call_1', 'call_2', 'call_3']);
      assert.deepEqual(toolMessageIds, ['call_1', 'call_2', 'call_3']);

      // Every assistant message with tool_calls is directly followed by its tool messages
      last.forEach((message, i) => {
        if (message.role !== 'assistant') return;
        const following = last.slice(i + 1, i + 1 + message.tool_calls.length);
        assert.deepEqual(following.map(m => m.tool_call_id), message.tool_calls.map(tc => tc.id));
      });

      assert.deepEqual(JSON.parse(last.find(m => m.tool_call_id === 'call_2').content), {
        result: { contents: 'contents of b.js' }
      });
    });
  });
});
