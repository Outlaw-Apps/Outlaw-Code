export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored';

export interface GitFileEntry {
  path: string;
  origPath?: string;
  status: GitFileStatus;
  staged: boolean;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
  clean: boolean;
}

export interface GitClient {
  available(): Promise<boolean>;
  status(): Promise<GitStatus | null>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  discard(paths: string[]): Promise<void>;
  diff(path: string): Promise<string>;
  branch(): Promise<string | null>;
}
