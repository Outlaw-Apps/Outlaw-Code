import { buildAiProxyHeaders, resolveAiProxyBaseURL } from './ai-proxy';

export interface ProviderModel {
  id: string;
  ownedBy?: string;
}

interface FetchProviderModelsOptions {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
}

export async function fetchProviderModels({
  apiKey,
  baseURL,
  signal,
}: FetchProviderModelsOptions): Promise<ProviderModel[]> {
  const trimmedKey = apiKey.trim();
  const trimmedBaseURL = baseURL.trim();
  if (!trimmedKey) throw new Error('Enter an API key before fetching models.');
  if (!trimmedBaseURL) throw new Error('Enter a provider Base URL before fetching models.');

  const response = await fetch(`${resolveAiProxyBaseURL()}/models`, {
    method: 'GET',
    headers: buildAiProxyHeaders(trimmedBaseURL, trimmedKey),
    signal,
  });

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok) {
    throw new Error(readProviderError(body) || `Model fetch failed (${response.status}).`);
  }

  const models = parseProviderModels(body);
  if (models.length === 0) {
    throw new Error('The provider returned no model IDs from /models.');
  }
  return models;
}

export function parseProviderModels(body: unknown): ProviderModel[] {
  const rawList = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
      ? (body as { data: unknown[] }).data
      : Array.isArray((body as { models?: unknown })?.models)
        ? (body as { models: unknown[] }).models
        : [];

  const byId = new Map<string, ProviderModel>();
  for (const item of rawList) {
    const id = readModelId(item);
    if (!id) continue;
    const ownedBy = typeof item === 'object' && item !== null && typeof (item as { owned_by?: unknown }).owned_by === 'string'
      ? (item as { owned_by: string }).owned_by
      : undefined;
    byId.set(id, { id, ownedBy });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function readModelId(item: unknown): string | null {
  if (typeof item === 'string') return normalizeFetchedModelId(item);
  if (!item || typeof item !== 'object') return null;
  const maybeId = (item as { id?: unknown; name?: unknown; model?: unknown }).id
    ?? (item as { name?: unknown }).name
    ?? (item as { model?: unknown }).model;
  return typeof maybeId === 'string' ? normalizeFetchedModelId(maybeId) : null;
}

function normalizeFetchedModelId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readProviderError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}
