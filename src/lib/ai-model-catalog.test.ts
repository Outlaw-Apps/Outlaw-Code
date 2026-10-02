import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderModels } from './ai-model-catalog';

test('parseProviderModels reads OpenAI-compatible data arrays', () => {
  const models = parseProviderModels({
    object: 'list',
    data: [
      { id: 'z-model', owned_by: 'provider' },
      { id: 'a-model', owned_by: 'provider' },
      { id: 'a-model', owned_by: 'provider' },
    ],
  });

  assert.deepEqual(models, [
    { id: 'a-model', ownedBy: 'provider' },
    { id: 'z-model', ownedBy: 'provider' },
  ]);
});

test('parseProviderModels tolerates simple string and models arrays', () => {
  assert.deepEqual(parseProviderModels({ models: ['b', 'a'] }), [
    { id: 'a', ownedBy: undefined },
    { id: 'b', ownedBy: undefined },
  ]);
});

test('parseProviderModels strips Google models prefix for OpenAI-compatible use', () => {
  const models = parseProviderModels({
    data: [
      { id: 'models/gemini-3.6-flash', owned_by: 'google' },
    ],
  });

  assert.deepEqual(models, [
    { id: 'gemini-3.6-flash', ownedBy: 'google' },
  ]);
});
