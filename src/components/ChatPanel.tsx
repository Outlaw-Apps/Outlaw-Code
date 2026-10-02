import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import {
  Send, Bot, Wrench, Loader2, ChevronRight, ChevronDown,
  Eye, RefreshCw, ExternalLink, Infinity as InfinityIcon, Check,
  FolderOpen, Globe, Maximize2, AtSign, Image as ImageIcon, MessageSquareText,
  Rocket, Palette, Briefcase, PenTool, Video, Ticket, Settings as SettingsIcon,
  FileCode, Copy, CheckCheck,
} from 'lucide-react';
import { getPreviewUrl } from '../lib/sandbox';
import { cn } from '../lib/utils';
import gsap from 'gsap';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
import { SettingsModal } from './SettingsModal';
import {
  streamChatCompletion,
  newMessageId,
  CODING_AGENT_SYSTEM_PROMPT,
  ASK_AGENT_SYSTEM_PROMPT,
  type ChatMessage,
} from '../lib/agent';
import { AI_MODELS, resolveModel } from '../lib/models';
import { loadSettings, saveModel, isConfigured } from '../lib/settings';
import { useFs } from '../lib/fs/context';
import { joinPath, isSameOrUnder } from '../lib/fs/paths';
import { emitWorkspaceEvent } from '../lib/workspace-events';
import { extractWorkspaceEdits, type WorkspaceEditBlock } from '../lib/ai-edits';
import { buildWorkspaceAiContext } from '../lib/workspace-ai-context';

interface ChatPanelProps {
  sandbox: any | null;
  isEmbedded?: boolean;
  initialPrompt?: string | null;
  onBuildStatusChange?: (isBuilding: boolean) => void;
  activeFile?: string | null;
  activeFileContent?: string | null;
  selectedCode?: string | null;
  onApplyCode?: (code: string) => void;
  onFileWritten?: (path: string, content: string) => void | Promise<void>;
}

const AGENT_MODES = [
  { id: 'agent', name: 'Agent', icon: InfinityIcon },
  { id: 'ask', name: 'Ask', icon: MessageSquareText },
];

const SUGGESTED_PROMPTS = [
  {
    title: "Explain Architecture",
    prompt: "Can you analyze this project structure and explain the key components, data flow, and architecture?",
    icon: Bot,
  },
  {
    title: "Find Bugs & Issues",
    prompt: "Review the active file for potential edge-case bugs, performance bottlenecks, or typing errors.",
    icon: Wrench,
  },
  {
    title: "Write Unit Tests",
    prompt: "Write comprehensive unit tests for the functions or components in the active file.",
    icon: Check,
  },
  {
    title: "Refactor Component",
    prompt: "Refactor this code to follow clean code standards, improve readability, and strengthen TypeScript types.",
    icon: Rocket,
  },
];

