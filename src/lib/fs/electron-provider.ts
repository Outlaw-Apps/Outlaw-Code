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
