/**
 * OpenAI-compatible chat client.
 *
 * Replaces the former Blink `Agent` runtime. Uses the official `openai` SDK
 * pointed at any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together,
 * local LLMs, etc.) configured via src/lib/settings.ts.
 *
 * Browser traffic never hits the provider origin directly. Requests go to the
 * same-origin Vite proxy at `/api/openai`, which forwards to the Settings
 * base URL using the `X-Upstream-Base-URL` header (stripped before upstream).
 *
 * Streaming uses the universally-compatible Chat Completions `stream: true`
 * contract (choices[].delta.content), which every OpenAI-compatible provider
 * supports.
 */
import OpenAI from 'openai';
import { loadSettings, type AiSettings } from './settings';
import {
  buildAiProxyHeaders,
  resolveAiProxyBaseURL,
} from './ai-proxy';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Optional tool-invocation parts (kept for UI compatibility; currently unused). */
  parts?: { type: string; toolName?: string; state?: string; input?: unknown }[];
}

export interface SendMessageOptions {
  /** Conversation history (excluding the new user message). */
  messages: ChatMessage[];
  /** The new user prompt. */
  prompt: string;
  /** System prompt. Defaults to the coding-agent prompt. */
  systemPrompt?: string;
  /** Called for each streamed text delta. */
  onDelta?: (delta: string) => void;
  /** Abort the in-flight request. */
  signal?: AbortSignal;
}

export const CODING_AGENT_SYSTEM_PROMPT = `You are an elite software engineering copilot modeled after Cursor and Visual Studio.
You assist the developer in reading, architecting, debugging, refactoring, and writing full-stack code.

Guidelines:
- Be direct, technical, and concise. Avoid marketing fluff or filler.
- When writing or proposing code changes, provide clean, production-ready, type-safe implementations.
- Reference the active file and surrounding context when answering questions or writing code.
- When debugging, pinpoint root causes with precision and explain the fix.
- Tailor your code to the user's active codebase, frameworks, and packages.
- When changing files in Agent mode, prefer direct workspace edits using fenced blocks exactly like:
  \`\`\`outlaw-edit path="relative/path.ext"
  <complete file contents>
  \`\`\`
  Each block replaces that file when the user applies it. Use paths relative to the workspace root unless the prompt gives an existing absolute path.
- When the user asks for code, provide complete or clear diff blocks. In Ask mode, explain concepts concisely.`;

export const ASK_AGENT_SYSTEM_PROMPT = `You are a helpful, concise code assistant. Answer the user's questions about codebases and software engineering. You are in "Ask" (read-only) mode: explain rather than modify, and suggest concrete next steps.`;

function buildClient(settings: AiSettings): OpenAI {
  const upstreamBase = (settings.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return new OpenAI({
    apiKey: settings.apiKey || 'sk-no-key',
    // Absolute same-origin URL so the browser never calls the provider origin
    // directly (CORS). The proxy forwards via X-Upstream-Base-URL.
    baseURL: resolveAiProxyBaseURL(),
    dangerouslyAllowBrowser: true,
    defaultHeaders: buildAiProxyHeaders(upstreamBase),
  });
}

/**
 * Send a prompt and stream the assistant reply token-by-token.
 * Returns the full assembled text. Throws on API/auth errors.
 *
 * Resilience: Gemini flash models intermittently return 503 (high demand).
 * Retry overloaded responses, then fall back to sibling Gemini models before
 * surfacing an error. Falls back to a non-streaming request if streaming
 * fails or yields nothing.
 */
export async function streamChatCompletion(
  opts: SendMessageOptions,
): Promise<string> {
  const settings = loadSettings();
  if (!settings.apiKey) {
    throw new Error('No API key configured. Open Settings to add your API key.');
  }
  if (!settings.model) {
    throw new Error('No model configured. Open Settings to choose a model.');
  }
  const client = buildClient(settings);

  const history = opts.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const baseMessages = [
    { role: 'system', content: opts.systemPrompt ?? CODING_AGENT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: opts.prompt },
  ] as { role: 'system' | 'user' | 'assistant'; content: string }[];

  const modelsToTry = [settings.model, ...fallbackModels(settings.model)];
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const text = await tryStreamOnce(client, model, baseMessages, opts);
      if (text) return text;
      // Empty stream: retry once without streaming before moving on.
      const plain = await tryOnce(client, model, baseMessages, opts.signal);
      if (plain) return plain;
      lastError = new Error(`Model ${model} returned an empty response.`);
    } catch (err) {
      lastError = err;
      if (opts.signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
      if (!isRetryable(err) || model !== modelsToTry[modelsToTry.length - 1]) {
        // Retryable + more models to try (or retries inside tryStreamOnce
        // already exhausted): move to the next fallback model.
        if (isRetryable(err)) continue;
        throw toFriendlyError(err, model);
      }
      throw toFriendlyError(err, model);
    }
  }
  throw toFriendlyError(lastError, settings.model);
}

/** Sibling models to try when the primary is overloaded or unavailable. */
function fallbackModels(primary: string): string[] {
  const candidates = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
  ];
  return candidates.filter((m) => m !== primary);
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 503) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /overloaded|high demand|unavailable|rate limit|429|503|timeout|network|fetch failed/i.test(message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function tryStreamOnce(
  client: OpenAI,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: SendMessageOptions,
  maxAttempts = 3,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await client.chat.completions.create(
        { model, stream: true, messages },
        { signal: opts.signal, timeout: 60000 },
      );
      let full = '';
      for await (const chunk of completion) {
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          opts.onDelta?.(delta);
        }
      }
      return full;
    } catch (err) {
      lastError = err;
      if (opts.signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      await sleep(1000 * attempt, opts.signal);
    }
  }
  throw lastError;
}

async function tryOnce(
  client: OpenAI,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): Promise<string> {
  const completion = await client.chat.completions.create(
    { model, stream: false, messages },
    { signal, timeout: 60000 },
  );
  const content = completion.choices?.[0]?.message?.content ?? '';
  return content;
}

function toFriendlyError(err: unknown, model: string): Error {
  if (err instanceof Error && /No (API key|model) configured/.test(err.message)) return err;
  const status = (err as { status?: number; code?: string })?.status;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 401 || /invalid api key|unauthorized|401/i.test(raw)) {
    return new Error('API key rejected (401). Check the key in Settings matches the Base URL provider.');
  }
  if (status === 404 || /model.*not (found|available)|404/i.test(raw)) {
    return new Error(`Model "${model}" not found (404). Pick a valid model ID for this provider in Settings.`);
  }
  if (status === 429 || /rate limit|429|quota|exceed/i.test(raw)) {
    return new Error('Rate limited (429). Wait a bit or switch to a lighter model (e.g. gemini-3.1-flash-lite).');
  }
  if (status === 503 || /overloaded|high demand|unavailable|503/i.test(raw)) {
    return new Error('Model overloaded (503). Retried + tried fallback models — please try again or pick gemini-3.1-flash-lite.');
  }
  return new Error(raw || 'Failed to send message');
}

/** Generate a unique id for a chat message. */
export function newMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