export function ChatPanel({
  sandbox,
  isEmbedded = false,
  initialPrompt = null,
  onBuildStatusChange,
  activeFile = null,
  activeFileContent = null,
  selectedCode = null,
  onApplyCode,
  onFileWritten,
}: ChatPanelProps) {
  const provider = useFs();
  const sandboxId = sandbox?.id || null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [trustDelayPassed, setTrustDelayPassed] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => resolveModel(loadSettings().model));
  const [agentMode, setAgentMode] = useState(AGENT_MODES[0]);
  const [includeWorkspaceContext, setIncludeWorkspaceContext] = useState(true);
  const [applyingEditMessageId, setApplyingEditMessageId] = useState<string | null>(null);
  const [appliedEditMessageIds, setAppliedEditMessageIds] = useState<Set<string>>(new Set());
  const chooseModel = (model: typeof AI_MODELS[number]) => {
    setSelectedModel(model);
    saveModel(model.id);
  };
  const syncModelFromSettings = () => setSelectedModel(resolveModel(loadSettings().model));

  const abortRef = useRef<AbortController | null>(null);

  // Load chat history from localStorage if available
  useEffect(() => {
    if (!sandboxId) { setMessages([]); return; }
    try {
      const saved = localStorage.getItem(`chat_history_${sandboxId}`);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch (e) {
      console.error('Failed to load chat history:', e);
      setMessages([]);
    }
  }, [sandboxId]);

  // Save chat history to localStorage
  useEffect(() => {
    if (messages.length > 0 && sandboxId) {
      localStorage.setItem(`chat_history_${sandboxId}`, JSON.stringify(messages));
    }
  }, [messages, sandboxId]);

  useEffect(() => {
    setError(null);
  }, [sandboxId]);

  // Notify parent about build status
  useEffect(() => {
    if (onBuildStatusChange) {
      const isBuildingAgent = agentMode.id !== 'ask';
      onBuildStatusChange(isBuildingAgent && isLoading);
    }
  }, [isLoading, onBuildStatusChange, agentMode.id]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialFormRef = useRef<HTMLDivElement>(null);
  const prevHasMessages = useRef(false);
  const initialPromptProcessed = useRef(false);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (sandboxId) {
      initialPromptProcessed.current = false;
    }
  }, [sandboxId]);

  const sendMessage = useCallback(async (prompt: string) => {
    const settings = loadSettings();
    if (!isConfigured(settings)) {
      setError('No API key configured. Open Settings to add your OpenAI-compatible API key, base URL, and model.');
      setShowSettings(true);
      return;
    }

    const userMsg: ChatMessage = { id: newMessageId(), role: 'user', content: prompt };
    const assistantMsg: ChatMessage = { id: newMessageId(), role: 'assistant', content: '' };
    // Capture history at call time (before we append the new user message).
    const history = messages;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setError(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const contextParts: string[] = [];
    if (agentMode.id === 'agent' && includeWorkspaceContext) {
      const workspaceContext = await buildWorkspaceAiContext(provider, {
        activeFile,
        activeFileContent,
      }).catch((reason) => {
        console.warn('Could not build workspace AI context:', reason);
        return null;
      });
      if (workspaceContext) contextParts.push(workspaceContext);
    } else if (activeFile) {
      contextParts.push([
        `[Context: Active File: ${activeFile}]`,
        selectedCode ? `Selected Code:\n${selectedCode}` : activeFileContent ? `Active File Content:\n${activeFileContent.slice(0, 7000)}` : '',
      ].filter(Boolean).join('\n'));
    }
    if (selectedCode && !contextParts.some((part) => part.includes('Selected Code:'))) {
      contextParts.push(`[Selected Code from ${activeFile ?? 'active file'}]\n${selectedCode}`);
    }
    const contextualPrompt = contextParts.length > 0
      ? `${contextParts.join('\n\n')}\n\n[User request]\n${prompt}`
      : prompt;

    try {
      await streamChatCompletion({
        messages: history,
        prompt: contextualPrompt,
        systemPrompt: agentMode.id === 'ask' ? ASK_AGENT_SYSTEM_PROMPT : CODING_AGENT_SYSTEM_PROMPT,
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        },
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // user cancelled; leave partial content in place
      } else {
        console.error('Agent error:', err);
        setError(err?.message || 'Failed to send message');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages, agentMode.id, includeWorkspaceContext, provider, activeFile, activeFileContent, selectedCode]);

  // Handle initial prompt
  useEffect(() => {
    if (initialPrompt && sandboxId && !initialPromptProcessed.current) {
      initialPromptProcessed.current = true;
      sendMessage(initialPrompt);
    }
  }, [initialPrompt, sandboxId, sendMessage]);

  // Initial entrance animation for the centered form
  useEffect(() => {
    if (!hasMessages && initialFormRef.current) {
      gsap.fromTo(initialFormRef.current,
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' },
      );
    }
  }, []);

  // GSAP Animation for sidebar transition
  useLayoutEffect(() => {
    if (hasMessages && !prevHasMessages.current && sidebarRef.current && previewRef.current) {
      prevHasMessages.current = true;
      gsap.set(sidebarRef.current, { x: -320, opacity: 0 });
      gsap.set(previewRef.current, { opacity: 0, scale: 0.95, x: 50 });

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => setHasAnimated(true),
      });
      tl.to(sidebarRef.current, { x: 0, opacity: 1, duration: 0.7, ease: 'power4.out' });
      tl.to(previewRef.current, { opacity: 1, scale: 1, x: 0, duration: 0.6, ease: 'power3.out' }, '-=0.5');

      const chatMessages = sidebarRef.current.querySelectorAll('[data-chat-message]');
      if (chatMessages.length > 0) {
        tl.fromTo(chatMessages,
          { y: 15, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'power2.out' },
          '-=0.35',
        );
      }
      const previewHeader = previewRef.current.querySelector('[data-preview-header]');
      if (previewHeader) {
        tl.fromTo(previewHeader,
          { y: -10, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' },
          '-=0.3',
        );
      }
    }
  }, [hasMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Preview trust delay
  useEffect(() => {
    if (isLoading) {
      setTrustDelayPassed(false);
    } else {
      const timer = setTimeout(() => setTrustDelayPassed(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  const onFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandbox || !input.trim() || isLoading) return;
    await sendMessage(input);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const toggleToolExpand = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId); else next.add(toolId);
      return next;
    });
  };

  const refreshPreview = () => setPreviewKey((prev) => prev + 1);

  const openInNewTab = () => {
    if (sandboxId) {
      window.open(getPreviewUrl(sandboxId), '_blank');
    }
  };

  const resolveEditPath = useCallback((editPath: string): string => {
    const root = provider.root;
    if (!root) return editPath;
    if (isSameOrUnder(editPath, root)) return editPath;
    if (/^[A-Za-z]:[\\/]/.test(editPath)) return editPath;
    return joinPath(root, editPath.replace(/^[/\\]+/, ''));
  }, [provider.root]);

  const applyWorkspaceEdits = useCallback(async (messageId: string, edits: WorkspaceEditBlock[]) => {
    if (!provider.root) {
      setError('Open a folder before applying AI file edits.');
      return;
    }
    setApplyingEditMessageId(messageId);
    setError(null);
    const writtenPaths: string[] = [];
    try {
      for (const edit of edits) {
        const path = resolveEditPath(edit.path);
        await provider.writeFile(path, edit.content);
        await onFileWritten?.(path, edit.content);
        writtenPaths.push(path);
      }
      emitWorkspaceEvent({ type: 'tree-changed' });
      emitWorkspaceEvent({ type: 'files-changed', paths: writtenPaths });
      setAppliedEditMessageIds((prev) => new Set([...prev, messageId]));
    } catch (reason) {
      console.error('Failed to apply workspace edits:', reason);
      setError(reason instanceof Error ? reason.message : 'Could not apply workspace edits.');
    } finally {
      setApplyingEditMessageId(null);
    }
  }, [provider, resolveEditPath, onFileWritten]);

  const placeholder = isLoading
    ? "AI is working..."
    : !sandboxId
      ? "Initializing sandbox..."
      : !isConfigured(loadSettings())
        ? "Open Settings to add your API key..."
        : "Ask Cursor / Copilot (Ctrl+L)...";

  const renderMessage = (m: ChatMessage, i: number) => (
    <div
      key={m.id || i}
      className={cn("flex flex-col gap-1", m.role === 'user' ? "items-end" : "items-start")}
      data-chat-message
    >
      {m.role === 'user' && (
        <div className="bg-[#2d2d2d] text-foreground rounded-2xl px-4 py-2.5 text-[13px] max-w-[90%] shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
        </div>
      )}
      {m.role !== 'user' && (() => {
        const editBlocks = extractWorkspaceEdits(m.content);
        const messageId = m.id || String(i);
        const isApplying = applyingEditMessageId === messageId;
        const isApplied = appliedEditMessageIds.has(messageId);
        return (
          <div className="text-foreground/90 text-[13px] px-1 max-w-full overflow-hidden">
            {m.content && (
              <div>
                <p className="whitespace-pre-wrap leading-relaxed mb-2">{m.content}</p>
                <div className="flex items-center gap-2 mt-1 mb-2 flex-wrap">
                  <button
                    onClick={() => navigator.clipboard.writeText(m.content)}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 bg-secondary/50 px-2 py-0.5 rounded border border-border/30 transition-colors"
                    title="Copy message"
                  >
                    <Copy size={10} />
                    Copy
                  </button>
                  {onApplyCode && (
                    <button
                      onClick={() => {
                        const codeMatch = m.content.match(/```(?:[a-z]*\n)?([\s\S]*?)```/);
                        onApplyCode(codeMatch ? codeMatch[1].trim() : m.content);
                      }}
                      className="text-[10px] text-[#007acc] hover:text-[#38bdf8] flex items-center gap-1 bg-[#007acc]/10 px-2 py-0.5 rounded border border-[#007acc]/30 transition-colors"
                      title="Insert or apply into active editor"
                    >
                      <FileCode size={10} />
                      Insert in Editor
                    </button>
                  )}
                  {editBlocks.length > 0 && (
                    <button
                      onClick={() => void applyWorkspaceEdits(messageId, editBlocks)}
                      disabled={isApplying || isApplied}
                      className={cn(
                        "text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border transition-colors",
                        isApplied
                          ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                          : "text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 border-emerald-500/30 disabled:opacity-60",
                      )}
                      title="Write these AI edits to the workspace"
                    >
                      <CheckCheck size={10} />
                      {isApplied ? 'Applied' : isApplying ? 'Applying...' : `Apply Workspace Edits (${editBlocks.length})`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {m.parts?.filter((p) => p.type === 'tool-invocation').map((part: any, idx: number) => {
            const toolId = `${m.id || i}-${idx}`;
            const isExpanded = expandedTools.has(toolId);
            return (
              <div key={idx} className="bg-secondary/50 rounded border border-border/30 overflow-hidden mb-1.5 last:mb-0">
                <button
                  onClick={() => toggleToolExpand(toolId)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-secondary/70 transition-colors"
                >
                  <Wrench className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate">{part.toolName}</span>
                  <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium shrink-0", part.state === 'pending' ? "text-amber-500" : "text-emerald-500")}>
                    {part.state === 'pending' ? '...' : '✓'}
                  </span>
                  {isExpanded ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-2.5 h-2.5 text-muted-foreground shrink-0" />}
                </button>
                {isExpanded && part.input && (
                  <div className="px-2 pb-1.5 border-t border-border/20">
                    <pre className="text-[9px] font-mono text-muted-foreground/60 mt-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(part.input, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
            })}
          </div>
        );
      })()}
    </div>
  );

  const renderChatInput = (compact: boolean) => (
    <div className="p-3 border-t border-border bg-background shrink-0">
      {error && (
        <div className="mb-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <div className="font-medium">Error: {error}</div>
          <div className="text-xs mt-1 text-destructive/70">
            Check your API key, base URL, and model in Settings.
          </div>
        </div>
      )}
      <form onSubmit={onFormSubmit} className="relative group bg-[#18181b] rounded-xl border border-border/40 focus-within:border-border/60 focus-within:ring-1 focus-within:ring-border/40 transition-all shadow-sm">
        {activeFile && (
          <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[11px] text-zinc-400 border-b border-border/20 pb-1.5">
            <FileCode size={12} className="text-[#007acc] shrink-0" />
            <span className="truncate font-mono">{activeFile.split('/').pop()}</span>
            {includeWorkspaceContext && agentMode.id === 'agent' && (
              <span className="text-[10px] text-emerald-300 bg-emerald-500/10 px-1.5 py-0.2 rounded font-sans shrink-0">
                Workspace
              </span>
            )}
            {selectedCode && (
              <span className="text-[10px] text-[#007acc] bg-[#007acc]/10 px-1.5 py-0.2 rounded font-sans shrink-0 ml-auto">
                {selectedCode.split('\n').length} lines
              </span>
            )}
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          placeholder={placeholder}
          className={cn("w-full bg-transparent px-4 py-3 pr-10 text-[13px] leading-relaxed focus:outline-none resize-none placeholder:text-muted-foreground/50 font-normal", compact ? "min-h-[80px] max-h-[200px]" : "min-h-[100px] max-h-[300px]")}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isLoading && sandboxId && input.trim()) {
                onFormSubmit(e as any);
              }
            }
          }}
          rows={1}
          disabled={!sandboxId}
        />
        <div className="px-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:text-foreground/80 transition-colors focus:outline-none px-1">
                    <agentMode.icon size={12} />
                    <span>{agentMode.name}</span>
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-[#1a1a1a] border-border/50 text-xs z-50">
                  {AGENT_MODES.map((mode) => (
                    <DropdownMenuItem key={mode.id} onClick={() => setAgentMode(mode)} className="gap-2 cursor-pointer focus:bg-[#252525]">
                      <mode.icon size={12} />
                      {mode.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-[1px] h-3 bg-border/50 mx-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 hover:text-foreground/80 transition-colors focus:outline-none px-1">
                    <span>{selectedModel.name}</span>
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-[#1a1a1a] border-border/50 text-xs min-w-[140px] z-50">
                  {AI_MODELS.map((model) => (
                    <DropdownMenuItem key={model.id} onClick={() => chooseModel(model)} className="flex items-center justify-between gap-2 cursor-pointer focus:bg-[#252525] py-2 px-3">
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-medium text-foreground">{model.name}</span>
                        <span className="text-[10px] text-muted-foreground/60">{model.subtitle}</span>
                      </div>
                      {selectedModel.id === model.id && <Check size={12} className="text-foreground" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-[1px] h-3 bg-border/50 mx-1" />
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1.5 hover:text-foreground/80 transition-colors focus:outline-none px-1"
                title="AI Settings"
              >
                <SettingsIcon size={12} />
                <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/40">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 hover:text-foreground">
              <AtSign size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 hover:text-foreground",
                includeWorkspaceContext && agentMode.id === 'agent' && "text-[#007acc] bg-[#007acc]/10",
              )}
              onClick={() => setIncludeWorkspaceContext((value) => !value)}
              title={includeWorkspaceContext ? 'Workspace context on' : 'Workspace context off'}
            >
              <FolderOpen size={14} />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 hover:text-foreground">
              <ImageIcon size={14} />
            </Button>
            {isLoading ? (
              <div className="ml-2 p-1.5 bg-amber-500/10 text-amber-500 rounded-md flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !sandboxId}
                className="ml-2 p-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );

  const renderSuggestionsGrid = (count: number) => (
    <div className="grid grid-cols-1 gap-2">
      {SUGGESTED_PROMPTS.slice(0, count).map((item, i) => (
        <button
          key={i}
          onClick={() => handleSuggestedPrompt(item.prompt)}
          className="group flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border/30 hover:bg-secondary hover:border-border/60 transition-all text-left w-full"
        >
          <div className="p-1.5 rounded-md bg-background/50 text-muted-foreground group-hover:text-foreground transition-colors">
            <item.icon size={14} />
          </div>
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">
            {item.title}
          </span>
        </button>
      ))}
    </div>
  );

  const EmptyState = () => (
    <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto space-y-6">
      <div className="space-y-2 text-center">
        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Bot size={24} className="text-primary" />
        </div>
        <h3 className="text-sm font-medium text-foreground">AI Copilot</h3>
        <p className="text-xs text-muted-foreground/60 max-w-[240px] mx-auto">
          Ask your copilot to architect, write, or debug code. Configure your AI model in Settings.
        </p>
      </div>
      <div className="w-full space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold text-center mb-3">
          Suggestions
        </p>
        {renderSuggestionsGrid(4)}
      </div>
    </div>
  );

  // Embedded mode in 3-panel layout
  if (isEmbedded) {
    return (
      <div className="h-full flex flex-col bg-secondary/30 overflow-hidden" ref={containerRef}>
        <SettingsModal isOpen={showSettings} onClose={() => { setShowSettings(false); syncModelFromSettings(); }} />
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 ? <EmptyState /> : messages.map(renderMessage)}
          {isLoading && (
            <div className="flex items-start px-1 mt-1">
              <span className="text-[13px] font-medium animate-shimmer bg-clip-text text-transparent bg-[linear-gradient(110deg,#939393,45%,#e5e5e5,55%,#939393)] bg-[length:250%_100%]">
                Planning next moves
              </span>
            </div>
          )}
        </div>
        {renderChatInput(true)}
      </div>
    );
  }

  // Initial state: centered input (full screen mode)
  if (!hasMessages) {
    return (
      <div className="h-full flex bg-background" ref={containerRef}>
        <SettingsModal isOpen={showSettings} onClose={() => { setShowSettings(false); syncModelFromSettings(); }} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 relative overflow-hidden">
          <div className="mb-12 flex flex-col items-center">
            <div className="w-20 h-20 mb-8 opacity-20">
              <img src="/cursor_logo.png" alt="Cursor" className="w-full h-full" />
            </div>
            <div className="w-full max-w-2xl mt-8">
              <div className="grid grid-cols-2 gap-3 text-left">
                {SUGGESTED_PROMPTS.slice(0, 6).map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedPrompt(item.prompt)}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-[#18181b] border border-white/[0.03] hover:border-white/[0.08] hover:bg-[#202020] transition-all"
                  >
                    <div className="p-2 rounded-lg bg-white/[0.03] text-muted-foreground group-hover:text-foreground transition-colors">
                      <item.icon size={16} />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] font-medium text-foreground/80 group-hover:text-foreground transition-colors truncate">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50 truncate">
                        {item.prompt.slice(0, 40)}...
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="absolute left-4 top-4 text-[13px] font-medium text-foreground">
            New Chat
            <div className="inline-flex items-center gap-2 ml-4">
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                <span className="text-lg leading-none">+</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                <RefreshCw size={12} />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setShowSettings(true)}>
                <SettingsIcon size={12} />
              </Button>
            </div>
          </div>

          <div className="w-full max-w-xl fixed left-4 top-20" ref={initialFormRef}>
            <form onSubmit={onFormSubmit} className="relative group bg-[#18181b] rounded-xl border border-border/40 shadow-2xl">
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(null); }}
                placeholder="Ask Cursor to build..."
                className="relative w-full bg-transparent px-4 py-4 pr-14 text-[13px] leading-relaxed focus:outline-none min-h-[140px] max-h-[300px] resize-none placeholder:text-muted-foreground/50 font-normal rounded-xl"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onFormSubmit(e as any);
                  }
                }}
                disabled={isLoading || !sandboxId}
              />
              <div className="relative px-4 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1.5 hover:text-foreground/80 transition-colors focus:outline-none">
                          <InfinityIcon size={12} />
                          <span>Agent</span>
                          <ChevronDown size={10} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="bg-[#1a1a1a] border-border/50 text-xs">
                        <DropdownMenuItem className="gap-2 cursor-pointer focus:bg-[#252525]">
                          <InfinityIcon size={12} />
                          Agent
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 cursor-pointer focus:bg-[#252525]">
                          <MessageSquareText size={12} />
                          Ask
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="w-[1px] h-3 bg-border/50 mx-1" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1.5 hover:text-foreground/80 transition-colors focus:outline-none">
                          <span>{selectedModel.name}</span>
                          <ChevronDown size={10} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="bg-[#1a1a1a] border-border/50 text-xs min-w-[140px]">
                        {AI_MODELS.map((model) => (
                          <DropdownMenuItem key={model.id} onClick={() => chooseModel(model)} className="flex items-center justify-between gap-2 cursor-pointer focus:bg-[#252525] py-2 px-3">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="font-medium text-foreground">{model.name}</span>
                              <span className="text-[10px] text-muted-foreground/60">{model.subtitle}</span>
                            </div>
                            {selectedModel.id === model.id && <Check size={12} className="text-foreground" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground/40">
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-foreground">
                    <AtSign size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-foreground">
                    <Globe size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-foreground">
                    <ImageIcon size={14} />
                  </Button>
                </div>
              </div>
            </form>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground/40 px-1">
              <FolderOpen size={12} />
              <span>Local</span>
              <ChevronDown size={10} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // After first message: Left sidebar (chat) + Right panel (preview)
  return (
    <div className="h-full flex bg-background" ref={containerRef}>
      <SettingsModal isOpen={showSettings} onClose={() => { setShowSettings(false); syncModelFromSettings(); }} />
      <div className="w-[320px] border-r border-border flex flex-col bg-secondary/30 shrink-0" ref={sidebarRef}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.map(renderMessage)}
          {isLoading && (
            <div className="flex items-start px-1 mt-1">
              <span className="text-[13px] font-medium animate-shimmer bg-clip-text text-transparent bg-[linear-gradient(110deg,#939393,45%,#e5e5e5,55%,#939393)] bg-[length:250%_100%]">
                Planning next moves
              </span>
            </div>
          )}
        </div>
        {renderChatInput(false)}
      </div>

      <div className="flex-1 flex flex-col bg-background min-w-0" ref={previewRef}>
        <div className="h-10 border-b border-border flex items-center justify-between px-3 bg-secondary shrink-0" data-preview-header>
          <div className="flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground/70">Preview</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={openInNewTab} className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground" title="Open in new tab" disabled={!sandboxId}>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button onClick={refreshPreview} className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground" title="Refresh Preview">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {sandboxId && trustDelayPassed ? (
            <iframe key={previewKey} src={getPreviewUrl(sandboxId)} className="w-full h-full border-none bg-white" title="App Preview" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary text-muted-foreground text-sm">
              {!sandboxId ? 'Waiting for sandbox...' : 'Preview unavailable — wire getPreviewUrl to your preview backend.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
