const KEY = 'outlaw_recent_folders';
const MAX_RECENT = 10;

export function getRecentFolders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(folder: string): void {
  const next = [folder, ...getRecentFolders().filter((p) => p !== folder)].slice(0, MAX_RECENT);
  localStorage.setItem(KEY, JSON.stringify(next));
}
