import type { FileSystemProvider, FsEntry } from './fs/types';
import { isSameOrUnder, joinPath, relativeTo } from './fs/paths';

const SKIPPED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.wrangler',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'release',
]);

const IMPORTANT_FILES = [
  'package.json',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
  'README.md',
  'src/App.tsx',
  'src/main.tsx',
];

const MAX_TREE_ENTRIES = 350;
const MAX_FILE_CHARS = 7000;
const MAX_IMPORTANT_FILES = 5;

export interface WorkspaceContextOptions {
  activeFile?: string | null;
  activeFileContent?: string | null;
}

interface TreeSnapshot {
  lines: string[];
  capped: boolean;
}

export async function buildWorkspaceAiContext(
  provider: FileSystemProvider,
  options: WorkspaceContextOptions = {},
): Promise<string | null> {
  if (!provider.root) return null;

  const snapshot = await collectTree(provider, provider.root);
  const sections = [
    `[Workspace]\nRoot: ${provider.root}\nMode: ${provider.capabilities.local ? 'local desktop folder' : 'browser virtual workspace'}`,
  ];

  if (snapshot.lines.length > 0) {
    sections.push([
      `Folder tree${snapshot.capped ? ` (first ${MAX_TREE_ENTRIES} entries)` : ''}:`,
      ...snapshot.lines,
    ].join('\n'));
  }

  if (options.activeFile) {
    const rel = relativeTo(provider.root, options.activeFile);
    const content = options.activeFileContent ?? await readMaybe(provider, options.activeFile);
    if (content !== null) {
      sections.push(formatFileSection(`Active file: ${rel || options.activeFile}`, content));
    }
  }

  const importantFiles = await readImportantFiles(provider, options.activeFile ?? null);
  if (importantFiles.length > 0) {
    sections.push(importantFiles.map((file) => formatFileSection(file.label, file.content)).join('\n\n'));
  }

  sections.push([
    'Workspace edit format:',
    'When changing files, return one or more fenced blocks exactly like:',
    '```outlaw-edit path="relative/path.ext"',
    '<complete file contents>',
    '```',
    'Each block replaces that file when the user clicks Apply Workspace Edits.',
  ].join('\n'));

  return sections.join('\n\n');
}

async function collectTree(provider: FileSystemProvider, root: string): Promise<TreeSnapshot> {
  const lines: string[] = [];
  let capped = false;

  async function visit(dir: string, depth: number): Promise<void> {
    if (lines.length >= MAX_TREE_ENTRIES) {
      capped = true;
      return;
    }

    let entries: FsEntry[];
    try {
      const result = await provider.readDir(dir);
      entries = result.entries;
      capped = capped || result.capped;
    } catch {
      return;
    }

    for (const entry of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        capped = true;
        return;
      }
      if (entry.kind === 'dir' && SKIPPED_DIRS.has(entry.name)) continue;
      const rel = relativeTo(root, entry.path);
      lines.push(`${'  '.repeat(depth)}- ${rel}${entry.kind === 'dir' ? '/' : ''}`);
      if (entry.kind === 'dir' && depth < 4) await visit(entry.path, depth + 1);
    }
  }

  await visit(root, 0);
  return { lines, capped };
}

async function readImportantFiles(provider: FileSystemProvider, activeFile: string | null): Promise<{ label: string; content: string }[]> {
  if (!provider.root) return [];
  const files: { label: string; content: string }[] = [];
  for (const rel of IMPORTANT_FILES) {
    if (files.length >= MAX_IMPORTANT_FILES) break;
    const path = joinPath(provider.root, rel);
    if (activeFile && isSameOrUnder(path, activeFile)) continue;
    const content = await readMaybe(provider, path);
    if (content !== null) files.push({ label: rel, content });
  }
  return files;
}

async function readMaybe(provider: FileSystemProvider, path: string): Promise<string | null> {
  try {
    return await provider.readFile(path);
  } catch {
    return null;
  }
}

function formatFileSection(label: string, content: string): string {
  const clipped = content.length > MAX_FILE_CHARS
    ? `${content.slice(0, MAX_FILE_CHARS)}\n[File clipped at ${MAX_FILE_CHARS} characters]`
    : content;
  return `--- ${label} ---\n${clipped}`;
}
