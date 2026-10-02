import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TermIcon, Trash2, CornerDownLeft } from 'lucide-react';
import { Button } from './ui/button';
import { onTerminalCommand } from '../lib/terminal-commands';

interface SandboxTerminalProps {
  sandbox: any | null;
}

interface CommandEntry {
  id: string;
  command: string;
  output: string;
  exitCode?: number;
  timestamp: string;
}

export function SandboxTerminal({ sandbox }: SandboxTerminalProps) {
  const [history, setHistory] = useState<CommandEntry[]>([
    {
      id: 'init',
      command: 'echo "Workspace sandbox connected. Ready for commands."',
      output: 'Workspace sandbox connected. Ready for commands.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [currentInput, setCurrentInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, isRunning]);

  const runCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || isRunning) return;

    if (trimmed === 'clear') {
      setHistory([]);
      setCurrentInput('');
      return;
    }

    setIsRunning(true);
    setCurrentInput('');
    setHistoryIndex(null);

    const entryId = crypto.randomUUID();
    const newEntry: CommandEntry = {
      id: entryId,
      command: trimmed,
      output: '',
      timestamp: new Date().toLocaleTimeString(),
    };

    setHistory((prev) => [...prev, newEntry]);

    try {
      if (!sandbox) {
        throw new Error('No sandbox connected');
      }
      const res = await sandbox.commands.run(trimmed);
      setHistory((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, output: (res.stdout || '') + (res.stderr ? `\n${res.stderr}` : ''), exitCode: res.exitCode }
            : e
        )
      );
    } catch (err: any) {
      setHistory((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, output: err?.message || 'Command failed' }
            : e
        )
      );
    } finally {
      setIsRunning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  useEffect(() => onTerminalCommand(({ command }) => {
    void runCommand(command);
  }), [sandbox, isRunning]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      runCommand(currentInput);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const newIdx = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setCurrentInput(history[newIdx]?.command || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === null) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= history.length) {
        setHistoryIndex(null);
        setCurrentInput('');
      } else {
        setHistoryIndex(newIdx);
        setCurrentInput(history[newIdx]?.command || '');
      }
    }
  };

  return (
    <div className="h-full w-full bg-[#18181b] flex flex-col font-mono text-[12px] text-zinc-300">
      {/* Terminal Toolbar */}
      <div className="h-7 px-3 bg-[#202024] border-b border-border/30 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-zinc-400">
          <TermIcon size={12} className="text-[#007acc]" />
          <span>Limited browser sandbox</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-zinc-400 hover:text-zinc-200"
            onClick={() => setHistory([])}
            title="Clear terminal"
          >
            <Trash2 size={11} />
          </Button>
        </div>
      </div>

      {/* Terminal Output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {history.map((entry) => (
          <div key={entry.id} className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <span className="text-[#007acc] font-bold">$</span>
              <span className="text-zinc-200">{entry.command}</span>
              <span className="text-[10px] text-zinc-600 ml-auto">{entry.timestamp}</span>
            </div>
            {entry.output && (
              <pre className="text-zinc-400 whitespace-pre-wrap pl-3 leading-relaxed">
                {entry.output}
              </pre>
            )}
          </div>
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-amber-400 pl-3">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            <span>Running...</span>
          </div>
        )}
      </div>

      {/* Command Input */}
      <div className="h-8 border-t border-border/30 bg-[#1e1e22] px-3 flex items-center gap-2 shrink-0">
        <span className="text-[#007acc] font-bold">$</span>
        <input
          ref={inputRef}
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Limited commands: cat, find, ls..."
          disabled={isRunning}
          className="flex-1 bg-transparent border-none outline-none text-zinc-200 placeholder:text-zinc-600 font-mono text-[12px]"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-zinc-400 hover:text-[#007acc]"
          disabled={isRunning || !currentInput.trim()}
          onClick={() => runCommand(currentInput)}
        >
          <CornerDownLeft size={12} />
        </Button>
      </div>
    </div>
  );
}
