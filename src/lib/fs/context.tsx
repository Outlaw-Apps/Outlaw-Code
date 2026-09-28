import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FileSystemProvider, WorkspaceInfo, VirtualSandbox } from './types';
import { VirtualFsProvider } from './virtual-provider';
import { ElectronFsProvider } from './electron-provider';
import type { GitClient } from '../git/types';
import { NullGitClient } from '../git/null-client';
import { ElectronGitClient } from '../git/electron-client';
import { addRecentFolder } from '../recent-folders';
import { emitWorkspaceEvent } from '../workspace-events';

const FsCtx = createContext<FileSystemProvider | null>(null);
const GitCtx = createContext<GitClient | null>(null);
export const OPEN_FOLDER_EVENT = 'outlaw:open-folder';

export function requestOpenFolder(preselected?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_FOLDER_EVENT, { detail: { preselected } }));
}

interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  openFolder: (preselected?: string) => Promise<string | null>;
  setSwitchGuard: (fn: (() => boolean) | null) => void;
}

const WsCtx = createContext<WorkspaceState>({
  workspace: null,
  openFolder: async () => null,
  setSwitchGuard: () => {},
});

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
  const providerKey = hasLocalFs() ? null : sandbox;
  const provider = useMemo(() => createProvider(sandbox), [providerKey]);
  const git = useMemo(() => createGitClient(), []);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const switchGuardRef = useRef<(() => boolean) | null>(null);

  const setSwitchGuard = useCallback((fn: (() => boolean) | null) => {
    switchGuardRef.current = fn;
  }, []);

  const openFolder = useCallback(
    async (preselected?: string) => {
      if (switchGuardRef.current && !switchGuardRef.current()) return null;
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

  useEffect(() => {
    const onOpenFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ preselected?: string }>).detail;
      void openFolder(detail?.preselected).catch((err) => {
        console.error('Failed to open folder:', err);
      });
    };
    window.addEventListener(OPEN_FOLDER_EVENT, onOpenFolder);
    return () => window.removeEventListener(OPEN_FOLDER_EVENT, onOpenFolder);
  }, [openFolder]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (provider.capabilities.watch) {
      if (provider.root) {
        void provider.watch((events) => {
          emitWorkspaceEvent({ type: 'tree-changed' });
          emitWorkspaceEvent({
            type: 'files-changed',
            paths: events.filter((event) => event.type === 'changed').map((event) => event.path),
          });
        }).catch((err) => console.error('Failed to watch workspace:', err));
      }
    } else {
      interval = setInterval(() => emitWorkspaceEvent({ type: 'tree-changed' }), 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
      void provider.unwatch();
    };
  }, [provider, workspace]);
  return (
    <FsCtx.Provider value={provider}>
      <GitCtx.Provider value={git}>
        <WsCtx.Provider value={{ workspace, openFolder, setSwitchGuard }}>{children}</WsCtx.Provider>
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
