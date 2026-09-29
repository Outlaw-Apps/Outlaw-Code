import { lazy, Suspense } from 'react';
import { SandboxTerminal } from './SandboxTerminal';

const NativeTerminal = lazy(async () => {
  const module = await import('./NativeTerminal');
  return { default: module.NativeTerminal };
});

interface TerminalPanelProps {
  sandbox: any | null;
}

export function TerminalPanel({ sandbox }: TerminalPanelProps) {
  if (!window.outlawCode?.terminal) return <SandboxTerminal sandbox={sandbox} />;
  return (
    <Suspense fallback={<div className="h-full bg-[#18181b] p-3 text-xs text-zinc-500">Starting PowerShell...</div>}>
      <NativeTerminal />
    </Suspense>
  );
}
