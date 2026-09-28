# Electron Local Folders + Git (Milestone 1) Implementation Plan — Part 2 (Tasks 7–12)

> Continuation of `docs/superpowers/plans/2026-09-27-electron-fs-git-part1.md`. Same header, goal, architecture, and conventions apply.

---

### Task 7: Renderer — electron provider, git clients, context, event bus

**Files:**
- Create: `src/lib/fs/bridge.d.ts`
- Create: `src/lib/fs/electron-provider.ts`
- Create: `src/lib/git/types.ts`
- Create: `src/lib/git/null-client.ts`
- Create: `src/lib/git/electron-client.ts`
- Create: `src/lib/fs/context.tsx`
- Create: `src/lib/workspace-events.ts`
- Create: `src/lib/recent-folders.ts`

- [ ] **Step 1: Create `src/lib/git/types.ts`**

```ts
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored';

export interface GitFileEntry {
  path: string;
  origPath?: string;
  status: GitFileStatus;
  staged: boolean;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
  clean: boolean;
}

export interface GitClient {
  available(): Promise<boolean>;
  status(): Promise<GitStatus | null>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  discard(paths: string[]): Promise<void>;
  diff(path: string): Promise<string>;
  branch(): Promise<string | null>;
}
```

- [ ] **Step 2: Create `src/lib/fs/bridge.d.ts`**

```ts
import type { ReadDirResult, SearchResult, FsEvent } from './types';
import type { GitStatus } from '../git/types';

interface OutlawCodeFsBridge {
  openFolder(preselected?: string): Promise<string | null>;
  readDir(p: string): Promise<ReadDirResult>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  createEntry(p: string, kind: 'file' | 'dir'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  delete(p: string): Promise<void>;
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
  watch(): Promise<void>;
  unwatch(): Promise<void>;
}

interface OutlawCodeGitBridge {
  available(): Promise<boolean>;
  status(): Promise<GitStatus | null>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  discard(paths: string[]): Promise<void>;
  diff(p: string): Promise<string>;
}

declare global {
  interface Window {
    outlawCode?: {
      platform: string;
      aiProxyBaseURL?: string;
      aiProxyToken?: string;
      fs?: OutlawCodeFsBridge;
      git?: OutlawCodeGitBridge;
      onFsEvents?: (callback: (events: FsEvent[]) => void) => () => void;
    };
  }
}

export {};
```

- [ ] **Step 3: Create `src/lib/git/null-client.ts`**

```ts
import type { GitClient } from './types';

/** Virtual/browser mode: reports unavailable, degrades all UI gracefully. */
export class NullGitClient implements GitClient {
  async available(): Promise<boolean> {
    return false;
  }

  async status(): Promise<null> {
    return null;
  }

  async stage(): Promise<void> {}
  async unstage(): Promise<void> {}
  async commit(): Promise<void> {}
  async discard(): Promise<void> {}

  async diff(): Promise<string> {
    return '';
  }

  async branch(): Promise<null> {
    return null;
  }
}
```

- [ ] **Step 4: Create `src/lib/git/electron-client.ts`**

```ts
import type { GitClient, GitStatus } from './types';

export class ElectronGitClient implements GitClient {
  async available(): Promise<boolean> {
    return window.outlawCode?.git?.available() ?? false;
  }

  async status(): Promise<GitStatus | null> {
    return window.outlawCode?.git?.status() ?? null;
  }

  async stage(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.stage(paths);
  }

  async unstage(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.unstage(paths);
  }

  async commit(message: string): Promise<void> {
    await window.outlawCode?.git?.commit(message);
  }

  async discard(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.discard(paths);
  }

  async diff(path: string): Promise<string> {
    return window.outlawCode?.git?.diff(path) ?? '';
  }

  async branch(): Promise<string | null> {
    const status = await this.status();
    return status ? status.branch : null;
  }
}
```

- [ ] **Step 5: Create `src/lib/fs/electron-provider.ts`**

```ts
import { FsError } from './types';
import type { FileSystemProvider, FsCapabilities, ReadDirResult, FsEvent, SearchQuery, SearchResult } from './types';

function bridge() {
  const b = window.outlawCode?.fs;
  if (!b) throw new FsError('EPERM', 'Electron filesystem bridge unavailable');
  return b;
}

export class ElectronFsProvider implements FileSystemProvider {
  readonly capabilities: FsCapabilities = { local: true, watch: true };
  root: string | null = null;
  private unsubscribe: (() => void) | null = null;

  async openFolder(preselected?: string): Promise<string | null> {
    const folder = await bridge().openFolder(preselected);
    this.root = folder;
    return folder;
  }

  async readDir(path: string): Promise<ReadDirResult> {
    return bridge().readDir(path);
  }

  async readFile(path: string): Promise<string> {
    return bridge().readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await bridge().writeFile(path, content);
  }

  async createEntry(path: string, kind: 'file' | 'dir'): Promise<void> {
    await bridge().createEntry(path, kind);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await bridge().rename(oldPath, newPath);
  }

  async delete(path: string): Promise<void> {
    await bridge().delete(path);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    return bridge().search(query.query, query.maxResults);
  }

  async watch(cb: (events: FsEvent[]) => void): Promise<void> {
    this.unsubscribe = window.outlawCode?.onFsEvents?.(cb) ?? null;
    await bridge().watch();
  }

  async unwatch(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    await window.outlawCode?.fs?.unwatch();
  }
}
```

