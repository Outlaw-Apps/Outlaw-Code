import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, Square, Terminal as TerminalIcon } from 'lucide-react';
import { Button } from './ui/button';
import type { TerminalSessionInfo } from '../lib/fs/bridge';

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

export function NativeTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [error, setError] = useState<string | null>(null);

  const restart = useCallback(() => setGeneration((value) => value + 1), []);

  const terminate = useCallback(() => {
    const bridge = window.outlawCode?.terminal;
    const sessionId = sessionRef.current;
    if (!bridge || !sessionId) return;
    void bridge.dispose(sessionId).then(() => {
      if (sessionRef.current !== sessionId) return;
      sessionRef.current = null;
      setSession(null);
      setStatus('exited');
      terminalRef.current?.writeln('\r\n\x1b[90m[PowerShell terminated]\x1b[0m');
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not terminate PowerShell.');
      setStatus('error');
    });
  }, []);

  useEffect(() => {
    const bridge = window.outlawCode?.terminal;
    const container = containerRef.current;
    if (!bridge || !container) return undefined;

    let cancelled = false;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;
    let createdSessionId: string | null = null;

    setSession(null);
    setStatus('starting');
    setError(null);

    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "'Geist Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: '#18181b',
        foreground: '#d4d4d8',
        cursor: '#22d3ee',
        selectionBackground: '#0e7490aa',
        black: '#18181b',
        brightBlack: '#71717a',
        blue: '#38bdf8',
        brightBlue: '#7dd3fc',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        green: '#4ade80',
        brightGreen: '#86efac',
        magenta: '#e879f9',
        brightMagenta: '#f0abfc',
        red: '#f87171',
        brightRed: '#fca5a5',
        white: '#e4e4e7',
        brightWhite: '#fafafa',
        yellow: '#facc15',
        brightYellow: '#fde047',
      },
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const fit = () => {
      if (cancelled || container.clientWidth === 0 || container.clientHeight === 0) return;
      fitAddon.fit();
      const sessionId = sessionRef.current;
      if (sessionId && terminal.cols > 0 && terminal.rows > 0) {
        void bridge.resize(sessionId, terminal.cols, terminal.rows).catch(() => undefined);
      }
    };

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    requestAnimationFrame(fit);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      void bridge.input(sessionId, data).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'PowerShell input failed.');
        setStatus('error');
      });
    });

    void (async () => {
      try {
        fitAddon.fit();
        const info = await bridge.create(
          Math.max(1, terminal.cols || 80),
          Math.max(1, terminal.rows || 24),
        );
        if (cancelled) {
          await bridge.dispose(info.id).catch(() => undefined);
          return;
        }
        createdSessionId = info.id;
        sessionRef.current = info.id;
        setSession(info);
        setStatus('running');
        removeData = bridge.onData(info.id, (data) => terminal.write(data));
        removeExit = bridge.onExit(info.id, (event) => {
          sessionRef.current = null;
          setSession(null);
          setStatus('exited');
          terminal.writeln(`\r\n\x1b[90m[PowerShell exited with code ${event.exitCode ?? 'unknown'}]\x1b[0m`);
        });
        fit();
        terminal.focus();
      } catch (reason) {
        if (cancelled) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'PowerShell could not be started.');
        terminal.writeln('\r\n\x1b[31mPowerShell could not be started.\x1b[0m');
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeData?.();
      removeExit?.();
      const sessionId = createdSessionId || sessionRef.current;
      if (sessionId) void bridge.dispose(sessionId).catch(() => undefined);
      if (sessionRef.current === sessionId) sessionRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      terminal.dispose();
    };
  }, [generation]);

  return (
    <div className="h-full w-full bg-[#18181b] flex flex-col text-zinc-300">
      <div className="h-7 px-3 bg-[#202024] border-b border-border/30 flex items-center justify-between text-[11px] shrink-0">
        <div className="flex items-center gap-2 text-zinc-400 min-w-0">
          <TerminalIcon size={12} className="text-[#22d3ee] shrink-0" />
          <span className="truncate">{session?.shellName ?? 'PowerShell'}</span>
          <span className="text-zinc-600">{status}</span>
          {error && <span className="text-red-400 truncate" title={error}>{error}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-zinc-400 hover:text-zinc-200"
            onClick={restart}
            title="Restart PowerShell"
          >
            <RefreshCw size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-zinc-400 hover:text-red-400"
            onClick={terminate}
            disabled={!sessionRef.current}
            title="Terminate PowerShell"
          >
            <Square size={10} />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="outlaw-native-terminal flex-1 min-h-0 p-2" />
    </div>
  );
}
