export type FileOperationRequest = 'new-file' | 'new-folder';

type FileOperationListener = (request: FileOperationRequest) => void;

const listeners = new Set<FileOperationListener>();
const pending: FileOperationRequest[] = [];

export function requestFileOperation(request: FileOperationRequest): void {
  if (listeners.size === 0) {
    pending.push(request);
    return;
  }
  for (const listener of listeners) listener(request);
}

export function onFileOperationRequest(listener: FileOperationListener): () => void {
  listeners.add(listener);
  while (pending.length > 0) {
    const request = pending.shift();
    if (request) listener(request);
  }
  return () => listeners.delete(listener);
}
