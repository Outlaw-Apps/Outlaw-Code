import type { ReadDirResult, SearchResult, FsEvent } from './types';
import type { GitStatus } from '../git/types';

export interface OutlawCodeFsBridge {
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

export interface OutlawCodeGitBridge {
  available(): Promise<boolean>;
  status(): Promise<GitStatus | null>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  discard(paths: string[]): Promise<void>;
  diff(p: string): Promise<string>;
}

/** The Window.outlawCode augmentation lives in src/vite-env.d.ts. */
