import React, { useState } from 'react';
import { Terminal as TermIcon, FileText, Globe, RefreshCw, ExternalLink, X } from 'lucide-react';
import { TerminalPanel } from './TerminalPanel';
import { getPreviewUrl } from '../lib/sandbox';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export type BottomTab = 'terminal' | 'output' | 'preview';

interface BottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  height: number;
  sandbox: any | null;
  buildLogs?: string[];
  activeTab?: BottomTab;
  onSelectTab?: (tab: BottomTab) => void;
}

export function BottomPanel({
  isOpen,
  onToggle,
  height,
  sandbox,
  buildLogs = [],
  activeTab = 'terminal',
  onSelectTab,
}: BottomPanelProps) {
  const [internalTab, setInternalTab] = useState<BottomTab>(activeTab);
  const [previewKey, setPreviewKey] = useState(0);

  const currentTab = onSelectTab ? activeTab : internalTab;
  const setTab = onSelectTab || setInternalTab;

  if (!isOpen) return null;

  const previewUrl = sandbox?.id ? getPreviewUrl(sandbox.id) : null;

  return (
    <div
      style={{ height }}
      className="w-full bg-[#18181b] border-t border-border/50 flex flex-col shrink-0 select-none font-sans"
    >
      {/* Bottom Panel Tab Header */}
      <div className="h-8 bg-[#202024] border-b border-border/30 px-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('terminal')}
            className={cn(
              "h-6 px-2.5 rounded text-[11px] flex items-center gap-1.5 transition-colors",
              currentTab === 'terminal'
                ? "bg-[#18181b] text-white font-medium border-t border-t-[#007acc]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <TermIcon size={12} />
            Terminal
          </button>

          <button
            onClick={() => setTab('output')}
            className={cn(
              "h-6 px-2.5 rounded text-[11px] flex items-center gap-1.5 transition-colors",
              currentTab === 'output'
                ? "bg-[#18181b] text-white font-medium border-t border-t-[#007acc]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText size={12} />
            Output
          </button>

          <button
            onClick={() => setTab('preview')}
            className={cn(
              "h-6 px-2.5 rounded text-[11px] flex items-center gap-1.5 transition-colors",
              currentTab === 'preview'
                ? "bg-[#18181b] text-white font-medium border-t border-t-[#007acc]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Globe size={12} />
            Preview
          </button>
        </div>

        <div className="flex items-center gap-1">
          {currentTab === 'preview' && previewUrl && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => setPreviewKey((k) => k + 1)}
                title="Refresh preview"
              >
                <RefreshCw size={11} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => window.open(previewUrl, '_blank')}
                title="Open preview in new tab"
              >
                <ExternalLink size={11} />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
            title="Close panel"
          >
            <X size={12} />
          </Button>
        </div>
      </div>

      {/* Bottom Panel Content */}
      <div className="flex-1 overflow-hidden relative">
        <div className={cn("h-full w-full", currentTab === 'terminal' ? "block" : "hidden")}>
          <TerminalPanel sandbox={sandbox} />
        </div>

        {currentTab === 'output' && (
          <div className="h-full w-full bg-[#18181b] p-3 overflow-y-auto font-mono text-[11px] text-zinc-300">
            {buildLogs.length > 0 ? (
              buildLogs.map((log, i) => <div key={i}>{log}</div>)
            ) : (
              <div className="text-zinc-600">No output logs recorded.</div>
            )}
          </div>
        )}

        {currentTab === 'preview' && (
          <div className="h-full w-full bg-black relative">
            {previewUrl ? (
              <iframe
                key={previewKey}
                src={previewUrl}
                className="w-full h-full border-none"
                title="Application Live Preview"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                Connecting to preview sandbox...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
