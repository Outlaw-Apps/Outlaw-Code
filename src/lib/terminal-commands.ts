export interface TerminalCommandRequest {
  command: string;
}

type TerminalCommandListener = (request: TerminalCommandRequest) => void;

const listeners = new Set<TerminalCommandListener>();
const pending: TerminalCommandRequest[] = [];

export function sendTerminalCommand(command: string): void {
  const request = { command };
  if (listeners.size === 0) {
    pending.push(request);
    return;
  }
  for (const listener of listeners) listener(request);
}

export function onTerminalCommand(listener: TerminalCommandListener): () => void {
  listeners.add(listener);
  while (pending.length > 0) {
    const request = pending.shift();
    if (request) listener(request);
  }
  return () => listeners.delete(listener);
}
