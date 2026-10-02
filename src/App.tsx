import { useEffect, useState } from 'react';
import { createSandbox, connectSandbox } from './lib/sandbox';
import { SimpleLogin } from './components/SimpleLogin';
import { EditorLayout } from './components/EditorLayout';
import { HistoryModal, Project } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import {
  Settings,
  History as HistoryIcon,
  Plus,
  LogOut,
  FolderPlus,
  FolderOpen,
  FileUp,
  FolderUp,
  Sparkles,
  Command as CommandIcon,
  Files,
  Search,
  GitBranch,
  Terminal as TerminalIcon,
  FileText,
  Package,
} from 'lucide-react';
import { requestImportFiles, requestImportFolder } from './lib/import-files';
import { FsProvider, hasLocalFs, requestOpenFolder } from './lib/fs/context';
import { getRecentFolders } from './lib/recent-folders';
import { CommandPalette } from './components/CommandPalette';
import {
  emitWorkspaceCommand,
  getAvailableCommands,
  isWorkspaceCommand,
  type AppCommandId,
} from './lib/app-commands';
import { Button } from './components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';

export default function App() {
  const [userName, setUserName] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('cursor_user_name') : null
  );
  const isAuthenticated = !!userName;
  const [sandbox, setSandbox] = useState<any>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [projectName, setProjectName] = useState<string>('Workspace');

  // Handle Project Selection from History
  const handleSelectProject = async (project: Project) => {
    setShowHistory(false);
    if (sandbox?.id === project.sandboxId) return;

    window.history.pushState({}, '', `?sandboxId=${project.sandboxId}`);
    setProjectName(project.name || 'Workspace');

    try {
      const newSandbox = await connectSandbox(project.sandboxId);
      setSandbox(newSandbox);
    } catch (err) {
      console.error("Failed to connect to sandbox", err);
      alert("Could not connect to this sandbox. It might have expired.");
    }
  };

  // Initialize or connect sandbox on startup
  useEffect(() => {
    if (isAuthenticated && !sandbox) {
      const initSandbox = async () => {
        try {
          const params = new URLSearchParams(window.location.search);
          const sandboxId = params.get('sandboxId');

          if (sandboxId) {
            try {
              const sb = await connectSandbox(sandboxId);
              setSandbox(sb);
              setProjectName(`Project (${sandboxId.slice(0, 6)})`);
              return;
            } catch (err) {
              console.error("Failed to restore sandbox", err);
              window.history.replaceState({}, '', '/');
            }
          }

          const sb = await createSandbox();
          setSandbox(sb);
          if (sb?.id) {
            window.history.replaceState({}, '', `?sandboxId=${sb.id}`);
            setProjectName(`Workspace (${sb.id.slice(0, 6)})`);
          }
        } catch (err) {
          setSandboxError(err instanceof Error ? err.message : 'Failed to initialize sandbox');
        }
      };
      initSandbox();
    }
  }, [isAuthenticated, sandbox]);

  const handleNewProject = () => {
    window.history.pushState({}, '', '/');
    window.location.reload();
  };

  const openFolderHandler = (preselected?: string) => {
    requestOpenFolder(preselected);
    setShowHistory(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('cursor_user_name');
    setUserName(null);
    window.history.pushState({}, '', '/');
    window.location.reload();
  };

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

  if (!isAuthenticated) {
    return (
      <SimpleLogin
        onLogin={(name) => {
          localStorage.setItem('cursor_user_name', name);
          setUserName(name);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen bg-[#18181b] text-foreground flex flex-col overflow-hidden font-sans select-none">
      {/* Settings Modal */}
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={availableCommands}
        onExecute={executeCommand}
      />

      {/* History Modal */}
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

      {/* Top VS Code / Cursor Menubar (38px height) */}
      <header className="h-9 border-b border-border/40 flex items-center justify-between px-3 bg-[#1e1e22] shrink-0 z-30">
        {/* Left: Brand & Menus */}
        <div className="flex items-center gap-2">
          {/* Logo */}
          <div className="flex items-center gap-1.5 pr-2 border-r border-border/30 cursor-pointer" onClick={handleNewProject}>
            <svg fill="none" height="18" viewBox="0 0 545 545" width="18" xmlns="http://www.w3.org/2000/svg">
              <g fill="#007acc">
                <path d="m466.383 137.073-206.469-119.2034c-6.63-3.8287-14.811-3.8287-21.441 0l-206.4586 119.2034c-5.5734 3.218-9.0144 9.169-9.0144 15.615v240.375c0 6.436 3.441 12.397 9.0144 15.615l206.4686 119.203c6.63 3.829 14.811 3.829 21.441 0l206.468-119.203c5.574-3.218 9.015-9.17 9.015-15.615v-240.375c0-6.436-3.441-12.397-9.015-15.615zm-12.969 25.25-199.316 345.223c-1.347 2.326-4.904 1.376-4.904-1.319v-226.048c0-4.517-2.414-8.695-6.33-10.963l-195.7577-113.019c-2.3263-1.347-1.3764-4.905 1.3182-4.905h398.6305c5.661 0 9.199 6.136 6.368 11.041h-.009z"></path>
              </g>
            </svg>
            <span className="text-[12px] font-semibold text-zinc-200">Outlaw Code</span>
          </div>

          {/* Menus */}
          <div className="flex items-center gap-0.5 text-[12px]">
            {/* File Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-2 py-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors focus:outline-none">
                  File
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-[#202024] border-border/50 text-xs min-w-[170px]">
                <DropdownMenuItem onClick={handleNewProject} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Plus size={13} />
                  New Project
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('file.newFile')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FileText size={13} />
                  New File...
                  <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('file.newFolder')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FolderPlus size={13} />
                  New Folder...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('file.save')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FileText size={13} />
                  Save
                  <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={() => executeCommand('file.openHistory')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FolderPlus size={13} />
                  Open Project History...
                </DropdownMenuItem>
                {hasLocalFs() && (
                  <>
                    <DropdownMenuItem onClick={() => executeCommand('file.openFolder')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                      <FolderOpen size={13} />
                      Open Folder...
                      <DropdownMenuShortcut>Ctrl+Alt+O</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border/30" />
                  </>
                )}
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={() => requestImportFiles()} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FileUp size={13} />
                  Import File(s)...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => requestImportFolder()} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <FolderUp size={13} />
                  Import Folder...
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/30" />
                <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer text-red-400 focus:bg-zinc-800">
                  <LogOut size={13} />
                  Exit / Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-2 py-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors focus:outline-none">
                  View
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-[#202024] border-border/50 text-xs min-w-[240px]">
                <DropdownMenuItem onClick={() => setShowCommandPalette(true)} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <CommandIcon size={13} />
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
                <DropdownMenuItem onClick={() => executeCommand('view.tools')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Package size={13} />
                  Tools
                  <DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut>
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
            </DropdownMenu>

            {/* AI Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-2 py-1 rounded text-[#007acc] hover:text-[#38bdf8] hover:bg-[#007acc]/10 transition-colors focus:outline-none">
                  AI Copilot
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-[#202024] border-border/50 text-xs min-w-[180px]">
                <DropdownMenuItem onClick={() => executeCommand('preferences.aiSettings')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Sparkles size={13} />
                  Configure AI Model...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => executeCommand('preferences.aiSettings')} className="gap-2 cursor-pointer focus:bg-zinc-800">
                  <Settings size={13} />
                  API Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Center: Window Title */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
          <span className="text-[11px] text-zinc-400 font-medium">
            {projectName} — Outlaw Code
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-zinc-400 hover:text-white hover:bg-zinc-800/50 gap-1.5 px-2"
            onClick={handleNewProject}
            title="New Project"
          >
            <Plus size={13} />
            <span className="text-[11px]">New</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-zinc-400 hover:text-white hover:bg-zinc-800/50 gap-1.5 px-2"
            onClick={() => setShowHistory(true)}
            title="Recent Projects"
          >
            <HistoryIcon size={13} />
            <span className="text-[11px]">History</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-zinc-400 hover:text-white hover:bg-zinc-800/50 gap-1.5 px-2"
            onClick={() => setShowSettings(true)}
            title="AI Settings"
          >
            <Settings size={13} />
            <span className="text-[11px]">Settings</span>
          </Button>

          <div className="w-[1px] h-4 bg-border/40 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-zinc-400 hover:text-red-400 hover:bg-zinc-800/50 gap-1.5 px-2"
            onClick={handleLogout}
            title={`Logout (${userName})`}
          >
            <LogOut size={13} />
            <span className="text-[11px]">{userName}</span>
          </Button>
        </div>
      </header>

      {/* Main IDE Workspace */}
      <main className="flex-1 overflow-hidden relative">
        {sandboxError ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center text-red-400 space-y-3">
            <p className="text-sm font-medium">Failed to connect to development sandbox:</p>
            <p className="text-xs text-zinc-400 max-w-md">{sandboxError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="text-xs mt-2"
            >
              Retry Connection
            </Button>
          </div>
        ) : !sandbox && !hasLocalFs() ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center text-zinc-400 space-y-3">
            <p className="text-sm font-medium">Starting workspace...</p>
          </div>
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
      </main>
    </div>
  );
}