- [ ] **Step 6: Create `src/lib/workspace-events.ts`**

```ts
export type WorkspaceEvent =
  | { type: 'tree-changed' }
  | { type: 'files-changed'; paths: string[] }
  | { type: 'renamed'; oldPath: string; newPath: string }
  | { type: 'deleted'; path: string };

type Handler = (event: WorkspaceEvent) => void;
const handlers = new Set<Handler>();

export function onWorkspaceEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitWorkspaceEvent(event: WorkspaceEvent): void {
  for (const handler of handlers) handler(event);
}
```

- [ ] **Step 7: Create `src/lib/recent-folders.ts`**

```ts
const KEY = 'outlaw_recent_folders';
const MAX_RECENT = 10;

export function getRecentFolders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(folder: string): void {
  const next = [folder, ...getRecentFolders().filter((p) => p !== folder)].slice(0, MAX_RECENT);
  localStorage.setItem(KEY, JSON.stringify(next));
}
```

- [ ] **Step 8: Create `src/lib/fs/context.tsx`**

```tsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { FileSystemProvider, WorkspaceInfo, VirtualSandbox } from './types';
import { VirtualFsProvider } from './virtual-provider';
import { ElectronFsProvider } from './electron-provider';
import type { GitClient } from '../git/types';
import { NullGitClient } from '../git/null-client';
import { ElectronGitClient } from '../git/electron-client';
import { addRecentFolder } from '../recent-folders';

const FsCtx = createContext<FileSystemProvider | null>(null);
const GitCtx = createContext<GitClient | null>(null);

interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  openFolder: (preselected?: string) => Promise<string | null>;
}

const WsCtx = createContext<WorkspaceState>({ workspace: null, openFolder: async () => null });

export function createProvider(sandbox: VirtualSandbox | null): FileSystemProvider {
  if (window.outlawCode?.fs) return new ElectronFsProvider();
  if (sandbox) return new VirtualFsProvider(sandbox);
  throw new Error('No filesystem provider available (no sandbox and no Electron bridge)');
}

export function createGitClient(): GitClient {
  return window.outlawCode?.git ? new ElectronGitClient() : new NullGitClient();
}

export function FsProvider({
  sandbox,
  children,
  onFolderOpened,
}: {
  sandbox: VirtualSandbox | null;
  children: ReactNode;
  onFolderOpened?: (info: WorkspaceInfo) => void;
}) {
  const provider = useMemo(() => createProvider(sandbox), [sandbox]);
  const git = useMemo(() => createGitClient(), []);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);

  const openFolder = useCallback(
    async (preselected?: string) => {
      const root = await provider.openFolder(preselected);
      if (!root) return null;
      const name = root.split(/[\\/]/).filter(Boolean).pop() || root;
      const info: WorkspaceInfo = { root, name, local: provider.capabilities.local };
      setWorkspace(info);
      addRecentFolder(root);
      onFolderOpened?.(info);
      return root;
    },
    [provider, onFolderOpened]
  );

  return (
    <FsCtx.Provider value={provider}>
      <GitCtx.Provider value={git}>
        <WsCtx.Provider value={{ workspace, openFolder }}>{children}</WsCtx.Provider>
      </GitCtx.Provider>
    </FsCtx.Provider>
  );
}

export function useFs(): FileSystemProvider {
  const ctx = useContext(FsCtx);
  if (!ctx) throw new Error('useFs must be used inside FsProvider');
  return ctx;
}

export function useGit(): GitClient {
  const ctx = useContext(GitCtx);
  if (!ctx) throw new Error('useGit must be used inside FsProvider');
  return ctx;
}

export function useWorkspace(): WorkspaceState {
  return useContext(WsCtx);
}

/** Outside React (e.g. menu rendering in App): is the Electron FS bridge present? */
export function hasLocalFs(): boolean {
  return !!window.outlawCode?.fs;
}
```

- [ ] **Step 9: Verify**

Run: `npm run lint:types` then `npm run lint:js`
Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/fs src/lib/git src/lib/workspace-events.ts src/lib/recent-folders.ts
git commit -m "feat(fs): electron provider, git clients, provider context, workspace event bus"
```

---

### Task 8: App shell — Open Folder menu, shortcut, recent folders

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/HistoryModal.tsx`
- Modify: `src/components/EditorLayout.tsx` (props interface only, for the typecheck)

