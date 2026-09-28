# Milestone 1 — Real local folders + git in Electron (FS provider foundation)

Date: 2026-09-27
Status: approved design (pending user spec review)

## Goal

Turn Outlaw Code's virtual, in-browser workspace into a real editor: in the
Electron desktop build the app can open a local folder, edit files on disk, run
real git commands, and watch for external changes. The browser build keeps
today's virtual workspace behavior unchanged. Everything is built behind one
`FileSystemProvider` abstraction so later milestones (command palette, global
search, Source Control panel, split view, breadcrumbs) plug in once and work in
both modes.

Milestone 1 is the first of three:

1. **M1 (this spec)** — FS provider abstraction + Electron local folders + git plumbing
2. **M2** — Command palette (Ctrl+Shift+P), quick-open files (Ctrl+P), keyboard shortcuts, status bar
3. **M3** — VS Code side panels (Source Control, Search results, Outline) + editor power features (split view, breadcrumbs, minimap, diff view)

## Background

- Today `src/lib/sandbox.ts` is a stub: an in-memory `Map<path, content>` with a
  fake shell (`commands.run`) that supports `cat`, `find`, `ls`, and nothing else.
- `FileExplorer` builds its tree by parsing `find` output from that fake shell.
- `EditorLayout` runs `grep` and `git status --short` through the same fake shell.
- `electron/main.cjs` (304 lines) runs the AI proxy only; `preload.cjs` exposes
  `window.outlawCode` with `platform`, `aiProxyBaseURL`, `aiProxyToken` and no FS.
- No test framework exists in the repo; verification is lint/typecheck/build
  plus manual passes.

## Architecture

### Layers

```
Renderer (React)                      Electron main
────────────────                      ────────────
FsProviderContext
  ├─ virtual-provider  ── in-memory Map (browser, unchanged)
  └─ electron-provider ── window.outlawCode.fs.* ── ipcMain.handle ── fs/promises
                                                               ├─ dialog.showOpenDialog
                                                               └─ fs.watch (recursive, Windows)

GitClient
  ├─ NullGitClient     ── browser/virtual mode
  └─ via electron       ── window.outlawCode.git.* ── ipcMain.handle ── child_process.execFile('git', ...)
```

### `src/lib/fs/types.ts`

```ts
interface FileSystemProvider {
  readonly capabilities: { local: boolean; watch: boolean; search: boolean };

  openFolder(): Promise<string | null>;        // null in browser/virtual mode
  readDir(path: string): Promise<FsEntry[]>;   // lazy children on expand
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, type: 'file' | 'dir'): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  watch(path: string, cb: (events: FsEvent[]) => void): Promise<void>;
}
```

Types: `FsEntry { name; path; kind: 'file' | 'dir' }`, `SearchQuery { query;
includeGlob?; excludeGlob?; maxResults }`, `SearchResult { path; line; lineText;
matchStart; matchEnd }`, `FsEvent { type: 'changed' | 'created' | 'deleted';
path }`.

### Implementations

- `virtual-provider.ts` — wraps the existing stub sandbox map and the
  `import-files.ts` helpers as-is. Browser behavior identical to today.
- `electron-provider.ts` — thin proxies to `window.outlawCode.fs.*` /
  `window.outlawCode.git.*`.
- `src/lib/fs/index.ts` — `createProvider()`: picks the Electron provider when
  `window.outlawCode?.fs` exists, else the virtual provider. Exposed to the
  component tree through `FsProviderContext` at the App root; no component ever
  branches on mode.

### Git

`GitClient` interface: `available()`, `status()`, `diff(file)`, `stage(paths)`,
`unstage(paths)`, `commit(message)`, `branch()`, `discard(paths)`.

- Electron implementation lives in `electron/main.cjs`: spawn the `git` CLI via
  `child_process.execFile` (argument arrays only — no shell interpolation).
  `git status --porcelain -z` is parsed in the main process and returned as
  structured data; the renderer never parses git stdout.
- `NullGitClient` for virtual mode: `available()` returns false; all UI derived
  from it shows "not available" states.
- `git --version` probe at workspace open decides availability.

### Security (path confinement)

Every FS/git IPC handler:

1. Resolves the target with `fs.realpath`.
2. Rejects any path that is not inside the currently opened root
   (`OUTSIDE_ROOT`), including via symlink escape.
