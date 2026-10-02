const AI_PROXY_PREFIX = '/api/openai';
const UPSTREAM_BASE_URL_HEADER = 'x-upstream-base-url';
const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'user-agent',
];
const OMITTED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
]);

function jsonError(status: number, message: string, type: string): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isAllowedUpstream(hostname: string, configuredHosts: string | undefined): boolean {
  const allowedHosts = (configuredHosts ?? '*')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return allowedHosts.length === 0 || allowedHosts.includes('*') || allowedHosts.includes(hostname);
}

function pickRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxyOpenAi(request: Request, env: Env, url: URL): Promise<Response> {
  const upstreamBase = request.headers.get(UPSTREAM_BASE_URL_HEADER);
  if (!upstreamBase || !upstreamBase.trim()) {
    return jsonError(
      400,
      'Missing x-upstream-base-url header (set from Settings base URL).',
      'invalid_request_error',
    );
  }

  const base = upstreamBase.trim().replace(/\/$/, '');
  const suffix = url.pathname.slice(AI_PROXY_PREFIX.length) || '/';
  let target: URL;
  try {
    target = new URL(base + suffix + url.search);
  } catch {
    return jsonError(
      400,
      `Invalid X-Upstream-Base-URL: ${upstreamBase}`,
      'invalid_request_error',
    );
  }

  if (target.protocol !== 'https:') {
    return jsonError(
      400,
      'Upstream base URL must use https: when running on Cloudflare Workers.',
      'invalid_request_error',
    );
  }

  const hostname = target.hostname.toLowerCase();
  if (!isAllowedUpstream(hostname, env.ALLOWED_UPSTREAM_HOSTS)) {
    return jsonError(
      403,
      `Upstream host "${hostname}" is not allowed. Add it to ALLOWED_UPSTREAM_HOSTS in wrangler.jsonc and redeploy.`,
      'forbidden',
    );
  }

  const requestBody =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const body = requestBody && requestBody.byteLength > 0 ? requestBody : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: pickRequestHeaders(request),
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(502, `Upstream proxy failed: ${message}`, 'proxy_error');
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!OMITTED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      responseHeaders.set(name, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === AI_PROXY_PREFIX || url.pathname.startsWith(`${AI_PROXY_PREFIX}/`)) {
      return proxyOpenAi(request, env, url);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonError(404, 'Not found', 'not_found');
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
