import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkspaceEdits } from './ai-edits';

test('extractWorkspaceEdits reads quoted path edit fences', () => {
  const edits = extractWorkspaceEdits([
    'Here is the change:',
    '```outlaw-edit path="src/App.tsx"',
    'export function App() {}',
    '```',
  ].join('\n'));

  assert.deepEqual(edits, [
    { path: 'src/App.tsx', content: 'export function App() {}' },
  ]);
});

test('extractWorkspaceEdits supports workspace-edit fences and bare paths', () => {
  const edits = extractWorkspaceEdits([
    '```workspace-edit path=package.json',
    '{"scripts":{}}',
    '```',
  ].join('\n'));

  assert.equal(edits[0]?.path, 'package.json');
  assert.equal(edits[0]?.content, '{"scripts":{}}');
});