- [ ] **Step 1: Wire the File menu in `src/App.tsx`**

Add imports at the top:

```tsx
import { FsProvider, hasLocalFs } from './lib/fs/context';
import { getRecentFolders } from './lib/recent-folders';
import { FolderOpen } from 'lucide-react';
```

Add the folder-opening handler in the `App` component (before the `return`):

```tsx
  const openFolderHandler = async (preselected?: string) => {
    if (!window.outlawCode?.fs) return;
    try {
      const folder = preselected ?? (await window.outlawCode.fs.openFolder());
      if (!folder) return;
      setProjectName(folder.split(/[\\/]/).filter(Boolean).pop() || folder);
      setShowHistory(false);
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };
```

Note: `window.outlawCode.fs.openFolder()` here sets the main-process root; the provider context learns about it when `EditorLayout` calls the context `openFolder(preselected)` (Task 11) — both go through the same IPC channel, and the second call is idempotent (`setRoot`).

Wrap the editor content — replace

```tsx
        ) : (
          <EditorLayout
            sandbox={sandbox}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
```

with

```tsx
        ) : (
          <FsProvider
            sandbox={sandbox}
            onFolderOpened={(info) => setProjectName(info.name)}
          >
            <EditorLayout
              sandbox={sandbox}
              onOpenSettings={() => setShowSettings(true)}
            />
          </FsProvider>
        )}
```

In the File menu dropdown, add an "Open Folder..." item between "Open Project History..." and the import separator:

```tsx
                {hasLocalFs() && (
                  <>
                    <DropdownMenuItem onClick={() => void openFolderHandler()} className="gap-2 cursor-pointer focus:bg-zinc-800">
                      <FolderOpen size={13} />
                      Open Folder...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border/30" />
                  </>
                )}
```

Update the `HistoryModal` usage to pass recent folders (keying on `showHistory` re-reads `localStorage` each time it opens):

```tsx
      <HistoryModal
        key={showHistory ? 'history-open' : 'history-closed'}
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onSelectProject={handleSelectProject}
        currentSandboxId={sandbox?.id}
        userName={userName}
        recentFolders={hasLocalFs() ? getRecentFolders() : undefined}
        onOpenFolder={(folder) => { void openFolderHandler(folder); }}
      />
```

- [ ] **Step 2: Recent folders in HistoryModal**

Add props to `HistoryModalProps` in `src/components/HistoryModal.tsx`:

```tsx
  recentFolders?: string[];
  onOpenFolder?: (folder: string) => void;
```

Add `FolderOpen` to its lucide import list, then render a "Recent folders" block inside `<div className="p-6">`, above the `{isLoading ? ...}` ternary:

```tsx
            {recentFolders && recentFolders.length > 0 && (
              <div className="space-y-2 mb-6">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent folders
                </div>
                {recentFolders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => onOpenFolder?.(folder)}
                    className="w-full text-left group p-3 rounded-xl border border-[#2d2d2d] bg-[#141414] hover:bg-[#1a1a1a] hover:border-[#3d3d3d] transition-all duration-200 flex items-center gap-2"
                  >
                    <FolderOpen size={14} className="text-muted-foreground group-hover:text-primary shrink-0" />
                    <span className="text-sm text-foreground truncate">{folder.split(/[\\/]/).pop()}</span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono truncate">{folder}</span>
                    <span className="ml-auto text-[11px] text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      Open <ChevronRight size={12} className="inline" />
                    </span>
                  </button>
                ))}
              </div>
            )}
```

- [ ] **Step 3: Add the `onOpenFolder` prop to EditorLayout (typecheck only)**

In `src/components/EditorLayout.tsx`, extend `EditorLayoutProps`:

```tsx
interface EditorLayoutProps {
  sandbox: any | null;
  initialPrompt?: string | null;
  onOpenSettings?: () => void;
  onOpenFolder?: (preselected?: string) => void;
}
```

Leave it unused until Task 11.

- [ ] **Step 4: Verify**

Run: `npm run lint:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/HistoryModal.tsx src/components/EditorLayout.tsx
git commit -m "feat(app): open-folder menu entry and recent folders in history"
```

---

### Task 9: FileExplorer — provider-based lazy tree

**Files:**
- Modify: `src/components/FileExplorer.tsx`

The component switches from parsing `find` output to provider `readDir` with lazy per-directory loading. Importing (picker/drag-drop) keeps working unchanged — it already writes through `sandbox.files.write`, which is the same store the virtual provider reads, and in Electron-local mode imports write into the opened folder.

- [ ] **Step 1: Replace state, tree model, and fetch logic**

