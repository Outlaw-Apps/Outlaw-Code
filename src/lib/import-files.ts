/**
 * Shared helpers for importing local files / folders into a workspace.
 *
 * Used by FileExplorer, EditorLayout empty-state and the App File menu
 * (via `outlaw:import-files` / `outlaw:import-folder` custom events).
 */
import type { FileSystemProvider } from './fs/types';

export const WORKSPACE_ROOT = '/home/user/app';

export const IMPORT_FILES_EVENT = 'outlaw:import-files';
export const IMPORT_FOLDER_EVENT = 'outlaw:import-folder';

export function requestImportFiles() {
  window.dispatchEvent(new CustomEvent(IMPORT_FILES_EVENT));
}

export function requestImportFolder() {
  window.dispatchEvent(new CustomEvent(IMPORT_FOLDER_EVENT));
}

type ImportableFile = File & {
  webkitRelativePath?: string;
};

/** Sanitize a single path segment (prevent `..`, absolute paths, etc). */
function cleanSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._\-+@()[\]{} ]/g, '_').trim() || 'unnamed';
}

/**
 * Resolve the destination sandbox path for a picked file.
 * - Folder picks provide `webkitRelativePath` like `my-folder/src/App.tsx`
 *   -> `/home/user/app/my-folder/src/App.tsx`
 * - Plain file picks only have `name` -> `/home/user/app/<name>`
 */
function toRelativeWorkspacePath(file: ImportableFile): string {
  const rel = (file.webkitRelativePath || file.name || 'unnamed').replace(/\\/g, '/');
  const parts = rel.split('/').filter((p) => p && p !== '.' && p !== '..');
  const cleaned = parts.map(cleanSegment);
  return cleaned.join('/');
}

export function toWorkspacePath(file: ImportableFile, root = WORKSPACE_ROOT): string {
  return `${root.replace(/[\\/]+$/, '')}/${toRelativeWorkspacePath(file)}`;
}

/** Directories + binaries we skip on import to keep the workspace sane. */
const SKIPPED_DIRS = ['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per file
const MAX_TOTAL_FILES = 1000;

export interface ImportResult {
  imported: string[];
  skipped: { name: string; reason: string }[];
}

function shouldSkip(path: string, size: number): string | null {
  const lower = path.toLowerCase();
  if (SKIPPED_DIRS.some((d) => lower.includes(`/${d}/`) || lower.endsWith(`/${d}`))) {
    return 'system directory (node_modules/.git/dist/...)';
  }
  if (size > MAX_FILE_BYTES) return `exceeds ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB limit`;
  // Skip obviously binary extensions we can't edit as text in Monaco stub
  if (/\.(exe|dll|so|dylib|zip|tar|gz|rar|7z|mp4|mov|avi|mkv|mp3|wav|ogg|png|jpe?g|gif|webp|ico|bmp|pdf|woff2?|ttf|otf|eot)$/i.test(path)) {
    return 'binary file type';
  }
  return null;
}

/**
 * Write a FileList (from <input> or drag-drop DataTransfer) into the workspace.
 * Returns imported paths so callers can refresh + auto-open the first file.
 */
export async function importFileList(
  provider: FileSystemProvider,
  list: FileList | File[] | null | undefined,
): Promise<ImportResult> {
  const result: ImportResult = { imported: [], skipped: [] };
  if (!provider || !list) return result;
  const root = provider.root ?? WORKSPACE_ROOT;

  const files = Array.from(list).slice(0, MAX_TOTAL_FILES);

  for (const raw of files as ImportableFile[]) {
    const rel = toRelativeWorkspacePath(raw);
    const skipReason = shouldSkip(`/${rel}`, raw.size);
    if (skipReason) {
      result.skipped.push({ name: raw.webkitRelativePath || raw.name, reason: skipReason });
      continue;
    }
    const dest = `${root.replace(/[\\/]+$/, '')}/${rel}`;
    try {
      const text = await raw.text();
      await provider.writeFile(dest, text);
      result.imported.push(dest);
    } catch (err) {
      result.skipped.push({
        name: raw.webkitRelativePath || raw.name,
        reason: err instanceof Error ? err.message : 'unreadable file',
      });
    }
  }

  return result;
}
