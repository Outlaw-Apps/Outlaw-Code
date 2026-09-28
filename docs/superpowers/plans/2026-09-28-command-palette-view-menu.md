# Command Palette and VS Code-Style View Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable `Ctrl+Shift+P` command palette and make the View menu, activity views, and bottom panel use one typed command surface.

**Architecture:** A pure TypeScript command catalog defines identifiers, labels, categories, shortcuts, and platform availability. `App.tsx` executes app-owned commands and publishes workspace-view commands through a small typed listener API; `EditorLayout.tsx` owns the actual sidebar/bottom-panel state and responds to those events.

**Tech Stack:** React 19, TypeScript 5.9, existing `cmdk`/Radix command dialog, lucide-react, Node's built-in test runner through `tsx` 4.23.15.

**Prerequisite:** Complete and verify `docs/superpowers/plans/2026-09-28-native-powershell-terminal.md` before starting this plan. The terminal command must open the real PowerShell surface delivered by Part 1.

---

## File map

- Create `src/lib/app-commands.ts`: command metadata, local-filesystem filtering, and typed workspace-command listeners.
- Create `src/lib/app-commands.test.ts`: command uniqueness, filtering, and listener lifecycle tests.
- Create `src/components/CommandPalette.tsx`: searchable grouped command dialog.
- Modify `src/App.tsx`: palette state, `Ctrl+Shift+P`, central executor, and expanded View/File/AI menus.
- Modify `src/components/EditorLayout.tsx`: workspace command handling and VS Code-style shortcuts.
- Modify `package.json` and `package-lock.json`: add the minimal TypeScript test runner and command test script.

---

### Task 1: Build and test the typed command catalog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/app-commands.test.ts`
- Create: `src/lib/app-commands.ts`

- [ ] **Step 1: Install the TypeScript test runner**

Run:

```powershell
npm install --save-dev tsx@4.23.15 --legacy-peer-deps
```

Add this script to `package.json`:

```json
"test:commands": "tsx --test src/lib/app-commands.test.ts"
```

Why: the repository already uses Node's test runner for Electron modules. `tsx` lets that same runner execute one pure TypeScript module without adding a browser test framework.

- [ ] **Step 2: Write the failing command-catalog tests**

Create `src/lib/app-commands.test.ts` with this complete content:

```ts
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
```

- [ ] **Step 3: Run the test to prove it fails**

Run:

```powershell
npm run test:commands
```

Expected: FAIL because `src/lib/app-commands.ts` does not exist.

- [ ] **Step 4: Implement the command catalog and workspace listener**

Create `src/lib/app-commands.ts` with this complete content:

```ts
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
```

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```powershell
npm run test:commands
npm run lint:types
git diff --check
```

Expected: four command tests pass; TypeScript and whitespace checks pass.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/lib/app-commands.ts src/lib/app-commands.test.ts
git commit -m "feat(commands): add typed IDE command catalog"
```

---

### Task 2: Build the searchable command palette

**Files:**
- Create: `src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the command-palette component**

Create `src/components/CommandPalette.tsx` with this complete content:

```tsx
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import type { AppCommand, AppCommandId } from '../lib/app-commands';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly AppCommand[];
  onExecute: (command: AppCommandId) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onExecute,
}: CommandPaletteProps) {
  const categories = [...new Set(commands.map((command) => command.category))];

  const execute = (command: AppCommandId) => {
    onOpenChange(false);
    onExecute(command);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command..." autoFocus />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {categories.map((category, index) => (
          <div key={category}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={category}>
              {commands
                .filter((command) => command.category === category)
                .map((command) => (
                  <CommandItem
                    key={command.id}
                    value={`${command.title} ${command.id}`}
                    onSelect={() => execute(command.id)}
                    className="text-xs cursor-pointer"
                  >
                    <span>{command.title}</span>
                    {'shortcut' in command && command.shortcut && (
                      <CommandShortcut>{command.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: Run static checks**

Run:

```powershell
npm run lint:types
npm run lint:js
git diff --check
```

Expected: all checks pass.

- [ ] **Step 3: Commit**

```powershell
git add src/components/CommandPalette.tsx
git commit -m "feat(commands): add searchable command palette"
```

---

### Task 3: Connect the palette and menus to one App executor

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add command imports and icons**

Add these icons to the existing `lucide-react` import in `src/App.tsx`:

```tsx
Command,
Files,
Search,
GitBranch,
Terminal as TerminalIcon,
FileText,
```

Add these imports below the existing component/library imports:

```tsx
import { CommandPalette } from './components/CommandPalette';
import {
  emitWorkspaceCommand,
  getAvailableCommands,
  isWorkspaceCommand,
  type AppCommandId,
} from './lib/app-commands';
```

Add `DropdownMenuShortcut` to the existing dropdown-menu import.

- [ ] **Step 2: Add palette state, keyboard binding, and central execution**

Next to the settings/history state, add:

```tsx
  const [showCommandPalette, setShowCommandPalette] = useState(false);