3. Same confinement check applies to rename destinations and to the git
   working directory (`git -C <root> ...`).

The renderer can never touch arbitrary disk locations.

## Components and data flow

### App (`App.tsx`)

- Mounts `FsProviderContext` and a small `WorkspaceContext` (root path, display
  name, mode).
- Electron: **File > Open Folder** menu item and `Ctrl+K Ctrl+O` shortcut call
  `provider.openFolder()`; the picked folder becomes the workspace root.
- Most recent folders stored in `localStorage`; the History modal gains a
  "Recent folders" section.
- Browser: current virtual-workspace flow unchanged.

### `FileExplorer` (largest piece)

- Tree built from `readDir()` calls — lazy per-directory expansion; folders
  first, then files, alphabetical.
- Context menu: New File, New Folder, Rename, Delete (with confirmation
  dialog) — all through provider calls.
- Git status colors per entry (modified = orange, untracked = green, ignored =
  gray) from one `git status` snapshot per refresh, not per row.
- `watch()` events refresh affected tree nodes and flag open tabs whose files
  changed on disk.

### `EditorTabs` / `EditorLayout`

- Open and save through the provider; Ctrl+S = `writeFile`; per-tab dirty dot
  kept, pointed at the provider.
- Rename/delete in the explorer updates or closes open tabs via a small event
  bus (`src/lib/workspace-events.ts`) — the explorer holds no references into
  the editor.

### Search

`EditorLayout`'s grep-through-sandbox hack is replaced by `provider.search()`:
- Electron: fast Node directory walk in the main process (no ripgrep binary),
  skipping `node_modules`, `.git`, `dist`, `build`, binaries, and files > 5MB.
- Virtual: search the in-memory map.
- Same results UI as today.

### Explicitly out of scope for M1

Source Control panel UI, command palette, quick-open, split view, breadcrumbs,
minimap, diff view, extensions panel, debug panel. Git plumbing lands now; its
panel and the palette arrive in M2/M3 and consume `GitClient`/provider directly.

## Error handling

- **Path safety**: `fs.realpath` + inside-root check on every handler; rename
  destinations checked. Errors are typed (`FsError.code`: `ENOENT`, `EISDIR`,
  `OUTSIDE_ROOT`, `EPERM`) so the renderer shows the right message, not a
  generic alert.
- **Dirty data on failure**: if `writeFile` fails (locked file, deleted
  folder), the tab keeps its dirty state and a toast explains why. Content is
  never lost silently.
- **File changed on disk**: watcher event on an open clean file → toast with
  Reload / Keep Mine. Open dirty file → buffer untouched; default is keep local
  edits.
- **Git missing**: all git-derived UI degrades to hidden / "not available";
  never a thrown error in the render path.
- **Watcher limits**: on `EPERM` watcher errors (rename storms during builds),
  the watcher restarts once after a 2s debounce and triggers a single tree
  refresh.
- **Large folders**: directory reads cap at 2000 entries per level with a "too
  many entries" indicator; search skips binaries and files > 5MB (same limits
  as `import-files.ts`).

## Verification

No test framework in the repo; Milestone 1 verification is:

1. `npm run lint:types` and `npm run lint:js` pass.
2. A Node smoke script (`scripts/smoke-electron-fs.cjs`) imports the
   main-process FS module and exercises read/write/rename/delete and the
   `OUTSIDE_ROOT` violation against a temp folder — proving path confinement
   without a GUI.
3. `npm run electron:dev` manual pass: open a real folder, edit, save, rename,
   delete, external edit while open, git status colors on a real repo.
4. `npm run dev` (browser) regression: virtual workspace works exactly as
   before.

## Decisions and rejected alternatives

- **FS-provider abstraction (chosen)** over wiring FileExplorer directly to
  IPC (rejected: every later feature needs two ad-hoc code paths) and over
  Monaco's filesystem-provider API (rejected: the file tree and panels are
  custom React components, poor fit).
- **git CLI via `execFile` (chosen)** over bundling `isomorphic-git`
  (rejected: slower, missing stash/worktree features) — with graceful
  degradation when git is not installed.
- **Structured git status from main process (chosen)** over parsing
  stdout in the renderer (rejected: fragile, duplicate parsing paths).
