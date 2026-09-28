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
