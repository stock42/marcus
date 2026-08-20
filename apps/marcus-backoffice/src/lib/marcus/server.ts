import { cookies } from "next/headers";
import { marcusApiUrl } from "./origin";
import { backofficeLogger } from "./logger";
import type { ApiEnvelope, SessionStatus } from "./types";

export type MarcusServerResult<T> = {
  status: number;
  envelope: ApiEnvelope<T>;
};

export async function getMarcusSession(): Promise<SessionStatus & { apiAvailable: boolean }> {
  const result = await requestMarcus<SessionStatus>("/api/v1/auth/session");
  if (!result.envelope.ok) return { authenticated: false, apiAvailable: result.status !== 502 };
  return { ...result.envelope.data, apiAvailable: true };
}

export async function requestMarcus<T>(path: string): Promise<MarcusServerResult<T>> {
  const startedAt = performance.now();
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await fetch(marcusApiUrl(path), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        ...(cookieHeader === "" ? {} : { Cookie: cookieHeader }),
      },
    });
    const result = {
      status: response.status,
      envelope: await response.json() as ApiEnvelope<T>,
    };
    backofficeLogger.info("server.request.completed", { method: "GET", path, status: response.status, durationMs: Math.round(performance.now() - startedAt) });
    return result;
  } catch (error) {
    backofficeLogger.error("server.request.failed", { method: "GET", path, durationMs: Math.round(performance.now() - startedAt), error });
    return {
      status: 502,
      envelope: {
        ok: false,
        error: {
          code: "MARCUS_API_UNAVAILABLE",
          message: "No se pudo conectar con Marcus API.",
          retryable: true,
        },
      },
    };
  }
}
