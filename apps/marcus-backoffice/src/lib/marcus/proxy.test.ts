import { describe, expect, test } from "bun:test";
import { proxyMarcus } from "./proxy";

describe("Marcus semantic BFF proxy", () => {
  test("forwards only session, mutation and response-preference headers", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(input);
      receivedInit = init;
      const headers = new Headers({ "content-type": "application/json", location: "/api/v1/projects/prj/runs/run", "retry-after": "1" });
      headers.append("set-cookie", "marcus_session=web_test; HttpOnly; Path=/");
      return new Response(JSON.stringify({ ok: true, data: { authenticated: true, csrf: "csrf" } }), { headers });
    };
    const request = new Request("http://backoffice.local/api/session/login", {
      method: "POST",
      headers: {
        authorization: "Bearer must-not-cross-the-bff",
        cookie: "marcus_session=web_existing",
        "idempotency-key": "idem-1",
        origin: "https://untrusted.example",
        prefer: "respond-async",
        "x-marcus-csrf": "csrf-1",
        "x-private-header": "must-not-cross-the-bff",
      },
    });

    const response = await proxyMarcus(request, "/api/v1/auth/login", {
      body: { username: "admin", password: "secret" },
      fetcher,
      origin: "http://127.0.0.1:4314",
    });

    const headers = new Headers(receivedInit?.headers);
    expect(receivedUrl).toBe("http://127.0.0.1:4314/api/v1/auth/login");
    expect(headers.get("cookie")).toBe("marcus_session=web_existing");
    expect(headers.get("x-marcus-csrf")).toBe("csrf-1");
    expect(headers.get("idempotency-key")).toBe("idem-1");
    expect(headers.get("prefer")).toBe("respond-async");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("origin")).toBeNull();
    expect(headers.get("x-private-header")).toBeNull();
    expect(receivedInit?.body).toBe(JSON.stringify({ username: "admin", password: "secret" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("marcus_session=web_test");
    expect(response.headers.get("location")).toBe("/api/v1/projects/prj/runs/run");
    expect(response.headers.get("retry-after")).toBe("1");
  });

  test("returns a stable 502 envelope when Marcus API is unavailable", async () => {
    const response = await proxyMarcus(new Request("http://backoffice.local/api/session"), "/api/v1/auth/session", {
      fetcher: async () => { throw new Error("connection details must not leak"); },
      origin: "http://127.0.0.1:4314",
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "MARCUS_API_UNAVAILABLE",
        message: "No se pudo conectar con Marcus API.",
        retryable: true,
      },
    });
  });
});
