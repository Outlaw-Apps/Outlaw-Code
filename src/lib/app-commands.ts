export const APP_COMMANDS = [
  {
    id: 'file.openFolder',
    title: 'File: Open Folder...',
    category: 'File',
    shortcut: 'Ctrl+Alt+O',
    requiresLocalFs: true,
  },
  {
    id: 'file.openHistory',
    title: 'File: Open Project History...',
    category: 'File',
  },
  {
    id: 'view.explorer',
    title: 'View: Explorer',
    category: 'View',
    shortcut: 'Ctrl+Shift+E',
  },
  {
    id: 'view.search',
    title: 'View: Search',
    category: 'View',
    shortcut: 'Ctrl+Shift+F',
  },
  {
    id: 'view.sourceControl',
    title: 'View: Source Control',
    category: 'View',
    shortcut: 'Ctrl+Shift+G',
  },
  {
    id: 'view.terminal',
    title: 'View: Terminal',
    category: 'View',
    shortcut: 'Ctrl+`',
  },
  {
    id: 'view.output',
    title: 'View: Output',
    category: 'View',
    shortcut: 'Ctrl+Shift+U',
  },
  {
    id: 'preferences.aiSettings',
    title: 'Preferences: AI Settings',
    category: 'Preferences',
  },
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];
export type AppCommandId = AppCommand['id'];
export type WorkspaceCommandId = Extract<
  AppCommandId,
  | 'view.explorer'
  | 'view.search'
  | 'view.sourceControl'
  | 'view.terminal'
  | 'view.output'
>;

const workspaceCommandIds = new Set<AppCommandId>([
  'view.explorer',
  'view.search',
  'view.sourceControl',
  'view.terminal',
  'view.output',
]);
const workspaceListeners = new Set<(command: WorkspaceCommandId) => void>();

export function getAvailableCommands(localFsAvailable: boolean): AppCommand[] {
  return APP_COMMANDS.filter((command) => (
    !('requiresLocalFs' in command) || !command.requiresLocalFs || localFsAvailable
  ));
}

export function isWorkspaceCommand(command: AppCommandId): command is WorkspaceCommandId {
  return workspaceCommandIds.has(command);
}

export function emitWorkspaceCommand(command: WorkspaceCommandId): void {
  for (const listener of workspaceListeners) listener(command);
}

export function onWorkspaceCommand(
  listener: (command: WorkspaceCommandId) => void,
): () => void {
  workspaceListeners.add(listener);
  return () => workspaceListeners.delete(listener);
}
