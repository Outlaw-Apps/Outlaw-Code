import { useMemo, useState } from 'react';
import { Check, Copy, FileCode, Package, Play, Plug, Search, Wrench } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';
import { emitWorkspaceCommand } from '../lib/app-commands';
import { sendTerminalCommand } from '../lib/terminal-commands';

type ToolCategory = 'plugins' | 'formatters' | 'debuggers' | 'sdks-drivers';

interface ToolRecipe {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  command: string;
  note?: string;
}

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  plugins: 'Plugins',
  formatters: 'Formatters',
  debuggers: 'Debuggers',
  'sdks-drivers': 'SDKs / Drivers',
};

const CATEGORY_ICONS: Record<ToolCategory, typeof Plug> = {
  plugins: Plug,
  formatters: FileCode,
  debuggers: Wrench,
  'sdks-drivers': Package,
};

const TOOL_RECIPES: ToolRecipe[] = [
  {
    id: 'vite-plugin-inspect',
    name: 'Vite Plugin Inspect',
    category: 'plugins',
    description: 'Inspect Vite plugin transforms when a build behaves differently than expected.',
    command: 'npm install -D vite-plugin-inspect',
  },
  {
    id: 'vite-tsconfig-paths',
    name: 'Vite TSConfig Paths',
    category: 'plugins',
    description: 'Let Vite understand TypeScript path aliases from tsconfig.json.',
    command: 'npm install -D vite-tsconfig-paths',
  },
  {
    id: 'prettier',
    name: 'Prettier',
    category: 'formatters',
    description: 'Format TypeScript, JavaScript, JSON, CSS, and Markdown consistently.',
    command: 'npm install -D prettier',
    note: 'After install, add a .prettierrc if the project needs custom rules.',
  },
  {
    id: 'eslint',
    name: 'ESLint',
    category: 'formatters',
    description: 'Catch common JavaScript and TypeScript mistakes before runtime.',
    command: 'npm install -D eslint typescript-eslint',
    note: 'ESLint 9 expects an eslint.config.js or eslint.config.mjs file.',
  },
  {
    id: 'vitest-ui',
    name: 'Vitest UI',
    category: 'debuggers',
    description: 'Run fast component and unit tests with an interactive browser UI.',
    command: 'npm install -D vitest @vitest/ui jsdom',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    category: 'debuggers',
    description: 'Debug full browser flows with screenshots, traces, and test recording.',
    command: 'npm install -D @playwright/test && npx playwright install',
  },
  {
    id: 'supabase-js',
    name: 'Supabase JS SDK',
    category: 'sdks-drivers',
    description: 'Connect a frontend app to Supabase auth, storage, and Postgres APIs.',
    command: 'npm install @supabase/supabase-js',
  },
  {
    id: 'postgres-driver',
    name: 'PostgreSQL Driver',
    category: 'sdks-drivers',
    description: 'Connect Node.js server code directly to PostgreSQL.',
    command: 'npm install pg && npm install -D @types/pg',
  },
  {
    id: 'openai-sdk',
    name: 'OpenAI SDK',
    category: 'sdks-drivers',
    description: 'Call OpenAI-compatible chat, image, and embedding APIs from app code.',
    command: 'npm install openai',
  },
];

export function ToolsPanel() {
  const [query, setQuery] = useState('');
  const [customPackage, setCustomPackage] = useState('');
  const [installMode, setInstallMode] = useState<'runtime' | 'dev'>('runtime');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const filteredRecipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TOOL_RECIPES;
    return TOOL_RECIPES.filter((recipe) => (
      recipe.name.toLowerCase().includes(needle) ||
      recipe.description.toLowerCase().includes(needle) ||
      CATEGORY_LABELS[recipe.category].toLowerCase().includes(needle) ||
      recipe.command.toLowerCase().includes(needle)
    ));
  }, [query]);

  const customCommand = customPackage.trim()
    ? `npm install ${installMode === 'dev' ? '-D ' : ''}${customPackage.trim()}`
    : '';

  const runCommand = (command: string) => {
    emitWorkspaceCommand('view.terminal');
    sendTerminalCommand(command);
  };

  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand((current) => (current === command ? null : current)), 1600);
  };

  return (
    <div className="h-full flex flex-col text-xs text-foreground bg-[#181818]">
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#2b2b2b] shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tools</span>
        <Package size={14} className="text-[#007acc]" />
      </div>

      <div className="p-3 border-b border-[#2b2b2b] space-y-3">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools..."
            className="h-7 pl-7 bg-[#18181b] border-border/40 text-xs"
          />
        </div>

        <div className="space-y-2 rounded border border-border/30 bg-[#1c1c1f] p-2">
          <div className="text-[11px] font-medium text-zinc-300">Add custom package</div>
          <Input
            value={customPackage}
            onChange={(event) => setCustomPackage(event.target.value)}
            placeholder="example: @vendor/sdk"
            className="h-7 bg-[#18181b] border-border/40 text-xs font-mono"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setInstallMode('runtime')}
              className={cn(
                'h-6 flex-1 rounded border border-border/30 text-[11px] transition-colors',
                installMode === 'runtime' ? 'bg-[#007acc] text-white border-[#007acc]' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              Runtime
            </button>
            <button
              type="button"
              onClick={() => setInstallMode('dev')}
              className={cn(
                'h-6 flex-1 rounded border border-border/30 text-[11px] transition-colors',
                installMode === 'dev' ? 'bg-[#007acc] text-white border-[#007acc]' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              Dev
            </button>
          </div>
          <Button
            size="sm"
            className="h-7 w-full text-xs gap-1.5 bg-[#007acc] hover:bg-[#0062a3]"
            disabled={!customCommand}
            onClick={() => runCommand(customCommand)}
          >
            <Play size={12} />
            Run Install
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {(Object.keys(CATEGORY_LABELS) as ToolCategory[]).map((category) => {
            const recipes = filteredRecipes.filter((recipe) => recipe.category === category);
            if (recipes.length === 0) return null;
            const Icon = CATEGORY_ICONS[category];
            return (
              <section key={category} className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Icon size={12} className="text-[#007acc]" />
                  {CATEGORY_LABELS[category]}
                </div>
                {recipes.map((recipe) => (
                  <div key={recipe.id} className="rounded border border-border/30 bg-[#1c1c1f] p-2.5 space-y-2">
                    <div className="space-y-1">
                      <div className="text-[12px] font-medium text-zinc-100">{recipe.name}</div>
                      <p className="text-[11px] leading-relaxed text-zinc-400">{recipe.description}</p>
                      {recipe.note && <p className="text-[10px] leading-relaxed text-amber-300/80">{recipe.note}</p>}
                    </div>
                    <div className="rounded bg-[#18181b] border border-border/30 px-2 py-1.5 font-mono text-[10px] text-zinc-300 break-all">
                      {recipe.command}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] gap-1 text-zinc-400 hover:text-zinc-100"
                        onClick={() => void copyCommand(recipe.command)}
                      >
                        {copiedCommand === recipe.command ? <Check size={11} /> : <Copy size={11} />}
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px] gap-1 bg-[#007acc] hover:bg-[#0062a3]"
                        onClick={() => runCommand(recipe.command)}
                      >
                        <Play size={11} />
                        Run
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
