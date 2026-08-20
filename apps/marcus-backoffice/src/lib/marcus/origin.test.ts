import { expect, test } from "bun:test";
import { DEFAULT_MARCUS_API_URL, marcusApiUrl, marcusWebSocketUrl } from "./origin";

test("Backoffice defaults to the dedicated Marcus API port", () => {
  expect(DEFAULT_MARCUS_API_URL).toBe("http://127.0.0.1:5724");
  expect(marcusApiUrl("/health/live", DEFAULT_MARCUS_API_URL).href).toBe("http://127.0.0.1:5724/health/live");
  expect(marcusWebSocketUrl(DEFAULT_MARCUS_API_URL)).toBe("ws://127.0.0.1:5724/api/v1/ws");
  expect(marcusWebSocketUrl("https://marcus.example")).toBe("wss://marcus.example/api/v1/ws");
});
