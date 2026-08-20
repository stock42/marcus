export const DEFAULT_MARCUS_API_URL = "http://127.0.0.1:5724";

export function marcusApiUrl(path: string, configuredOrigin = process.env.MARCUS_API_URL): URL {
  if (!path.startsWith("/")) throw new Error("Marcus API paths must be absolute");
  const origin = new URL(configuredOrigin ?? DEFAULT_MARCUS_API_URL);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("MARCUS_API_URL must use http or https");
  }
  return new URL(path, `${origin.origin}/`);
}

export function marcusWebSocketUrl(configuredOrigin = process.env.MARCUS_API_URL): string {
  const url = marcusApiUrl("/api/v1/ws", configuredOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