Add imports at the top of the file:

```tsx
import { useFs, useGit } from '../lib/fs/context';
import type { FsEntry } from '../lib/fs/types';
import type { GitFileEntry } from '../lib/git/types';
import { onWorkspaceEvent, emitWorkspaceEvent } from '../lib/workspace-events';
```

Replace the `FileNode` interface (delete it), the `FileExplorerProps`/component signature, and everything from the state declarations through `toggleFolder` with:

```tsx
interface FileExplorerProps {
  sandbox: any;
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  className?: string;
  onImportComplete?: (paths: string[]) => void;
}

export function FileExplorer({ sandbox, onFileSelect, selectedFile, className, onImportComplete }: FileExplorerProps) {
  const provider = useFs();
  const git = useGit();

  // path -> children; loaded lazily on first expansion
  const [tree, setTree] = useState<Record<string, FsEntry[]>>({});
  const [cappedDirs, setCappedDirs] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, GitFileEntry>>({});

  // import picker state (unchanged behavior)
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const rootDir = provider.root ?? '/home/user/app';

  const loadDir = useCallback(
    async (dirPath: string, { silent }: { silent?: boolean } = {}) => {
      if (!silent) setIsLoading(true);
      try {
        const { entries, capped } = await provider.readDir(dirPath);
        setTree((prev) => ({ ...prev, [dirPath]: entries }));
        setCappedDirs((prev) => {
          const next = new Set(prev);
          if (capped) next.add(dirPath);
          else next.delete(dirPath);
          return next;
        });
        setError(null);
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [provider]
  );

  // Load workspace root + git status; also after any tree-changed event.
  const refreshRoot = useCallback(async () => {
    await loadDir(rootDir, { silent: true });
    try {
      if (await git.available()) {
        const status = await git.status();
        if (status) {
          const map: Record<string, GitFileEntry> = {};
          for (const f of status.files) map[f.path.replace(/\\/g, '/')] = f;
          setGitStatusMap(map);
        }
      }
    } catch {
      /* git is optional */
    }
  }, [git, loadDir, rootDir]);

  useEffect(() => {
    void refreshRoot();
  }, [refreshRoot]);

  // Live updates: provider.watch in Electron, 5s polling in virtual mode.
  // The explorer is the single watch registration; EditorLayout consumes
  // the forwarded events via the workspace event bus.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      if (provider.capabilities.watch) {
        await provider.watch((events) => {
          emitWorkspaceEvent({ type: 'tree-changed' });
          emitWorkspaceEvent({
            type: 'files-changed',
            paths: events.filter((e) => e.type === 'changed').map((e) => e.path),
          });
        });
      } else {
        interval = setInterval(() => emitWorkspaceEvent({ type: 'tree-changed' }), 5000);
      }
    };
    void start();

    const off = onWorkspaceEvent((event) => {
      if (event.type === 'tree-changed') {
        void refreshRoot();
        for (const dir of expandedFolders) void loadDir(dir, { silent: true });
      }
    });

    return () => {
      off();
      if (interval) clearInterval(interval);
      void provider.unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, refreshRoot]);
```

- [ ] **Step 2: Replace the tree renderer and toggle logic**

Replace `toggleFolder` and `renderTree`:

```tsx
  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      if (!tree[path]) void loadDir(path);
    }
    setExpandedFolders(newExpanded);
  };

  const gitStatusColor = (path: string): string | undefined => {
    const rel = provider.root ? path.replace(`${provider.root}/`, '') : path;
    const entry = gitStatusMap[rel];
    if (!entry) return undefined;
    if (entry.status === 'untracked') return 'text-green-400';
    if (entry.status === 'ignored') return 'text-zinc-600';
    return entry.staged ? 'text-green-500' : 'text-amber-400';
  };

  const renderTree = (nodes: FsEntry[], depth = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFile === node.path;
      const children = isExpanded ? tree[node.path] : undefined;
      const paddingLeft = depth * 12 + 12;

      return (
        <div key={node.path}>
          <div
            className={cn(
              'flex items-center gap-1.5 py-1 px-2 cursor-pointer text-sm hover:bg-[#2a2a2a] transition-colors select-none',
              isSelected && 'bg-[#37373d] text-white',
              !isSelected && 'text-muted-foreground'
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={(e) => {
              if (node.kind === 'dir') toggleFolder(node.path, e);
              else onFileSelect(node.path);
            }}
          >
            {node.kind === 'dir' ? (
              <span className="flex items-center gap-1.5 overflow-hidden">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-70" />
                )}
                <Folder className={cn('w-3.5 h-3.5 shrink-0', isExpanded ? 'text-blue-400' : 'text-blue-300')} />
                <span className="truncate">{node.name}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 overflow-hidden">
                <span className="w-3.5" />
                <FileIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className={cn('truncate', gitStatusColor(node.path))}>{node.name}</span>
              </span>
            )}
          </div>
          {node.kind === 'dir' && isExpanded && (
            <div>
              {children ? (
                renderTree(children, depth + 1)
              ) : (
                <div className="text-[10px] text-muted-foreground/60 px-2 py-1">Loading...</div>
              )}
              {cappedDirs.has(node.path) && (
                <div className="text-[10px] text-amber-500/80 px-2 py-0.5">Too many entries to list</div>
              )}
            </div>
          )}
        </div>
      );
    });
  };
```