```

After `handleLogout`, add this executor and keyboard effect:

```tsx
  const executeCommand = (command: AppCommandId) => {
    if (isWorkspaceCommand(command)) {
      emitWorkspaceCommand(command);
      return;
    }

    switch (command) {
      case 'file.openFolder':
        if (hasLocalFs()) void openFolderHandler();
        return;
      case 'file.openHistory':
        setShowHistory(true);
        return;
      case 'preferences.aiSettings':
        setShowSettings(true);
        return;
    }
  };

  useEffect(() => {
    const handleCommandPaletteShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setShowCommandPalette(true);
      }
    };
    window.addEventListener('keydown', handleCommandPaletteShortcut);
    return () => window.removeEventListener('keydown', handleCommandPaletteShortcut);
  }, []);

  const availableCommands = getAvailableCommands(hasLocalFs());
```

All hooks remain above the conditional unauthenticated return so React hook order does not change between renders.

- [ ] **Step 3: Render the palette beside the existing modals**

Immediately after `SettingsModal`, render:

```tsx
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={availableCommands}
        onExecute={executeCommand}
      />
```

- [ ] **Step 4: Route existing menu actions through the executor**

In the File menu, change the existing Project History and Open Folder items to:

```tsx
                <DropdownMenuItem onClick={() => executeCommand('file.openHistory')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FolderPlus size={13} />
                  Open Project History...
                </DropdownMenuItem>
```

```tsx
                    <DropdownMenuItem onClick={() => executeCommand('file.openFolder')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                      <FolderOpen size={13} />
                      Open Folder...
                      <DropdownMenuShortcut>Ctrl+Alt+O</DropdownMenuShortcut>
                    </DropdownMenuItem>
```

Replace the complete View menu content with:

```tsx
              <DropdownMenuContent align="start" className="bg-[#202024] border-border/50 text-xs min-w-[240px]">
                <DropdownMenuItem onClick={() => setShowCommandPalette(true)} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Command size={13} />
                  Command Palette...
                  <DropdownMenuShortcut>Ctrl+Shift+P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={() => executeCommand('view.explorer')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Files size={13} />
                  Explorer
                  <DropdownMenuShortcut>Ctrl+Shift+E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('view.search')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Search size={13} />
                  Search
                  <DropdownMenuShortcut>Ctrl+Shift+F</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('view.sourceControl')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <GitBranch size={13} />
                  Source Control
                  <DropdownMenuShortcut>Ctrl+Shift+G</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={() => executeCommand('view.terminal')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <TerminalIcon size={13} />
                  Terminal
                  <DropdownMenuShortcut>Ctrl+`</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('view.output')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FileText size={13} />
                  Output
                  <DropdownMenuShortcut>Ctrl+Shift+U</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={() => executeCommand('file.openHistory')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <HistoryIcon size={13} />
                  Project History
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('preferences.aiSettings')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Settings size={13} />
                  AI Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
```

In the AI Copilot menu, change both settings items to call `executeCommand('preferences.aiSettings')` instead of setting modal state directly.

- [ ] **Step 5: Run checks**

Run:

```powershell
npm run test:commands
npm run lint:types
npm run lint:js
npm run build
git diff --check
```

Expected: command tests, typecheck, lint, and Vite build pass.

- [ ] **Step 6: Commit**

```powershell
git add src/App.tsx
git commit -m "feat(commands): wire palette and VS Code-style View menu"
```

---

### Task 4: Make EditorLayout respond to workspace commands and shortcuts

**Files:**
- Modify: `src/components/EditorLayout.tsx`

- [ ] **Step 1: Subscribe to workspace view commands**

Add this import:

```tsx
import { onWorkspaceCommand } from '../lib/app-commands';
```

After the import-forwarding effect (near the existing Explorer visibility logic), add:

```tsx
  useEffect(() => onWorkspaceCommand((command) => {
    switch (command) {
      case 'view.explorer':
        setActiveActivityView('explorer');
        setSidebarOpen(true);
        return;
      case 'view.search':
        setActiveActivityView('search');
        setSidebarOpen(true);
        return;
      case 'view.sourceControl':
        setActiveActivityView('git');
        setSidebarOpen(true);
        return;
      case 'view.terminal':
        setActiveBottomTab('terminal');
        setBottomPanelOpen(true);
        return;
      case 'view.output':
        setActiveBottomTab('output');
        setBottomPanelOpen(true);
        return;
    }
  }), []);
```

- [ ] **Step 2: Add VS Code-style keyboard shortcuts**

In the existing global `handleKeyDown`, add these branches before the `Ctrl+K` branch:

```tsx
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setActiveActivityView('explorer');
        setSidebarOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveActivityView('search');
        setSidebarOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setActiveActivityView('git');
        setSidebarOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setActiveBottomTab('output');
        setBottomPanelOpen(true);
      }
```

Replace the existing `Ctrl+\`` branch with:

```tsx
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setActiveBottomTab('terminal');
        setBottomPanelOpen((previous) => (
          activeBottomTab === 'terminal' ? !previous : true
        ));
      }
```

Add `activeBottomTab` to that effect's dependency array so the toggle uses current state.

- [ ] **Step 3: Run automated checks**

Run:

```powershell
npm run test:commands
npm run test:electron
npm run test:terminal-smoke
npm run lint:types
npm run lint:js
npm run build
git diff --check
```

Expected: all checks pass.

- [ ] **Step 4: Commit**

```powershell
git add src/components/EditorLayout.tsx
git commit -m "feat(commands): connect workspace views and shortcuts"
```

---

### Task 5: End-to-end command-palette verification

**Files:**
- Verification only unless a defect is found.

- [ ] **Step 1: Browser regression**

Run `npm run dev` and verify:

1. `Ctrl+Shift+P` opens a centered palette.
2. Typing `source` filters to `View: Source Control`.
3. Arrow keys and Enter execute the selected command and close the palette.
4. Explorer, Search, Source Control, Terminal, and Output open their correct surfaces.
5. Project History and AI Settings open their existing dialogs.
6. `File: Open Folder...` is absent because the browser has no local filesystem bridge.
7. The View menu contains the same actions and displayed shortcuts.
8. The limited browser terminal remains available.

- [ ] **Step 2: Electron verification**

Run `npm run electron:dev` and verify:

1. `File: Open Folder...` appears in the palette and opens the native folder chooser.
2. `View: Terminal` opens the real PowerShell terminal from Part 1.
3. `Ctrl+Shift+E`, `Ctrl+Shift+F`, `Ctrl+Shift+G`, `Ctrl+\``, and `Ctrl+Shift+U` select the correct surfaces.
4. Closing the palette with Escape makes no state change.
5. Repeatedly opening the palette does not add duplicate keyboard handlers.

- [ ] **Step 3: Packaged regression**

Run:

```powershell
npm run electron:build:dir
```

Launch `release/win-unpacked/Outlaw Code.exe` and repeat the Electron palette and terminal checks.

- [ ] **Step 4: Run the complete milestone gate**

```powershell
npm run test:commands
npm run test:electron
npm run test:terminal-smoke
npm run lint:types
npm run lint:js
npm run build
git diff --check
git status --short
```

Expected: every command passes and the worktree is clean.

---

## Part 2 acceptance checkpoint

- `Ctrl+Shift+P` opens a searchable, keyboard-navigable palette.
- Menu and palette entries share one executor.
- Workspace commands open collapsed surfaces before selecting them.
- Browser-only and Electron-only commands are correctly filtered.
- The View menu matches the first useful VS Code-style command surface from the approved screenshot.
- The real PowerShell terminal remains green in development and the unpacked build.
