import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Folder, File as FileIcon, ChevronRight, ChevronDown, RefreshCw, FileUp, FolderUp, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import {
  IMPORT_FILES_EVENT,
  IMPORT_FOLDER_EVENT,
  importFileList,
} from '../lib/import-files';
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
import { useFs, useGit } from '../lib/fs/context';
import type { FsEntry } from '../lib/fs/types';
import type { GitFileEntry } from '../lib/git/types';
import { onWorkspaceEvent, emitWorkspaceEvent } from '../lib/workspace-events';

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

  // React doesn't reliably render the non-standard `webkitdirectory`
  // attribute, and without it the folder picker degrades to a single-file
  // picker. Set it imperatively so folder selection always works.
  const setFolderInputRef = (el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  };

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

  // Import entries: file picker, folder picker, drag-drop, and global menu events.
  const handleImportList = async (list: FileList | null) => {
    if (!list || list.length === 0 || !sandbox || isImporting) return;
    setIsImporting(true);
    setImportStatus(`Importing ${list.length} file(s)...`);
    try {
      const { imported, skipped } = await importFileList(sandbox, list);
      emitWorkspaceEvent({ type: 'tree-changed' });
      if (imported.length > 0) {
        // Auto-expand the full ancestor chain of the first import so nested
        // folder contents are actually visible (not just the leaf parent).
        const ancestors = new Set<string>();
        let acc = imported[0].split('/').slice(0, -1).join('/');
        while (acc.startsWith(rootDir) && acc !== rootDir) {
          ancestors.add(acc);
          acc = acc.slice(0, acc.lastIndexOf('/'));
        }
        setExpandedFolders((prev) => new Set([...prev, ...ancestors]));
        for (const anc of ancestors) void loadDir(anc, { silent: true });
        setImportStatus(`Imported ${imported.length} file(s)`);
        onImportComplete?.(imported);
      } else {
        setImportStatus('Nothing imported');
      }
      if (skipped.length > 0) {
        console.warn('Skipped on import:', skipped);
        setImportStatus((prev) =>
          imported.length > 0
            ? `${prev} (${skipped.length} skipped)`
            : `${skipped.length} file(s) skipped (binary/too large)`
        );
      }
    } catch (err) {
      console.error('Import failed:', err);
      setImportStatus('Import failed');
    } finally {
      setIsImporting(false);
      // Clear picker values so the same file/folder can be picked again.
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
      setTimeout(() => setImportStatus(null), 4000);
    }
  };

  // Allow the top-level File menu (App.tsx) to open these pickers.
  useEffect(() => {
    const openFiles = () => fileInputRef.current?.click();
    const openFolder = () => folderInputRef.current?.click();
    window.addEventListener(IMPORT_FILES_EVENT, openFiles);
    window.addEventListener(IMPORT_FOLDER_EVENT, openFolder);
    return () => {
      window.removeEventListener(IMPORT_FILES_EVENT, openFiles);
      window.removeEventListener(IMPORT_FOLDER_EVENT, openFolder);
    };
  }, []);

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

  // Context-menu file operations (create / rename / delete via provider)
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
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-1.5 py-1 px-2 cursor-pointer text-sm hover:bg-[#2a2a2a] transition-colors select-none",
                  isSelected && "bg-[#37373d] text-white",
                  !isSelected && "text-muted-foreground"
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
                    <Folder className={cn("w-3.5 h-3.5 shrink-0", isExpanded ? "text-blue-400" : "text-blue-300")} />
                    <span className="truncate">{node.name}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 overflow-hidden">
                    <span className="w-3.5" /> {/* Spacer for alignment */}
                    <FileIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className={cn("truncate", gitStatusColor(node.path))}>{node.name}</span>
                  </span>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="text-xs">
              <ContextMenuItem
                className="gap-2 cursor-pointer"
                onSelect={() => {
                  setPendingOp({ mode: 'new-file', dir: node.kind === 'dir' ? node.path : parentOf(node.path) });
                  setOpValue('');
                  setOpError(null);
                }}
              >
                <FilePlus size={12} /> New File...
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 cursor-pointer"
                onSelect={() => {
                  setPendingOp({ mode: 'new-dir', dir: node.kind === 'dir' ? node.path : parentOf(node.path) });
                  setOpValue('');
                  setOpError(null);
                }}
              >
                <FolderPlus size={12} /> New Folder...
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="gap-2 cursor-pointer"
                onSelect={() => {
                  setPendingOp({ mode: 'rename', dir: parentOf(node.path), originalName: node.name });
                  setOpValue(node.name);
                  setOpError(null);
                }}
              >
                <Pencil size={12} /> Rename...
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 cursor-pointer text-red-400"
                onSelect={() => setConfirmDelete(node.path)}
              >
                <Trash2 size={12} /> Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
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

  return (
    <div
      className={cn("flex flex-col h-full bg-[#181818] border-r border-[#2b2b2b] relative", className)}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current += 1;
        if (e.dataTransfer?.types?.includes('Files')) setIsDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragOver(false);
        void handleImportList(e.dataTransfer?.files ?? null);
      }}
    >
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#2b2b2b] shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Explorer</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 hover:bg-[#333]"
            title="Import file(s)..."
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <FileUp className={cn("w-3 h-3", isImporting && "animate-pulse")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 hover:bg-[#333]"
            title="Import folder..."
            onClick={() => folderInputRef.current?.click()}
            disabled={isImporting}
          >
            <FolderUp className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-[#333]" title="Refresh" onClick={() => void refreshRoot()}>
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Hidden pickers: one for files, one for folders (webkitdirectory) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void handleImportList(e.target.files)}
      />
      <input
        ref={setFolderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void handleImportList(e.target.files)}
      />

      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-400 border-b border-[#2b2b2b]">{error}</div>
      )}
      {(importStatus || isImporting) && (
        <div className="px-3 py-1.5 text-[11px] text-zinc-400 border-b border-[#2b2b2b] flex items-center gap-1.5">
          <Upload size={11} className={cn(isImporting && "animate-pulse")} />
          <span className="truncate">{importStatus ?? 'Importing...'}</span>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="py-2">
          {(tree[rootDir] ?? []).length === 0 ? (
            <div className="px-4 py-8 text-center space-y-3">
              <p className="text-xs text-muted-foreground">
                {isLoading ? 'Loading...' : isImporting ? 'Importing...' : 'No files found'}
              </p>
              {!isLoading && (
                <div className="flex flex-col gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                  >
                    <FileUp size={12} />
                    Import files...
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => folderInputRef.current?.click()}
                    disabled={isImporting}
                  >
                    <FolderUp size={12} />
                    Import folder...
                  </Button>
                  <p className="text-[10px] text-muted-foreground/70">or drag &amp; drop here</p>
                </div>
              )}
            </div>
          ) : (
            renderTree(tree[rootDir] ?? [])
          )}
        </div>
      </ScrollArea>

      {/* Create / rename dialog */}
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

      {/* Delete confirmation */}
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

      {/* Drag-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-[#007acc]/10 border-2 border-dashed border-[#007acc]/60 flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-1">
            <Upload size={20} className="mx-auto text-[#007acc]" />
            <p className="text-xs text-[#007acc] font-medium">Drop files / folders to import</p>
          </div>
        </div>
      )}
    </div>
  );
}