Update the render call sites: replace `renderTree(files)` with `renderTree(tree[rootDir] ?? [])`, and the empty-state condition `files.length === 0` with `(tree[rootDir] ?? []).length === 0`.

Delete the entire `buildFileTree` function at the bottom of the file (dead code after this task).

- [ ] **Step 3: Keep imports working**

The import handlers (`handleImportList`, hidden inputs, drag-drop overlay, picker event listeners, header buttons) stay as they are — they already write through `sandbox.files.write`. One change: after a successful import, replace `await fetchFiles()` with:

```tsx
        emitWorkspaceEvent({ type: 'tree-changed' });
```

and keep the ancestor auto-expansion logic, additionally seeding the loaded directories:

```tsx
        const ancestors = new Set<string>();
        let acc = imported[0].split('/').slice(0, -1).join('/');
        while (acc.startsWith(rootDir) && acc !== rootDir) {
          ancestors.add(acc);
          acc = acc.slice(0, acc.lastIndexOf('/'));
        }
        setExpandedFolders((prev) => new Set([...prev, ...ancestors]));
        for (const anc of ancestors) void loadDir(anc, { silent: true });
```

(Also replace the old hardcoded `/home/user/app` prefix inside the ancestor loop with `rootDir`.)

- [ ] **Step 4: Verify**

Run: `npm run lint:types` then `npm run lint:js`
Expected: PASS.

Run: `npm run dev` — in the browser, import a folder, expand/collapse, confirm the tree renders and imports still work exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileExplorer.tsx
git commit -m "feat(explorer): lazy provider-based tree with git status colors"
```

---

### Task 10: FileExplorer — context menu file operations

**Files:**
- Modify: `src/components/FileExplorer.tsx`

- [ ] **Step 1: Add operation state and handlers inside the component**

```tsx
  type PendingOp =
    | { mode: 'new-file'; dir: string }
    | { mode: 'new-dir'; dir: string }
    | { mode: 'rename'; dir: string; originalName: string }
    | null;

  const [pendingOp, setPendingOp] = useState<PendingOp>(null);
  const [opValue, setOpValue] = useState('');
  const [opError, setOpError] = useState<string | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const parentOf = (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : rootDir;
  };

  const joinPath = (dir: string, name: string) =>
    `${dir.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;

  const runPendingOp = async () => {
    if (!pendingOp) return;
    const name = opValue.trim();
    if (!name) return;
    const dir = pendingOp.dir;
    setOpBusy(true);
    setOpError(null);
    try {
      if (pendingOp.mode === 'rename') {
        const oldPath = joinPath(dir, pendingOp.originalName);
        const newPath = joinPath(dir, name);
        await provider.rename(oldPath, newPath);
        emitWorkspaceEvent({ type: 'renamed', oldPath, newPath });
      } else if (pendingOp.mode === 'new-file') {
        await provider.createEntry(joinPath(dir, name), 'file');
        emitWorkspaceEvent({ type: 'tree-changed' });
      } else if (pendingOp.mode === 'new-dir') {
        await provider.createEntry(joinPath(dir, name), 'dir');
        emitWorkspaceEvent({ type: 'tree-changed' });
      }
      setExpandedFolders((prev) => new Set([...prev, dir]));
      setPendingOp(null);
      setOpValue('');
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setOpBusy(false);
    }
  };

  const runDelete = async () => {
    if (!confirmDelete) return;
    setOpBusy(true);
    setOpError(null);
    try {
      await provider.delete(confirmDelete);
      emitWorkspaceEvent({ type: 'deleted', path: confirmDelete });
      setConfirmDelete(null);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setOpBusy(false);
    }
  };
```

- [ ] **Step 2: Wire the context menu into tree rows**

Add imports:

```tsx
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { FilePlus, FolderPlus, Pencil, Trash2 } from 'lucide-react';
```

In `renderTree`, wrap the row `<div>` with `<ContextMenu><ContextMenuTrigger asChild>...</ContextMenuTrigger><ContextMenuContent>...</ContextMenuContent></ContextMenu>`:

```tsx
        <div key={node.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              {/* the existing row div, unchanged */}
            </ContextMenuTrigger>
            <ContextMenuContent className="text-xs">
              <ContextMenuItem className="gap-2 cursor-pointer" onSelect={() => { setPendingOp({ mode: 'new-file', dir: node.kind === 'dir' ? node.path : parentOf(node.path) }); setOpValue(''); setOpError(null); }}>
                <FilePlus size={12} /> New File...
              </ContextMenuItem>
              <ContextMenuItem className="gap-2 cursor-pointer" onSelect={() => { setPendingOp({ mode: 'new-dir', dir: node.kind === 'dir' ? node.path : parentOf(node.path) }); setOpValue(''); setOpError(null); }}>
                <FolderPlus size={12} /> New Folder...
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className="gap-2 cursor-pointer" onSelect={() => { setPendingOp({ mode: 'rename', dir: parentOf(node.path), originalName: node.name }); setOpValue(node.name); setOpError(null); }}>
                <Pencil size={12} /> Rename...
              </ContextMenuItem>
              <ContextMenuItem className="gap-2 cursor-pointer text-red-400" onSelect={() => setConfirmDelete(node.path)}>
                <Trash2 size={12} /> Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {/* existing children rendering, unchanged */}
        </div>
```

- [ ] **Step 3: Render the name-entry dialog and delete confirmation**

Add before the drag-drop overlay at the end of the component JSX:

```tsx
      <Dialog open={pendingOp !== null} onOpenChange={(open) => { if (!open) setPendingOp(null); }}>
        <DialogContent className="max-w-sm bg-[#1c1c1f] border-border/50">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {pendingOp?.mode === 'rename' ? 'Rename' : pendingOp?.mode === 'new-dir' ? 'New Folder' : 'New File'}
            </DialogTitle>
          </DialogHeader>
          {opError && <p className="text-xs text-red-400">{opError}</p>}
          <Input
            autoFocus
            value={opValue}
            onChange={(e) => setOpValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runPendingOp(); }}
            placeholder="name"
            className="text-xs"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPendingOp(null)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" disabled={opBusy || !opValue.trim()} onClick={() => void runPendingOp()}>
              {opBusy ? 'Working...' : pendingOp?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent className="max-w-sm bg-[#1c1c1f] border-border/50">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground break-all">
            Delete <span className="text-foreground font-mono">{confirmDelete}</span>? This cannot be undone.
          </p>
          {opError && <p className="text-xs text-red-400">{opError}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={opBusy} onClick={() => void runDelete()}>
              {opBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Verify**

Run: `npm run lint:types` then `npm run lint:js`
Expected: PASS.

Run: `npm run dev` — in the browser workspace, right-click a folder: create a file, create a folder, rename, delete. The tree updates; imports still function.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileExplorer.tsx
git commit -m "feat(explorer): context menu create/rename/delete via provider"
```

---

### Task 11: EditorLayout — provider open/save, search, git panel, changed-on-disk

**Files:**
- Modify: `src/components/EditorLayout.tsx`

- [ ] **Step 1: Switch file I/O, search, and git to provider/clients**

Add imports:

```tsx
import { useFs, useGit, useWorkspace } from '../lib/fs/context';
import { FsError } from '../lib/fs/types';
import { onWorkspaceEvent } from '../lib/workspace-events';
import type { GitStatus } from '../lib/git/types';
```

Inside the component, add:

```tsx
  const provider = useFs();
  const git = useGit();
  const { openFolder } = useWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000);
  }, []);
```

Replace `loadFile` — the fake-shell `cat` becomes `provider.readFile`, and `ENOENT` no longer opens a fallback buffer:

```tsx
  const loadFile = useCallback(async (path: string) => {
    if (fileBuffersRef.current[path] !== undefined) {
      setActiveFilePath(path);
      return;
    }

    setIsLoadingFile(true);
    try {
      const content = await provider.readFile(path);
      setFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOriginalFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOpenTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, isDirty: false }]));
      setActiveFilePath(path);
    } catch (err) {
      if (err instanceof FsError && err.code === 'ENOENT') {
        notify(`File not found: ${path}`);
      } else {
        console.error('Failed to read file:', err);
        notify(`Could not open ${path}`);
      }
    } finally {
      setIsLoadingFile(false);
    }
  }, [provider, notify]);
```

Replace the auto-open-default-file effect (no more `find` through the fake shell):

```tsx
  useEffect(() => {
    const root = provider.root;
    if (root && openTabs.length === 0) {
      const tryOpenDefault = async () => {
        try {
          const { entries } = await provider.readDir(root);
          const srcDir = entries.find((e) => e.kind === 'dir' && e.name === 'src');
          if (srcDir) {
            const src = await provider.readDir(srcDir.path);
            const entry = src.entries.find((e) => ['App.tsx', 'App.jsx', 'main.tsx', 'index.tsx'].includes(e.name));
            if (entry) {
              void loadFile(entry.path);
              return;
            }
          }
          const firstFile = entries.find((e) => e.kind === 'file' && !e.name.startsWith('.'));
          if (firstFile) void loadFile(firstFile.path);
        } catch (e) {
          console.error('Could not find default file:', e);
        }
      };
      void tryOpenDefault();
    }
  }, [provider, openTabs.length, loadFile]);
```

