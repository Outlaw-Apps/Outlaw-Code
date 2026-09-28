/**
 * Sandbox + preview layer.
 *
 * NOTE (stub): The previous implementation relied on Blink's hosted cloud
 * sandboxes (`blink.sandbox.create/connect`, live preview URLs, a remote
 * filesystem). Blink has been removed. This module provides a minimal
 * in-browser stub sandbox so the editor/file-explorer UI keeps working
 * end-to-end without a backend.
 *
 * Wire `createSandbox` / `connectSandbox` / `getPreviewUrl` to your own
 * sandbox/preview backend when ready.
 */

export interface SandboxFile {
  path: string;
  content: string;
}

export interface StubSandbox {
  id: string;
  /** Run a shell-ish command. Only a small subset is implemented for the UI. */
  commands: {
    run: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  /** In-memory virtual filesystem. */
  files: {
    write: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<string>;
    list: () => Promise<string[]>;
    remove: (path: string) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  };
}

const sandboxStore = new Map<string, StubSandbox>();

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `sb_${Date.now().toString(36)}`;
}

export async function createSandbox(): Promise<StubSandbox> {
  const id = newId();
  const files = new Map<string, string>();
  const sandbox: StubSandbox = {
    id,
    commands: {
      async run(cmd: string) {
        const trimmed = cmd.trim();
        // Best-effort: support `cat <path>` (read) and `find ...` / `ls ...` (list).
        // Everything else returns empty stdout so the UI degrades gracefully.
        if (trimmed.startsWith('cat ')) {
          const path = trimmed.slice(4).trim().replace(/^['"]|['"]$/g, '');
          const content = files.get(path) ?? '';
          return { stdout: content, stderr: '', exitCode: content === '' && !files.has(path) ? 1 : 0 };
        }
        if (trimmed.startsWith('find ') || trimmed.startsWith('ls')) {
          const paths = [...files.keys()];
          return { stdout: paths.join('\n'), stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: 'stub sandbox: command not supported', exitCode: 0 };
      },
    },
    files: {
      async write(path: string, content: string) {
        files.set(path, content);
      },
      async read(path: string) {
        return files.get(path) ?? '';
      },
      async list() {
        return [...files.keys()];
      },
      async remove(path: string) {
        files.delete(path);
      },
      async rename(from: string, to: string) {
        const content = files.get(from);
        if (content === undefined) throw new Error(`ENOENT: ${from}`);
        files.delete(from);
        files.set(to, content);
      },
      async exists(path: string) {
        return files.has(path);
      },
    },
  };
  sandboxStore.set(id, sandbox);
  return sandbox;
}

export async function connectSandbox(id: string): Promise<StubSandbox> {
  const existing = sandboxStore.get(id);
  if (existing) return existing;
  // A real backend would reconnect here; for the stub, create fresh.
  return createSandbox();
}

/**
 * Preview URL for a sandbox.
 * Stub: returns about:blank since there is no live preview host without a
 * backend. Replace with your preview-host URL template when wired up.
 */
export function getPreviewUrl(_sandboxId: string, _port = 5173): string {
  return 'about:blank';
}
