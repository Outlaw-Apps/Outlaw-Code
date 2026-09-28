/**
 * The single filesystem contract every editor component consumes. Two
 * implementations exist: VirtualFsProvider (browser) and
 * ElectronFsProvider (desktop). Components never branch on mode — they
 * read `capabilities` instead.
 */
import type { StubSandbox } from '../sandbox';

export type FsEntryKind = 'file' | 'dir';

export interface FsEntry {
  name: string;
  path: string;
  kind: FsEntryKind;
}

export interface ReadDirResult {
  entries: FsEntry[];
  capped: boolean;
}

/**
 * fs.watch cannot distinguish "created" from "modified" without snapshot
 * state, and nothing in M1 needs that distinction — so the union is
 * 'changed' | 'deleted' (spec deviation, documented in the plan).
 */
export interface FsEvent {
  type: 'changed' | 'deleted';
  path: string;
}

export interface SearchQuery {
  query: string;
  maxResults?: number;
}

export interface SearchResult {
  path: string;
  line: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'EISDIR' | 'OUTSIDE_ROOT' | 'EPERM' | 'EACCES';

export class FsError extends Error {
  code: FsErrorCode;
  constructor(code: FsErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'FsError';
  }
}

export interface FsCapabilities {
  local: boolean;
  watch: boolean;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  local: boolean;
}

export interface FileSystemProvider {
  readonly capabilities: FsCapabilities;
  readonly root: string | null;

  /** Electron: opens the native folder picker (or uses `preselected`). Returns the root, or null if canceled. Virtual: always null. */
  openFolder(preselected?: string): Promise<string | null>;
  readDir(path: string): Promise<ReadDirResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, kind: FsEntryKind): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  watch(cb: (events: FsEvent[]) => void): Promise<void>;
  unwatch(): Promise<void>;
}

/** The sandbox shape the virtual provider needs (satisfied by StubSandbox). */
export interface VirtualSandbox {
  id: string;
  files: StubSandbox['files'];
}
