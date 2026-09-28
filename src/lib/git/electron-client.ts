import type { GitClient, GitStatus } from './types';

export class ElectronGitClient implements GitClient {
  async available(): Promise<boolean> {
    return window.outlawCode?.git?.available() ?? false;
  }

  async status(): Promise<GitStatus | null> {
    return window.outlawCode?.git?.status() ?? null;
  }

  async stage(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.stage(paths);
  }

  async unstage(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.unstage(paths);
  }

  async commit(message: string): Promise<void> {
    await window.outlawCode?.git?.commit(message);
  }

  async discard(paths: string[]): Promise<void> {
    await window.outlawCode?.git?.discard(paths);
  }

  async diff(path: string): Promise<string> {
    return window.outlawCode?.git?.diff(path) ?? '';
  }

  async branch(): Promise<string | null> {
    const status = await this.status();
    return status ? status.branch : null;
  }
}
