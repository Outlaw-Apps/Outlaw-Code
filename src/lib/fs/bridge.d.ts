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

export interface TerminalSessionInfo {
  id: string;
  shellName: string;
  cwd: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode?: number;
  signal?: number;
}

export interface OutlawCodeTerminalBridge {
  create(cols: number, rows: number): Promise<TerminalSessionInfo>;
  input(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  onData(sessionId: string, callback: (data: string) => void): () => void;
  onExit(sessionId: string, callback: (event: TerminalExitEvent) => void): () => void;
}

/** The Window.outlawCode augmentation lives in src/vite-env.d.ts. */
