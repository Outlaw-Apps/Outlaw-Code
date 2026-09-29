import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_COMMANDS,
  emitWorkspaceCommand,
  getAvailableCommands,
  isWorkspaceCommand,
  onWorkspaceCommand,
} from './app-commands';

test('command ids are unique and every command has a category and title', () => {
  const ids = APP_COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of APP_COMMANDS) {
    assert.ok(command.category.length > 0);
    assert.ok(command.title.startsWith(`${command.category}: `));
  }
});

test('Open Folder is available only when the Electron local filesystem exists', () => {
  assert.equal(
    getAvailableCommands(false).some((command) => command.id === 'file.openFolder'),
    false,
  );
  assert.equal(
    getAvailableCommands(true).some((command) => command.id === 'file.openFolder'),
    true,
  );
});

test('workspace command detection accepts views and rejects app-owned actions', () => {
  assert.equal(isWorkspaceCommand('view.explorer'), true);
  assert.equal(isWorkspaceCommand('view.terminal'), true);
  assert.equal(isWorkspaceCommand('file.openHistory'), false);
});

test('workspace listeners receive commands and unsubscribe cleanly', () => {
  const received: string[] = [];
  const unsubscribe = onWorkspaceCommand((command) => received.push(command));
  emitWorkspaceCommand('view.search');
  unsubscribe();
  emitWorkspaceCommand('view.output');
  assert.deepEqual(received, ['view.search']);
});
