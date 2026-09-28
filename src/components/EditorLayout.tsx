import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save, Sparkles, Terminal as TermIcon,
  ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen,
  PanelLeftClose, PanelLeftOpen, Search, RefreshCw,
  GitBranch, Check, FolderOpen, FileUp, FolderUp
} from 'lucide-react';
import { cn } from '../lib/utils';
import { requestImportFiles, requestImportFolder, IMPORT_FILES_EVENT, IMPORT_FOLDER_EVENT } from '../lib/import-files';
import { ActivityBar, type ActivityView } from './ActivityBar';
import { useFs, useGit, useWorkspace } from '../lib/fs/context';
import { FsError } from '../lib/fs/types';
import { onWorkspaceEvent } from '../lib/workspace-events';
import type { GitStatus } from '../lib/git/types';
import { FileExplorer } from './FileExplorer';
import { EditorTabs, type TabItem } from './EditorTabs';
import { InlineAIWidget } from './InlineAIWidget';
import { BottomPanel, type BottomTab } from './BottomPanel';
import { ChatPanel } from './ChatPanel';
import { Button } from './ui/button';
import Editor from '@monaco-editor/react';

interface EditorLayoutProps {
  sandbox: any | null;
  initialPrompt?: string | null;
  onOpenSettings?: () => void;
  onOpenFolder?: (preselected?: string) => void;
}

function getLanguage(path: string | null): string {
  if (!path) return 'plaintext';
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
    py: 'python', sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  };
  return map[ext || ''] || 'plaintext';
}

