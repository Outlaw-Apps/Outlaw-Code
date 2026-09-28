import type { GitClient } from './types';

/** Virtual/browser mode: reports unavailable, degrades all UI gracefully. */
export class NullGitClient implements GitClient {
  async available(): Promise<boolean> {
    return false;
  }

  async status(): Promise<null> {
    return null;
  }

  async stage(): Promise<void> {}
  async unstage(): Promise<void> {}
  async commit(): Promise<void> {}
  async discard(): Promise<void> {}

  async diff(): Promise<string> {
    return '';
  }

  async branch(): Promise<null> {
    return null;
  }
}
