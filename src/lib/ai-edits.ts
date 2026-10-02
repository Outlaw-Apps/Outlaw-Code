export interface WorkspaceEditBlock {
  path: string;
  content: string;
}

const EDIT_FENCE_RE = /```(?:outlaw-edit|workspace-edit)\s+path=(?:"([^"]+)"|'([^']+)'|([^\s`]+))\s*\n([\s\S]*?)```/gi;

export function extractWorkspaceEdits(text: string): WorkspaceEditBlock[] {
  const edits: WorkspaceEditBlock[] = [];
  for (const match of text.matchAll(EDIT_FENCE_RE)) {
    const path = (match[1] || match[2] || match[3] || '').trim();
    if (!path) continue;
    edits.push({
      path,
      content: stripOneTrailingNewline(match[4] ?? ''),
    });
  }
  return edits;
}

function stripOneTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}
