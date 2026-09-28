export function sepOf(root: string): '\\' | '/' {
  return root.includes('\\') && !root.includes('/') ? '\\' : '/';
}

export function joinPath(dir: string, ...segments: string[]): string {
  const sep = sepOf(dir);
  const trimmedDir = dir.replace(/[\\/]+$/, '');
  const joined = segments
    .map((segment) => segment.replace(/^[/\\]+/, ''))
    .filter(Boolean)
    .join(sep);
  if (!joined) return trimmedDir || sep;
  return `${trimmedDir}${sep}${joined}`;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized || (path.startsWith('/') || path.startsWith('\\') ? '/' : '');
}

export function isSameOrUnder(path: string, base: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedBase = normalizePath(base);
  if (normalizedPath === normalizedBase) return true;
  if (!normalizedBase) return false;
  if (normalizedBase === '/') return normalizedPath.startsWith('/');
  return normalizedPath.startsWith(`${normalizedBase}/`);
}

export function parentOf(path: string, root: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (index < 0) return root;
  const parent = path.slice(0, index) || (path.startsWith('\\') ? '\\' : '/');
  if (isSameOrUnder(root, parent)) return root;
  return parent;
}

export function relativeTo(root: string, path: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return '';
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}
