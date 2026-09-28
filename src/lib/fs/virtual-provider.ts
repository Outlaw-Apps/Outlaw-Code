import { FsError } from './types';
import type { FileSystemProvider, FsEntry, ReadDirResult, FsCapabilities, SearchQuery, SearchResult, VirtualSandbox } from './types';
import { WORKSPACE_ROOT } from '../import-files';

const MAX_ENTRIES = 2000;
const MAX_SEARCH_RESULTS = 200;

export class VirtualFsProvider implements FileSystemProvider {
  readonly capabilities: FsCapabilities = { local: false, watch: false };
  readonly root = WORKSPACE_ROOT;

  constructor(private sandbox: VirtualSandbox) {}

  async openFolder(): Promise<string | null> {
    return null;
  }

  async readDir(dirPath: string): Promise<ReadDirResult> {
    const dir = dirPath.replace(/\/+$/, '');
    const prefix = dir ? `${dir}/` : '';
    const all = await this.sandbox.files.list();
    const dirs = new Set<string>();
    const names = new Set<string>();
    for (const p of all) {
      if (prefix && !p.startsWith(prefix)) continue;
      const rest = prefix ? p.slice(prefix.length) : p;
      if (!rest) continue;
      const first = rest.split('/')[0];
      names.add(first);
      if (rest.includes('/')) dirs.add(first);
    }
    const entries: FsEntry[] = [...names]
      .slice(0, MAX_ENTRIES)
      .map((name) => ({ name, path: prefix + name, kind: dirs.has(name) ? 'dir' : 'file' }));
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    return { entries, capped: names.size > MAX_ENTRIES };
  }

  async readFile(path: string): Promise<string> {
    if (!(await this.sandbox.files.exists(path))) {
      throw new FsError('ENOENT', `File not found: ${path}`);
    }
    return this.sandbox.files.read(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async createEntry(path: string, kind: 'file' | 'dir'): Promise<void> {
    if (kind === 'file' && !(await this.sandbox.files.exists(path))) {
      await this.sandbox.files.write(path, '');
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.sandbox.files.rename(oldPath, newPath);
  }

  async delete(path: string): Promise<void> {
    const all = await this.sandbox.files.list();
    for (const p of all) {
      if (p === path || p.startsWith(`${path}/`)) await this.sandbox.files.remove(p);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const needle = query.query.toLowerCase();
    if (!needle) return [];
    const maxResults = query.maxResults ?? MAX_SEARCH_RESULTS;
    const results: SearchResult[] = [];
    const all = await this.sandbox.files.list();
    for (const p of all) {
      if (results.length >= maxResults) break;
      const content = await this.sandbox.files.read(p);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle);
        if (idx !== -1) {
          results.push({ path: p, line: i + 1, lineText: lines[i].slice(0, 300), matchStart: idx, matchEnd: idx + needle.length });
        }
      }
    }
    return results;
  }

  async watch(): Promise<void> {
    /* no external changes exist in virtual mode; the UI polls */
  }

  async unwatch(): Promise<void> {
    /* nothing to clean up */
  }
}
