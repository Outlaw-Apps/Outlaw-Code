/** Same-origin proxy prefix (see vite-ai-proxy-plugin.ts). */
export const AI_PROXY_BASE_URL = '/api/openai';

/** Header carrying the real OpenAI-compatible base URL for the proxy. */
export const UPSTREAM_BASE_URL_HEADER = 'X-Upstream-Base-URL';

export const ELECTRON_PROXY_TOKEN_HEADER = 'X-Outlaw-Code-Proxy-Token';

export function resolveAiProxyBaseURL(): string {
  if (typeof window === 'undefined') return AI_PROXY_BASE_URL;

  const electronProxyBaseURL = window.outlawCode?.aiProxyBaseURL?.replace(/\/$/, '');
  if (electronProxyBaseURL) return electronProxyBaseURL;

  if (window.location?.origin && window.location.origin !== 'null' && window.location.origin !== 'file://') {
    return window.location.origin + AI_PROXY_BASE_URL;
  }
  return AI_PROXY_BASE_URL;
}

export function buildAiProxyHeaders(upstreamBaseURL: string, apiKey?: string): Record<string, string> {
  const electronProxyToken = typeof window !== 'undefined' ? window.outlawCode?.aiProxyToken : undefined;
  return {
    Accept: 'application/json',
    [UPSTREAM_BASE_URL_HEADER]: upstreamBaseURL.replace(/\/$/, ''),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(electronProxyToken ? { [ELECTRON_PROXY_TOKEN_HEADER]: electronProxyToken } : {}),
  };
}
