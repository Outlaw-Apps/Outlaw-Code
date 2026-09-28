import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Clock, Code, Box, ChevronRight, Terminal, FolderOpen } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export interface Project {
  id: string;
  name: string;
  prompt: string;
  sandboxId: string;
  createdAt: string;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (project: Project) => void;
  currentSandboxId?: string;
  userName: string | null;
  recentFolders?: string[];
  onOpenFolder?: (folder: string) => void;
}

export function HistoryModal({ isOpen, onClose, onSelectProject, currentSandboxId, userName, recentFolders, onOpenFolder }: HistoryModalProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadProjects();
    }
  }, [isOpen]);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      if (!userName) return;

      // Load from local storage. (Blink DB was removed; wire a backend here when needed.)
      const storedProjectsRaw = localStorage.getItem('cursor_projects');
      let localProjects: Project[] = [];
      if (storedProjectsRaw) {
        try {
          const parsed = JSON.parse(storedProjectsRaw);
          localProjects = parsed.filter((p: any) => p.userId === userName);
        } catch (e) {
          console.error('Failed to parse local projects:', e);
        }
      }

      const merged = localProjects.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setProjects(merged);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] bg-[#0d0d0d] border-[#2d2d2d] text-foreground p-0 gap-0 overflow-hidden shadow-2xl">
        <DialogHeader className="p-6 border-b border-[#2d2d2d] bg-[#0a0a0a]">
          <DialogTitle className="flex items-center gap-2">
            <Terminal size={18} />
            Project History
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Select a project to switch sandboxes. Previous sessions may be expired.
          </p>
        </DialogHeader>
        
        <ScrollArea className="h-[500px] bg-[#0d0d0d]">
          <div className="p-6">
            {recentFolders && recentFolders.length > 0 && (
              <div className="space-y-2 mb-6">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent folders
                </div>
                {recentFolders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => onOpenFolder?.(folder)}
                    className="w-full text-left group p-3 rounded-xl border border-[#2d2d2d] bg-[#141414] hover:bg-[#1a1a1a] hover:border-[#3d3d3d] transition-all duration-200 flex items-center gap-2"
                  >
                    <FolderOpen size={14} className="text-muted-foreground group-hover:text-primary shrink-0" />
                    <span className="text-sm text-foreground truncate">{folder.split(/[\/]/).pop()}</span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono truncate">{folder}</span>
                    <span className="ml-auto text-[11px] text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      Open <ChevronRight size={12} className="inline" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent"></div>
                <span className="text-xs">Loading projects...</span>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center text-muted-foreground py-20 flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                  <Code size={20} className="opacity-50" />
                </div>
                <p>No projects found yet.</p>
                <p className="text-xs opacity-60">Start building to see your history here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className={`w-full text-left group p-4 rounded-xl border transition-all duration-200 hover:shadow-lg relative overflow-hidden ${
                      currentSandboxId === project.sandboxId 
                        ? 'border-primary/50 bg-[#1a1a1a] shadow-inner' 
                        : 'border-[#2d2d2d] bg-[#141414] hover:bg-[#1a1a1a] hover:border-[#3d3d3d]'
                    }`}
                  >
                    {/* Active Indicator */}
                    {currentSandboxId === project.sandboxId && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                    )}

                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${
                          currentSandboxId === project.sandboxId ? 'bg-primary/20 text-primary' : 'bg-[#252525] text-muted-foreground group-hover:text-foreground'
                        }`}>
                          <Code size={14} />
                        </div>
                        <h3 className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                          {project.name || 'Untitled Project'}
                        </h3>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1.5 bg-[#0a0a0a] px-2 py-1 rounded border border-[#2d2d2d]">
                          <Box size={10} />
                          {project.sandboxId}
                        </span>
                        {currentSandboxId === project.sandboxId && (
                          <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <p className="text-[13px] text-muted-foreground/80 line-clamp-2 mb-3 pl-9 pr-4 font-normal leading-relaxed">
                      "{project.prompt}"
                    </p>
                    
                    <div className="flex items-center justify-between pl-9 mt-4 pt-3 border-t border-[#2d2d2d]/50">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                        <Clock size={10} />
                        {(() => {
                          try {
                            const date = new Date(project.createdAt);
                            if (isNaN(date.getTime())) return 'Unknown date';
                            return formatDistanceToNow(date, { addSuffix: true });
                          } catch (e) {
                            return 'Unknown date';
                          }
                        })()}
                      </div>
                      
                      <div className="flex items-center gap-1 text-[11px] text-primary opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-200">
                        Open Project <ChevronRight size={12} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