Replace `saveActiveFile`'s `sb.files.write(...)` with `provider.writeFile(...)`; drop the `sandboxRef`/`sb` indirection (only `path`/`content` are needed) and keep the tab dirty on failure:

```tsx
    setIsSaving(true);
    try {
      await provider.writeFile(path, content);
      setOriginalFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, isDirty: false } : t)));
      setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Saved ${path}`]);
    } catch (err) {
      console.error('Failed to save file:', err);
      setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Error saving ${path}: ${err}`]);
      notify(`Could not save ${path.split('/').pop()} — your edits are kept in the editor`);
    } finally {
      setIsSaving(false);
    }
```

Replace `handleRunSearch` — no more `grep` through the fake shell:

```tsx
  const handleRunSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await provider.search({ query: searchQuery, maxResults: 200 });
      setSearchResults(results.map((r) => ({ path: r.path, line: r.line, text: r.lineText.trim() })));
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };
```

Replace the git-status effect with structured data:

```tsx
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (activeActivityView !== 'git') return;
    let cancelled = false;
    (async () => {
      const available = gitAvailable ?? (await git.available());
      setGitAvailable(available);
      if (!available) return;
      const status = await git.status();
      if (!cancelled) setGitStatus(status);
    })().catch(() => setGitStatus(null));
    return () => { cancelled = true; };
  }, [activeActivityView, git, gitAvailable]);
```

Update the Git view JSX: when `gitAvailable === false` show "Source control is not available in this workspace." — otherwise show `gitStatus.branch` and one row per `gitStatus.files` entry with its status letter and path. In the status bar, replace the hardcoded `main*` with `{gitStatus?.branch ?? 'no-git'}`. Delete the `gitStatusOutput`/`isLoadingGit` state (replaced by `gitStatus`/`gitAvailable`).

Also delete the now-unused `shellEscape` helper and the `sandbox`-keyed reload effect only if the typechecker flags them; the `sandbox` prop itself must stay — `BottomPanel`, `ChatPanel`, and the import pickers still use it.

- [ ] **Step 2: Tab sync for rename/delete + changed-on-disk**

Add a ref next to `fileBuffersRef`:

```tsx
  const openTabsRef = useRef<TabItem[]>([]);
  openTabsRef.current = openTabs;
```

Add the rename/delete sync effect:

```tsx
  // Keep open tabs in sync with explorer operations.
  useEffect(() => {
    const off = onWorkspaceEvent((event) => {
      if (event.type === 'renamed') {
        const { oldPath, newPath } = event;
        setOpenTabs((prev) => prev.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)));
        setFileBuffers((prev) => {
          if (!(oldPath in prev)) return prev;
          const { [oldPath]: content, ...rest } = prev;
          return { ...rest, [newPath]: content };
        });
        setOriginalFileBuffers((prev) => {
          if (!(oldPath in prev)) return prev;
          const { [oldPath]: content, ...rest } = prev;
          return { ...rest, [newPath]: content };
        });
        setActiveFilePath((prev) => (prev === oldPath ? newPath : prev));
      }
      if (event.type === 'deleted') {
        const { path } = event;
        setOpenTabs((prev) => prev.filter((t) => t.path !== path && !t.path.startsWith(`${path}/`)));
        setFileBuffers((prev) => Object.fromEntries(Object.entries(prev).filter(([p]) => p !== path && !p.startsWith(`${path}/`))));
        setActiveFilePath((prev) => (prev === path ? null : prev));
      }
    });
    return off;
  }, []);
```

Add the changed-on-disk effect (subscribes to the event bus — the explorer owns the single provider `watch` registration and forwards `files-changed`):

```tsx
  // React to external file changes (Electron watch; the explorer registers it).
  useEffect(() => {
    const off = onWorkspaceEvent(async (event) => {
      if (event.type !== 'files-changed') return;
      for (const path of event.paths) {
        const buffer = fileBuffersRef.current[path];
        if (buffer === undefined) continue;
        const isDirty = openTabsRef.current.find((t) => t.path === path)?.isDirty ?? false;
        if (isDirty) {
          notify(`${path.split('/').pop()} changed on disk — your edits are kept`);
          continue;
        }
        try {
          const fresh = await provider.readFile(path);
          setFileBuffers((prev) => ({ ...prev, [path]: fresh }));
          setOriginalFileBuffers((prev) => ({ ...prev, [path]: fresh }));
          notify(`${path.split('/').pop()} reloaded from disk`);
        } catch {
          /* file vanished; the deleted handler covers it */
        }
      }
    });
    return off;
  }, [provider, notify]);
```

Render `notice` inside the editor container (right after the `<InlineAIWidget ...>` element):

```tsx
            {notice && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-[#1c1c1f] border border-border/50 rounded px-3 py-1.5 text-[11px] text-zinc-300 shadow-lg">
                {notice}
              </div>
            )}
```

Add the `Ctrl+Alt+O` Open Folder binding in the existing `handleKeyDown` (the spec's `Ctrl+K Ctrl+O` chord is impossible here — `Ctrl+K` is already Inline AI):

```tsx
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFolder();
      }
```

- [ ] **Step 3: Verify**

Run: `npm run lint:types` then `npm run lint:js`
Expected: PASS.

Run: `npm run dev` — browser regression: open files, edit, save (Ctrl+S), run a search, git view shows "not available".

- [ ] **Step 4: Commit**

```bash
git add src/components/EditorLayout.tsx
git commit -m "feat(editor): provider-backed io, search, git status, disk-change sync"
```

---

### Task 12: End-to-end verification

**Files:**
- Create: `scripts/smoke-electron-fs.cjs`

- [ ] **Step 1: Create the smoke script**

```js
/**
 * Headless smoke check for the main-process workspace/git modules.
 * Runs the same modules the Electron app uses, against a temp folder.
 */
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const ws = require('../electron/workspace.cjs');
const git = require('../electron/git.cjs');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outlaw-smoke-'));
  ws.setRoot(dir);

  await ws.writeFile('smoke.txt', 'alpha');
  if ((await ws.readFile('smoke.txt')) !== 'alpha') throw new Error('roundtrip failed');
  await ws.rename('smoke.txt', 'renamed.txt');
  await ws.createEntry('deep/nested/dir', 'dir');
  const { entries } = await ws.readDir('.');
  if (!entries.some((e) => e.name === 'renamed.txt')) throw new Error('rename not visible');

  let escaped = false;
  try {
    await ws.readFile(path.join('..', 'outside.txt'));
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error('path confinement FAILED — outside reads were allowed');

  const gitOk = await git.isAvailable();
  console.log(`git available: ${gitOk}`);
  if (gitOk) {
    await fsp.writeFile(path.join(dir, 'g.txt'), '1');
    await git.stage(dir, ['g.txt']);
    await git.commit(dir, 'smoke commit');
    const status = await git.status(dir);
    if (!status || !status.clean) throw new Error('git status not clean after commit');
  }

  ws.setRoot(null);
  await fsp.rm(dir, { recursive: true, force: true });
  console.log('smoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run everything**

```bash
npm run test:electron
node scripts/smoke-electron-fs.cjs
npm run lint:types && npm run lint:js
npx vite build
```
Expected: all tests pass, smoke prints `smoke OK`, lint passes, build succeeds.

- [ ] **Step 3: Manual Electron pass**

Run: `npm run electron:dev` and work through:

1. File > Open Folder... — pick a real project folder; tree shows real files.
2. Open a file, edit, Ctrl+S — verify the file on disk changed.
3. Right-click > New File / New Folder / Rename / Delete — verify on disk.
4. Edit a file externally — the tab reloads (or keeps edits if dirty, with the notice).
5. On a real git repo: git view shows branch + files; explorer shows status colors.
6. Open a folder with >2000 entries — "Too many entries" indicator appears, no freeze.
7. File > Open Project History — recent folders listed; clicking reopens.

- [ ] **Step 4: Manual browser regression**

Run: `npm run dev` — virtual workspace: import folder, edit, save, search, git view shows "not available", no console errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-electron-fs.cjs
git commit -m "test: headless smoke for electron workspace/git modules"
```

---

## Self-review notes (resolved during planning)

- **Spec coverage:** provider abstraction (Tasks 6–7), Electron local folders + confinement (1, 5, 8), git CLI plumbing + structured status (4, 5), FileExplorer lazy tree + ops + colors (9–10), editor open/save via provider (11), search via provider (2, 11), watcher + changed-on-disk (3, 9, 11), recent folders (7, 8), typed FsError + error envelopes (1, 5, 6), smoke + verification (12).
- **Documented deviations from spec:** `FsEvent` union is `'changed' | 'deleted'` (fs.watch cannot distinguish created/modified); Open Folder shortcut is `Ctrl+Alt+O` (`Ctrl+K` is already Inline AI).
- **Type consistency:** `readDir` returns `{ entries, capped }` everywhere; git types defined once in `src/lib/git/types.ts` and mirrored by `electron/git.cjs` output (plain data, forward slashes); `WorkspaceEvent` has exactly four variants, emitted by the explorer (watch + ops) and consumed by the explorer and EditorLayout.
