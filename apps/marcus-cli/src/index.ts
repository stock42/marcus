import { createMnpCli } from "@marcus/cli";
import type { MnpAuthentication } from "@marcus/protocol";
import { homedir } from "node:os";
import { resolve } from "node:path";

type CliProfile = { host: string; port: number; tls?: boolean; caFile?: string; serverName?: string; username?: string; tokenFile?: string; tokenEnv?: string; json?: boolean; connectTimeoutMs?: number; requestTimeoutMs?: number };

export const MARCUS_CLI_HELP = `Marcus CLI

Usage:
  marcus [host:port] [options]

Defaults:
  host:port                 127.0.0.1:4242
  username                  admin

Options:
  --profile <name>          Load connection settings from a named profile
  --username, --user <name> Authenticate with a username (default: admin)
  --password-stdin          Read the password from standard input
  --token-stdin             Read a personal access token from standard input
  --token <token>           Authenticate with a personal access token
  --bootstrap-token-file <path>
                            Read the one-time bootstrap token from a file
  --bootstrap-token <token> Authenticate with a one-time bootstrap token
  --service-account         Treat token authentication as a service account
  --command <command>       Run one command instead of opening the REPL
  --json                    Render output as JSON
  -h, --help                Show this help

Examples:
  marcus
  marcus 127.0.0.1:4242 --username admin
  marcus --bootstrap-token-file ~/.marcus/bootstrap.token \\
    --command 'bootstrap setup --username admin'
`;

export async function runMarcus(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(MARCUS_CLI_HELP);
    return 0;
  }
  const profile = await loadProfile(option(argv, "--profile"));
  const endpoint = positionalEndpoint(argv) ?? (profile === undefined ? "127.0.0.1:4242" : `${profile.host}:${profile.port}`);
  const separator = endpoint.lastIndexOf(":");
  if (separator <= 0) throw new Error("Endpoint must be host:port");
  const authentication = await resolveAuthentication(argv, profile);
  const tls = profile?.tls === true
    ? { ...(profile.caFile === undefined ? {} : { ca: await Bun.file(resolve(profile.caFile)).text() }), ...(profile.serverName === undefined ? {} : { serverName: profile.serverName }) }
    : undefined;
  const cli = createMnpCli({
    hostname: endpoint.slice(0, separator),
    port: Number(endpoint.slice(separator + 1)),
    authentication,
    ...(tls === undefined ? {} : { tls }),
    ...(profile?.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: profile.connectTimeoutMs }),
    ...(profile?.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: profile.requestTimeoutMs }),
    client: { name: "marcus-cli", version: "0.1.0", platform: process.platform },
    json: argv.includes("--json") || profile?.json === true,
  });
  const commandIndex = argv.indexOf("--command");
  if (commandIndex >= 0) {
    try {
      const result = await cli.execute(argv[commandIndex + 1] ?? "");
      if (result !== undefined) cli.render(result);
      return 0;
    } catch (error) {
      cli.renderError(error);
      return exitCode(error);
    } finally {
      cli.close();
    }
  }
  await cli.repl();
  return 0;
}

async function resolveAuthentication(argv: readonly string[], profile?: CliProfile): Promise<MnpAuthentication> {
  const bootstrap = option(argv, "--bootstrap-token");
  if (bootstrap !== undefined) return { method: "bootstrap-token", token: bootstrap };
  const bootstrapFile = option(argv, "--bootstrap-token-file");
  if (bootstrapFile !== undefined) return { method: "bootstrap-token", token: (await Bun.file(resolve(bootstrapFile)).text()).trim() };
  const token = option(argv, "--token");
  if (token !== undefined) return { method: argv.includes("--service-account") ? "service-account-token" : "personal-access-token", token };
  if (argv.includes("--token-stdin")) return { method: argv.includes("--service-account") ? "service-account-token" : "personal-access-token", token: await readStdinValue("token") };
  if (profile?.tokenFile !== undefined) return { method: argv.includes("--service-account") ? "service-account-token" : "personal-access-token", token: (await Bun.file(resolve(profile.tokenFile)).text()).trim() };
  if (profile?.tokenEnv !== undefined) {
    const value = process.env[profile.tokenEnv];
    if (value === undefined) throw new Error(`Profile token environment variable ${profile.tokenEnv} is not set`);
    return { method: argv.includes("--service-account") ? "service-account-token" : "personal-access-token", token: value };
  }
  const username = resolveUsername(argv, profile);
  const password = argv.includes("--password-stdin")
    ? await readStdinValue("password")
    : await readHiddenPassword(username);
  return { method: "username-password", username, password };
}

export function resolveUsername(argv: readonly string[], profile?: Pick<CliProfile, "username">): string {
  return option(argv, "--username") ?? option(argv, "--user") ?? profile?.username ?? "admin";
}

async function readHiddenPassword(username: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("Use --password-stdin for non-interactive password authentication");
  process.stdout.write(`Password for "${username}" (press Enter to connect): `);
  const previous = process.stdin.isRaw;
  const wasFlowing = process.stdin.readableFlowing === true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(previous);
      if (!wasFlowing) process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { cleanup(); reject(new Error("Password input cancelled")); return; }
        if (character === "\r" || character === "\n") { cleanup(); value.length === 0 ? reject(new Error("password input is empty")) : resolve(value); return; }
        if (character === "\b" || character === "\u007f") value = [...value].slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readStdinValue(label: string): Promise<string> {
  const value = (await new Response(Bun.stdin.stream()).text()).replace(/\r?\n$/u, "");
  if (value.length === 0) throw new Error(`${label} input is empty`);
  return value;
}

async function loadProfile(name: string | undefined): Promise<CliProfile | undefined> {
  if (name === undefined) return undefined;
  const configFile = process.env.MARCUS_CLI_PROFILES ?? defaultProfilesPath();
  const parsed = await Bun.file(configFile).json() as Record<string, unknown>;
  const profiles = (typeof parsed.profiles === "object" && parsed.profiles !== null ? parsed.profiles : parsed) as Record<string, CliProfile>;
  const profile = profiles?.[name];
  if (profile === undefined || typeof profile.host !== "string" || !Number.isInteger(profile.port)) throw new Error(`Marcus profile ${name} is missing or invalid`);
  return profile;
}

export function defaultProfilesPath(): string {
  return resolve(homedir(), ".marcus", "profiles.json");
}

function positionalEndpoint(argv: readonly string[]): string | undefined {
  const valued = new Set(["--profile", "--command", "--bootstrap-token", "--bootstrap-token-file", "--token", "--username", "--user"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (valued.has(argv[index]!)) { index += 1; continue; }
    if (!argv[index]!.startsWith("-")) return argv[index];
  }
  return undefined;
}

function exitCode(error: unknown): number {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code.startsWith("MNP_CONNECT") || code.includes("SOCKET")) return 3;
  if (code.startsWith("AUTH_")) return 4;
  if (code.startsWith("RBAC_")) return 5;
  if (code.includes("INVALID") || code.includes("BUILD")) return 6;
  if (code.endsWith("NOT_FOUND")) return 7;
  if (code.includes("CONFLICT")) return 8;
  if (code.includes("TIMEOUT") || code.includes("DEADLINE")) return 9;
  return 1;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

if (import.meta.main) process.exitCode = await runMarcus();
