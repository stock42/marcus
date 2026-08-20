import { marcusApiUrl } from "./origin";
import { backofficeLogger } from "./logger";
import type { ApiEnvelope, Json } from "./types";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ProxyOptions = {
  body?: Json | Record<string, unknown>;
  fetcher?: Fetcher;
  origin?: string;
  timeoutMs?: number;
};

const REQUEST_HEADERS = ["cookie", "x-marcus-csrf", "idempotency-key", "prefer"] as const;
const RESPONSE_HEADERS = ["content-type", "cache-control", "location", "retry-after"] as const;

export async function proxyMarcus(request: Request, path: string, options: ProxyOptions = {}): Promise<Response> {
  const startedAt = performance.now();
  const headers = new Headers({ Accept: "application/json" });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? JSON.stringify(options.body ?? {}) : undefined;
  if (body !== undefined) headers.set("content-type", "application/json");

  try {
    const upstream = await (options.fetcher ?? fetch)(marcusApiUrl(path, options.origin), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    const responseHeaders = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = typeof getSetCookie === "function"
      ? getSetCookie.call(upstream.headers)
      : [upstream.headers.get("set-cookie")].filter((value): value is string => value !== null);
    for (const cookie of setCookies) responseHeaders.append("set-cookie", cookie);
    responseHeaders.set("cache-control", "no-store");
    backofficeLogger.info("bff.request.completed", {
      method: request.method,
      path,
      status: upstream.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    backofficeLogger.error("bff.request.failed", {
      method: request.method,
      path,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    const envelope: ApiEnvelope<never> = {
      ok: false,
      error: {
        code: "MARCUS_API_UNAVAILABLE",
        message: "No se pudo conectar con Marcus API.",
        retryable: true,
      },
    };
    return Response.json(envelope, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
