import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { loadSettings, saveSettings, clearSettings, DEFAULT_SETTINGS, type AiSettings } from '../lib/settings';
import { fetchProviderModels, type ProviderModel } from '../lib/ai-model-catalog';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after settings are saved so the app can react (e.g. clear chat). */
  onSaved?: () => void;
}

export function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modelOptions, setModelOptions] = useState<ProviderModel[]>([]);
  const [modelFetchState, setModelFetchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [modelFetchMessage, setModelFetchMessage] = useState<string | null>(null);
  const lastModelFetchKey = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const s = loadSettings();
      setApiKey(s.apiKey);
      setBaseURL(s.baseURL);
      setModel(s.model);
      setSaved(false);
      setModelOptions([]);
      setModelFetchState('idle');
      setModelFetchMessage(null);
      lastModelFetchKey.current = null;
    }
  }, [isOpen]);

  const canFetchModels = apiKey.trim().length > 4 && isHttpUrl(baseURL);

  const loadModels = useCallback(async (options: { force?: boolean; signal?: AbortSignal } = {}) => {
    const fetchKey = `${baseURL.trim()}::${apiKey.trim()}`;
    if (!canFetchModels) {
      setModelOptions([]);
      setModelFetchState('idle');
      setModelFetchMessage(
        apiKey.trim() || baseURL.trim()
          ? 'Enter a valid API key and a full http(s) provider Base URL to load models.'
          : null,
      );
      lastModelFetchKey.current = null;
      return;
    }
    if (!options.force && lastModelFetchKey.current === fetchKey && modelOptions.length > 0) return;

    setModelFetchState('loading');
    setModelFetchMessage('Fetching models from the provider...');
    try {
      const models = await fetchProviderModels({
        apiKey,
        baseURL,
        signal: options.signal,
      });
      if (options.signal?.aborted) return;
      setModelOptions(models);
      setModelFetchState('success');
      setModelFetchMessage(`Loaded ${models.length} model${models.length === 1 ? '' : 's'} from /models.`);
      lastModelFetchKey.current = fetchKey;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setModelOptions([]);
      setModelFetchState('error');
      setModelFetchMessage(err instanceof Error ? err.message : 'Could not fetch models.');
      lastModelFetchKey.current = null;
    }
  }, [apiKey, baseURL, canFetchModels, modelOptions.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    if (!apiKey.trim() || !baseURL.trim()) {
      setModelOptions([]);
      setModelFetchState('idle');
      setModelFetchMessage(null);
      lastModelFetchKey.current = null;
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadModels({ signal: controller.signal });
    }, 700);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, apiKey, baseURL, loadModels]);

  const handleSave = () => {
    const next: AiSettings = { apiKey, baseURL, model };
    saveSettings(next);
    setSaved(true);
    onSaved?.();
    onClose();
  };

  const handleReset = () => {
    clearSettings();
    setApiKey(DEFAULT_SETTINGS.apiKey);
    setBaseURL(DEFAULT_SETTINGS.baseURL);
    setModel(DEFAULT_SETTINGS.model);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#0d0d0d] border-[#2d2d2d] text-foreground">
        <DialogHeader>
          <DialogTitle>OpenAI-Compatible AI Settings</DialogTitle>
          <p className="text-xs text-muted-foreground">
            One client, three fields: API key + base URL + model ID. Same trio for OpenAI, OpenRouter,
            NVIDIA NIM, xAI Grok, Gemini, or local servers. Stored in this browser (overrides <code>.env</code>).
          </p>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90 leading-relaxed">
            <span className="font-medium text-amber-200">CORS tip:</span> leave Base URL as the provider
            endpoint below. Chat already goes through the local <code className="text-amber-50">/api/openai</code> proxy
            — do not paste that path into Base URL. Vite dev/preview run the proxy on port 3000, and the
            packaged Electron app starts its own local desktop proxy. If the Network tab still hits{' '}
            <code>generativelanguage.googleapis.com</code> (or NVIDIA/xAI) from the browser, the proxy is not running.
          </div>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Provider base URLs (match key + model to the same one): NVIDIA{' '}
            <code>https://integrate.api.nvidia.com/v1</code>, Grok{' '}
            <code>https://api.x.ai/v1</code>, Gemini{' '}
            <code>https://generativelanguage.googleapis.com/v1beta/openai/</code>, OpenAI{' '}
            <code>https://api.openai.com/v1</code>, OpenRouter{' '}
            <code>https://openrouter.ai/api/v1</code>, local{' '}
            <code>http://localhost:1234/v1</code>.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-background/50 border-border/50 pr-16"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base-url">Base URL (provider endpoint)</Label>
            <Input
              id="base-url"
              type="text"
              placeholder="https://integrate.api.nvidia.com/v1"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              className="bg-background/50 border-border/50"
            />
            <p className="text-[10px] text-muted-foreground/70">
              Enter the provider's full base URL, including any required path such as <code>/v1</code>. When
              running via Vite (<code>npm run dev</code> / <code>npm run preview</code>), chat is routed through
              the same-origin <code>/api/openai</code> proxy. The Windows desktop build runs the same forwarder locally.
              Static hosting must serve its own <code>/api/openai</code> proxy.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="model">Model</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
                disabled={!canFetchModels || modelFetchState === 'loading'}
                onClick={() => void loadModels({ force: true })}
              >
                <RefreshCw size={12} className={modelFetchState === 'loading' ? 'animate-spin' : ''} />
                {modelFetchState === 'success' ? 'Refresh models' : 'Fetch models'}
              </Button>
            </div>
            {modelOptions.length > 0 && (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border/50 bg-background/50 px-3 py-2 text-sm text-foreground outline-none focus:border-[#007acc]"
              >
                {model && !modelOptions.some((option) => option.id === model) && (
                  <option value={model}>{model} (current custom ID)</option>
                )}
                {!model && <option value="">Select a model...</option>}
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.ownedBy ? `${option.id} - ${option.ownedBy}` : option.id}
                  </option>
                ))}
              </select>
            )}
            <Input
              id="model"
              type="text"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="bg-background/50 border-border/50"
            />
            {modelFetchMessage && (
              <p
                className={
                  modelFetchState === 'error'
                    ? 'text-[10px] text-red-400 leading-relaxed'
                    : 'text-[10px] text-muted-foreground/70 leading-relaxed'
                }
              >
                {modelFetchMessage}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleReset} className="text-muted-foreground">
            Reset to defaults
          </Button>
          <Button onClick={handleSave} disabled={!model.trim()}>
            {saved ? 'Saved' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
