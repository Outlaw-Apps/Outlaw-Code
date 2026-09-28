export type WorkspaceEvent =
  | { type: 'tree-changed' }
  | { type: 'files-changed'; paths: string[] }
  | { type: 'renamed'; oldPath: string; newPath: string }
  | { type: 'deleted'; path: string };

type Handler = (event: WorkspaceEvent) => void;
const handlers = new Set<Handler>();

export function onWorkspaceEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitWorkspaceEvent(event: WorkspaceEvent): void {
  for (const handler of handlers) handler(event);
}