export function EditorLayout({ sandbox, initialPrompt, onOpenSettings }: EditorLayoutProps) {
  // Activity Bar & Sidebar State
  const [activeActivityView, setActiveActivityView] = useState<ActivityView>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Search & Git panel states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ path: string; line: number; text: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  // Multi-Tab & File Buffers State
  const [openTabs, setOpenTabs] = useState<TabItem[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileBuffers, setFileBuffers] = useState<Record<string, string>>({});
  const [originalFileBuffers, setOriginalFileBuffers] = useState<Record<string, string>>({});
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Editor cursor / selection tracking
  const [selectedText, setSelectedText] = useState('');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const editorInstanceRef = useRef<any>(null);

  // Inline AI Widget (Ctrl+K)
  const [inlineAIOpen, setInlineAIOpen] = useState(false);

  // Bottom Panel (Terminal / Output / Preview)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('terminal');
  const [isResizingBottom, setIsResizingBottom] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);

  // AI Chat Panel (Right)
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(360);
  const [isResizingChat, setIsResizingChat] = useState(false);

  // Stable references for async callbacks
  const sandboxRef = useRef<any>(null);
  sandboxRef.current = sandbox;
  const activeFilePathRef = useRef<string | null>(null);
  activeFilePathRef.current = activeFilePath;
  const fileBuffersRef = useRef<Record<string, string>>({});
  fileBuffersRef.current = fileBuffers;
  const openTabsRef = useRef<TabItem[]>([]);
  openTabsRef.current = openTabs;

  const provider = useFs();
  const git = useGit();
  const { openFolder } = useWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((prev) => (prev === message ? null : prev)), 4000);
  }, []);

  // Clear workspace when switching sandboxes
  useEffect(() => {
    setOpenTabs([]);
    setActiveFilePath(null);
    setFileBuffers({});
    setOriginalFileBuffers({});
    setIsLoadingFile(false);
    setSelectedText('');
  }, [sandbox?.id]);

  // Import entries from the top-level File menu / empty state: make sure the
  // Explorer (which owns the file/folder pickers) is visible, then forward
  // the event so its listener can open the picker.
  useEffect(() => {
    const forward = (type: string) => (e: Event) => {
      if ((e as CustomEvent).detail?.forwarded) return;
      setActiveActivityView('explorer');
      setSidebarOpen(true);
      setTimeout(() => window.dispatchEvent(new CustomEvent(type, { detail: { forwarded: true } })), 50);
    };
    const forwardFiles = forward(IMPORT_FILES_EVENT);
    const forwardFolder = forward(IMPORT_FOLDER_EVENT);
    window.addEventListener(IMPORT_FILES_EVENT, forwardFiles);
    window.addEventListener(IMPORT_FOLDER_EVENT, forwardFolder);
    return () => {
      window.removeEventListener(IMPORT_FILES_EVENT, forwardFiles);
      window.removeEventListener(IMPORT_FOLDER_EVENT, forwardFolder);
    };
  }, []);

  // Load a file from the workspace provider into tabs
  const loadFile = useCallback(async (path: string) => {
    // If file is already open in buffers, just activate it
    if (fileBuffersRef.current[path] !== undefined) {
      setActiveFilePath(path);
      return;
    }

    setIsLoadingFile(true);
    try {
      const content = await provider.readFile(path);
      setFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOriginalFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOpenTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, { path, isDirty: false }];
      });
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

  // Auto-open a primary file (App.tsx / main.tsx / any file) on connect
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

  // Handle Tab Selection
  const handleSelectTab = (path: string) => {
    setActiveFilePath(path);
  };

  // Handle Tab Close
  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeFilePath === path) {
        const nextActive = next.length > 0 ? next[next.length - 1].path : null;
        setActiveFilePath(nextActive);
      }
      return next;
    });
  };

  // Auto-open the first file after an import completes.
  const handleImportComplete = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Imported ${paths.length} file(s)`]);
      void loadFile(paths[0]);
    }
  }, [loadFile]);

  // Handle Editor Content Change
  const handleEditorChange = (val: string | undefined) => {
    if (!activeFilePath) return;
    const newContent = val ?? '';
    setFileBuffers((prev) => ({ ...prev, [activeFilePath]: newContent }));
    const isDirty = newContent !== (originalFileBuffers[activeFilePath] ?? '');
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === activeFilePath ? { ...t, isDirty } : t))
    );
  };

  // Save current active file through the workspace provider
  const saveActiveFile = useCallback(async () => {
    const path = activeFilePathRef.current;
    if (!path) return;
    const content = fileBuffersRef.current[path];
    if (content === undefined) return;

    setIsSaving(true);
    try {
      await provider.writeFile(path, content);
      setOriginalFileBuffers((prev) => ({ ...prev, [path]: content }));
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, isDirty: false } : t))
      );
      setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Saved ${path}`]);
    } catch (err) {
      console.error('Failed to save file:', err);
      setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Error saving ${path}: ${err}`]);
      notify(`Could not save ${path.split('/').pop()} - your edits are kept in the editor`);
    } finally {
      setIsSaving(false);
    }
  }, [provider, notify]);

  // Handle Code Replacement from Inline AI or Chat
  const handleApplyCode = (replacement: string) => {
    const editor = editorInstanceRef.current;
    if (!editor || !activeFilePath) return;

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      editor.executeEdits('ai-assistant', [{
        range: selection,
        text: replacement,
        forceMoveMarkers: true,
      }]);
    } else {
      // If no selection, replace or insert at cursor
      const position = editor.getPosition();
      if (position) {
        editor.executeEdits('ai-assistant', [{
          range: new (window as any).monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          text: replacement,
          forceMoveMarkers: true,
        }]);
      }
    }
    const updated = editor.getValue();
    handleEditorChange(updated);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveFile();
      }
      // Ctrl+K: Inline AI
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setInlineAIOpen((prev) => !prev);
      }
      // Ctrl+` (backtick): Toggle bottom panel
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setBottomPanelOpen((prev) => !prev);
      }
      // Ctrl+L: Toggle AI chat panel
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAiPanelOpen((prev) => !prev);
      }
      // Ctrl+Alt+O: Open Folder (Electron local workspace)
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFolder();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveFile, openFolder]);

  // Sidebar drag resizing
  const startResizingSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  }, []);

  // Chat drag resizing
  const startResizingChat = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingChat(true);
  }, []);

  // Bottom panel drag resizing
  const startResizingBottom = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingBottom(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(160, Math.min(e.clientX - 48, 500));
        setSidebarWidth(newWidth);
      }
      if (isResizingChat) {
        const newWidth = Math.max(260, Math.min(window.innerWidth - e.clientX, 650));
        setChatWidth(newWidth);
      }
      if (isResizingBottom) {
        const newHeight = Math.max(120, Math.min(window.innerHeight - e.clientY - 24, 600));
        setBottomPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingChat(false);
      setIsResizingBottom(false);
    };

    if (isResizingSidebar || isResizingChat || isResizingBottom) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingChat, isResizingBottom]);

  // Handle Workspace Search (through the workspace provider)
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

  // Fetch structured git status when the git view is opened
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

  // React to external file changes (the explorer owns the provider watch).
  useEffect(() => {
    const off = onWorkspaceEvent(async (event) => {
      if (event.type !== 'files-changed') return;
      for (const path of event.paths) {
        const buffer = fileBuffersRef.current[path];
        if (buffer === undefined) continue;
        const isDirty = openTabsRef.current.find((t) => t.path === path)?.isDirty ?? false;
        if (isDirty) {
          notify(`${path.split('/').pop()} changed on disk - your edits are kept`);
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

  const currentFileContent = activeFilePath ? fileBuffers[activeFilePath] ?? '' : '';
  const currentTabItem = openTabs.find((t) => t.path === activeFilePath);
  const isCurrentDirty = currentTabItem?.isDirty ?? false;

  return (
    <div className="relative h-full w-full bg-[#18181b] overflow-hidden flex flex-col font-sans select-none">
      {/* Main Workspace Body */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {/* Activity Bar (Far Left Strip) */}
        <ActivityBar
          activeView={activeActivityView}
          onSelectView={setActiveActivityView}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          aiPanelOpen={aiPanelOpen}
          onToggleAIPanel={() => setAiPanelOpen((prev) => !prev)}
          onOpenSettings={onOpenSettings || (() => {})}
        />

        {/* Primary Sidebar (Explorer / Search / Git) */}
        {sidebarOpen && (
          <div
            style={{ width: sidebarWidth }}
            className="h-full bg-[#1c1c1f] border-r border-border/40 flex flex-col relative shrink-0"
          >
            {/* Explorer View */}
            {activeActivityView === 'explorer' && (
              <FileExplorer
                sandbox={sandbox}
                selectedFile={activeFilePath}
                onFileSelect={(path) => loadFile(path)}
                onImportComplete={handleImportComplete}
              />
            )}

            {/* Search View */}
            {activeActivityView === 'search' && (
              <div className="h-full flex flex-col text-xs text-foreground p-3 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Search in Workspace
                </div>
                <form onSubmit={handleRunSearch} className="flex gap-1.5">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search files..."
                    className="flex-1 bg-[#18181b] border border-border/40 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#007acc]"
                  />
                  <Button type="submit" size="sm" className="h-7 px-2 bg-[#007acc] text-white">
                    <Search size={12} />
                  </Button>
                </form>
                <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px]">
                  {isSearching && <div className="text-muted-foreground">Searching...</div>}
                  {!isSearching && searchResults.length === 0 && searchQuery && (
                    <div className="text-muted-foreground">No matches found.</div>
                  )}
                  {searchResults.map((res, i) => (
                    <div
                      key={i}
                      onClick={() => loadFile(res.path)}
                      className="p-1.5 rounded hover:bg-zinc-800/60 cursor-pointer transition-colors border border-transparent hover:border-border/30"
                    >
                      <div className="text-[#007acc] font-medium truncate">{res.path.split('/').pop()}:{res.line}</div>
                      <div className="text-zinc-400 truncate">{res.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Git View */}
            {activeActivityView === 'git' && (
              <div className="h-full flex flex-col text-xs text-foreground p-3 space-y-3 font-mono">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground font-sans flex items-center gap-1.5">
                  <GitBranch size={13} className="text-[#007acc]" />
                  Source Control
                </div>
                <div className="flex-1 overflow-y-auto bg-[#18181b] p-2.5 rounded border border-border/30 text-zinc-300 text-[11px] space-y-1">
                  {gitAvailable === null && 'Checking git status...'}
                  {gitAvailable === false && 'Source control is not available in this workspace.'}
                  {gitAvailable && gitStatus && (
                    <>
                      <div className="text-[#007acc] font-sans font-medium pb-1">
                        {gitStatus.branch ?? '(detached)'}
                        {gitStatus.clean && <span className="text-muted-foreground font-normal"> - working tree clean</span>}
                      </div>
                      {gitStatus.files.map((f) => (
                        <div key={f.path} className="flex items-center gap-1.5">
                          <span
                            className={
                              f.status === 'untracked' ? 'text-green-400' : f.staged ? 'text-green-500' : 'text-amber-400'
                            }
                          >
                            {f.status === 'untracked' ? 'U' : f.status[0].toUpperCase()}
                          </span>
                          <span className="truncate">{f.path}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Sidebar Resizer Handle */}
            <div
              onMouseDown={startResizingSidebar}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-[#007acc] transition-colors z-20"
            />
          </div>
        )}

        {/* Center: Monaco Editor & Bottom Panel Group */}
        <div className="flex-1 h-full flex flex-col min-w-0 bg-[#1e1e1e] relative">
          {/* Editor Header Bar: Tabs + Quick Actions */}
          <div className="h-9 bg-[#18181b] flex items-center justify-between shrink-0 pr-2">
            <div className="flex-1 overflow-hidden">
              <EditorTabs
                tabs={openTabs}
                activeTab={activeFilePath}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
              />
            </div>

            {/* Editor Action Buttons */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-xs gap-1.5 transition-colors",
                  isCurrentDirty ? "text-amber-400 hover:text-amber-300 font-medium" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={saveActiveFile}
                disabled={isSaving || !activeFilePath}
                title="Save File (Ctrl+S)"
              >
                <Save size={12} className={cn(isSaving && "animate-pulse")} />
                <span className="text-[11px]">{isCurrentDirty ? "Save *" : "Saved"}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-[#007acc] hover:text-[#38bdf8] hover:bg-[#007acc]/10"
                onClick={() => setInlineAIOpen((prev) => !prev)}
                title="Inline AI Edit (Ctrl+K)"
              >
                <Sparkles size={12} />
                <span className="text-[11px]">Edit (Ctrl+K)</span>
              </Button>

              <div className="w-[1px] h-4 bg-border/40 mx-0.5" />

              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", bottomPanelOpen && "text-white")}
                onClick={() => setBottomPanelOpen((prev) => !prev)}
                title="Toggle Terminal / Bottom Panel (Ctrl+`)"
              >
                <TermIcon size={13} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", aiPanelOpen && "text-[#007acc]")}
                onClick={() => setAiPanelOpen((prev) => !prev)}
                title="Toggle AI Assistant (Ctrl+L)"
              >
                {aiPanelOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
              </Button>
            </div>
          </div>

          {/* Monaco Editor Container */}
          <div className="flex-1 overflow-hidden relative">
            <InlineAIWidget
              isOpen={inlineAIOpen}
              onClose={() => setInlineAIOpen(false)}
              filePath={activeFilePath}
              selectedText={selectedText}
              fullFileContent={currentFileContent}
              onAccept={handleApplyCode}
            />

            {notice && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-[#1c1c1f] border border-border/50 rounded px-3 py-1.5 text-[11px] text-zinc-300 shadow-lg">
                {notice}
              </div>
            )}

            {isLoadingFile ? (
              <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                Loading file...
              </div>
            ) : activeFilePath ? (
              <Editor
                height="100%"
                language={getLanguage(activeFilePath)}
                value={currentFileContent}
                theme="vs-dark"
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  padding: { top: 8 },
                }}
                onChange={handleEditorChange}
                onMount={(editor, monaco) => {
                  editorInstanceRef.current = editor;

                  // Track cursor position and selection
                  editor.onDidChangeCursorPosition((e) => {
                    setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                  });

                  editor.onDidChangeCursorSelection((e) => {
                    const sel = editor.getModel()?.getValueInRange(e.selection) || '';
                    setSelectedText(sel);
                  });

                  // Bind Ctrl+S
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    saveActiveFile();
                  });

                  // Bind Ctrl+K
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
                    setInlineAIOpen(true);
                  });

                  // Bind Ctrl+L
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
                    setAiPanelOpen((prev) => !prev);
                  });
                }}
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/40 gap-3">
                <FolderOpen size={36} className="opacity-30" />
                <p className="text-xs">Select a file from the explorer to begin editing</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => requestImportFiles()}
                    title="Import file(s) into the workspace"
                  >
                    <FileUp size={12} />
                    Import files...
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => requestImportFolder()}
                    title="Import a folder into the workspace"
                  >
                    <FolderUp size={12} />
                    Import folder...
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Resizer Handle for Bottom Panel */}
          {bottomPanelOpen && (
            <div
              onMouseDown={startResizingBottom}
              className="h-1 w-full bg-border/30 hover:bg-[#007acc] cursor-ns-resize transition-colors z-20 shrink-0"
            />
          )}

          {/* Bottom Panel (Terminal / Output / Preview) */}
          <BottomPanel
            isOpen={bottomPanelOpen}
            onToggle={() => setBottomPanelOpen(false)}
            height={bottomPanelHeight}
            sandbox={sandbox}
            buildLogs={buildLogs}
            activeTab={activeBottomTab}
            onSelectTab={setActiveBottomTab}
          />
        </div>

        {/* AI Assistant Panel (Right) */}
        {aiPanelOpen && (
          <div
            style={{ width: chatWidth }}
            className="h-full bg-background border-l border-border/40 flex flex-col relative shrink-0"
          >
            {/* Chat Resizer Handle */}
            <div
              onMouseDown={startResizingChat}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-[#007acc] transition-colors z-20"
            />

            <ChatPanel
              key={sandbox?.id || 'no-sandbox'}
              sandbox={sandbox}
              isEmbedded={true}
              initialPrompt={initialPrompt}
              activeFile={activeFilePath}
              selectedCode={selectedText}
              onApplyCode={handleApplyCode}
            />
          </div>
        )}
      </div>

      {/* Status Bar (Very Bottom, 22px) */}
      <footer className="h-6 bg-[#007acc] text-white flex items-center justify-between px-3 text-[11px] font-sans shrink-0 select-none z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 hover:bg-black/10 px-1.5 py-0.5 rounded cursor-pointer">
            <GitBranch size={11} />
            <span>{gitStatus?.branch ?? 'no-git'}</span>
          </div>
          {activeFilePath && (
            <span className="opacity-80 truncate max-w-[300px]">{activeFilePath}</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          <span>UTF-8</span>
          <span className="capitalize">{getLanguage(activeFilePath)}</span>
          <button
            onClick={() => setBottomPanelOpen((prev) => !prev)}
            className="hover:bg-black/10 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
          >
            {bottomPanelOpen ? "Hide Terminal" : "Show Terminal"}
          </button>
        </div>
      </footer>
    </div>
  );
}
