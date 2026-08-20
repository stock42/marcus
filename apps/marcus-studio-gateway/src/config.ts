import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { STUDIO_LIMITS } from "@marcus/studio-contracts";

export interface StudioGatewayConfig {
  host: "127.0.0.1";
  port: number;
  dataDir: string;
  databasePath: string;
  logsDir?: string;
  allowedOrigins: readonly string[];
  trustProxy: boolean;
  secureCookies: boolean;
  sessionTtlMs: number;
  replayTtlMs: number;
  providerBaseUrl: string;
  providerApiKey: string;
  providerModel: string;
  providerTimeoutMs: number;
  maxConcurrentGenerations: number;
  dailyLlmCallLimit: number;
  maxOutputTokens: number;
  sessionKey: Uint8Array;
  eventEncryptionKey: Uint8Array;
}

export async function loadStudioGatewayConfig(): Promise<StudioGatewayConfig> {
  const dataDir = process.env.MARCUS_STUDIO_DATA_DIR ?? resolve(homedir(), ".marcus", "studio");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const allowedOrigins = csv(process.env.MARCUS_STUDIO_ALLOWED_ORIGINS, [
    "https://projectmarcus.com",
    "https://www.projectmarcus.com",
    "http://127.0.0.1:4321",
    "http://localhost:4321",
    "http://127.0.0.1:4322",
    "http://localhost:4322",
  ]);
  const providerApiKey = await resolveProviderApiKey();
  if (providerApiKey === "") {
    throw new Error("Set MARCUS_STUDIO_DEEPSEEK_API_KEY in apps/marcus-studio-gateway/.env");
  }
  return {
    host: "127.0.0.1",
    port: integer("MARCUS_STUDIO_PORT", 7_447, 1, 65_535),
    dataDir,
    databasePath: process.env.MARCUS_STUDIO_DATABASE_PATH ?? resolve(dataDir, "studio.sqlite"),
    ...(process.env.MARCUS_LOGS_DIR === undefined ? {} : { logsDir: process.env.MARCUS_LOGS_DIR }),
    allowedOrigins,
    trustProxy: boolean("MARCUS_STUDIO_TRUST_PROXY", true),
    secureCookies: boolean("MARCUS_STUDIO_SECURE_COOKIES", process.env.NODE_ENV === "production"),
    sessionTtlMs: integer("MARCUS_STUDIO_SESSION_TTL_MS", 86_400_000, 60_000, 604_800_000),
    replayTtlMs: integer("MARCUS_STUDIO_REPLAY_TTL_MS", 1_800_000, 60_000, 86_400_000),
    providerBaseUrl: process.env.MARCUS_STUDIO_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    providerApiKey,
    providerModel: process.env.MARCUS_STUDIO_DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    providerTimeoutMs: integer("MARCUS_STUDIO_PROVIDER_TIMEOUT_MS", 90_000, 5_000, 300_000),
    maxConcurrentGenerations: integer("MARCUS_STUDIO_MAX_CONCURRENT", 8, 1, 128),
    dailyLlmCallLimit: integer("MARCUS_STUDIO_DAILY_LLM_CALLS", 1_000, 1, 1_000_000),
    maxOutputTokens: integer("MARCUS_STUDIO_MAX_OUTPUT_TOKENS", STUDIO_LIMITS.maxOutputTokens, 512, STUDIO_LIMITS.maxOutputTokens),
    sessionKey: await loadOrCreateKey(resolve(dataDir, "session.key")),
    eventEncryptionKey: await loadOrCreateKey(resolve(dataDir, "events.key")),
  };
}

async function resolveProviderApiKey(): Promise<string> {
  if (process.env.MARCUS_STUDIO_DEEPSEEK_API_KEY !== undefined) return process.env.MARCUS_STUDIO_DEEPSEEK_API_KEY.trim();
  const path = process.env.MARCUS_STUDIO_DEEPSEEK_API_KEY_FILE;
  if (path === undefined) return "";
  return (await Bun.file(path).text()).trim();
}

async function loadOrCreateKey(path: string): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (await file.exists()) {
    const value = new Uint8Array(await file.arrayBuffer());
    if (value.byteLength !== 32) throw new Error(`Studio key ${path} must contain exactly 32 bytes`);
    return value;
  }
  const value = crypto.getRandomValues(new Uint8Array(32));
  await Bun.write(path, value, { mode: 0o600, createPath: true });
  await chmod(path, 0o600);
  return value;
}

function csv(value: string | undefined, fallback: readonly string[]): string[] {
  const items = value === undefined ? [...fallback] : value.split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(items.map((item) => new URL(item).origin))];
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new Error(`${name} must be true, false, 1 or 0`);
}
