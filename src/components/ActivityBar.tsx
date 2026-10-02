import React from 'react';
import { Files, Search, GitBranch, Sparkles, Settings, Package } from 'lucide-react';
import { cn } from '../lib/utils';

export type ActivityView = 'explorer' | 'search' | 'git' | 'tools';

interface ActivityBarProps {
  activeView: ActivityView;
  onSelectView: (view: ActivityView) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  aiPanelOpen: boolean;
  onToggleAIPanel: () => void;
  onOpenSettings: () => void;
}

export function ActivityBar({
  activeView,
  onSelectView,
  sidebarOpen,
  onToggleSidebar,
  aiPanelOpen,
  onToggleAIPanel,
  onOpenSettings,
}: ActivityBarProps) {
  const handleItemClick = (view: ActivityView) => {
    if (activeView === view && sidebarOpen) {
      onToggleSidebar();
    } else {
      onSelectView(view);
      if (!sidebarOpen) onToggleSidebar();
    }
  };

  return (
    <div className="w-12 bg-[#18181b] border-r border-border/40 flex flex-col items-center py-2 shrink-0 select-none z-10">
      {/* Top Activity Icons */}
      <div className="flex flex-col items-center gap-1 w-full">
        <button
          onClick={() => handleItemClick('explorer')}
          title="Explorer (Ctrl+Shift+E)"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
            sidebarOpen && activeView === 'explorer'
              ? "text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#007acc]"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          )}
        >
          <Files size={18} />
        </button>

        <button
          onClick={() => handleItemClick('search')}
          title="Search (Ctrl+Shift+F)"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
            sidebarOpen && activeView === 'search'
              ? "text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#007acc]"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          )}
        >
          <Search size={18} />
        </button>

        <button
          onClick={() => handleItemClick('git')}
          title="Source Control (Ctrl+Shift+G)"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
            sidebarOpen && activeView === 'git'
              ? "text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#007acc]"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          )}
        >
          <GitBranch size={18} />
        </button>

        <button
          onClick={() => handleItemClick('tools')}
          title="Tools (Ctrl+Shift+T)"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
            sidebarOpen && activeView === 'tools'
              ? "text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#007acc]"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          )}
        >
          <Package size={18} />
        </button>
      </div>

      {/* Bottom Activity Icons */}
      <div className="mt-auto flex flex-col items-center gap-1 w-full">
        <button
          onClick={onToggleAIPanel}
          title="Toggle AI Assistant (Ctrl+L)"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors",
            aiPanelOpen ? "text-[#007acc] bg-[#007acc]/10" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          )}
        >
          <Sparkles size={18} />
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings"
          className="w-10 h-10 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
