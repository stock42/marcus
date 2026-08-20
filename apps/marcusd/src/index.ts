import { dirname, resolve } from "node:path";
import { MarcusDaemon, defaultMarcusdConfig, restoreMarcusBackup, verifyMarcusBackup, type MarcusdConfig } from "@marcus/service";

export interface MarcusdLoadOptions {
  environment?: Record<string, string | undefined>;
  executablePath?: string;
}

export async function runMarcusd(argv = process.argv.slice(2)): Promise<MarcusDaemon> {
  const config = await loadMarcusdConfig(argv);
  const daemon = await MarcusDaemon.start(config);
  const address = daemon.address();
  process.stdout.write(`${JSON.stringify({
    level: "info",
    event: "marcusd.ready",
    nodeId: daemon.config.nodeId,
    address,
    bootstrapMode: daemon.config.bootstrap?.token !== undefined,
    ...(daemon.config.bootstrap?.tokenFile === undefined ? {} : { bootstrapTokenFile: daemon.config.bootstrap.tokenFile }),
  })}\n`);
  const shutdown = async () => { await daemon.close(); process.exit(0); };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  return daemon;
}

export async function loadMarcusdConfig(argv = process.argv.slice(2), options: MarcusdLoadOptions = {}): Promise<MarcusdConfig> {
  const environment = options.environment ?? process.env;
  const configPath = valueAfter(argv, "--config");
  const base = defaultMarcusdConfig();
  const fileConfig = configPath === undefined ? {} : await Bun.file(resolve(configPath)).json() as Partial<MarcusdConfig>;
  const installedExecutables = await detectInstalledExecutables(options.executablePath ?? process.execPath);
  const listen = valueAfter(argv, "--listen");
  const bootstrapTokenFile = valueAfter(argv, "--bootstrap-token-file");
  const secretsKeyFile = valueAfter(argv, "--secrets-key-file");
  const bootstrapToken = bootstrapTokenFile === undefined ? undefined : (await Bun.file(resolve(bootstrapTokenFile)).text()).trim();
  return {
    ...base,
    ...fileConfig,
    listen: { ...base.listen, ...fileConfig.listen, ...(listen === undefined ? {} : parseListen(listen)) },
    secrets: {
      ...base.secrets,
      ...fileConfig.secrets,
      ...(environment.MARCUS_SECRETS_MASTER_KEY === undefined ? {} : { masterKey: environment.MARCUS_SECRETS_MASTER_KEY }),
      ...(secretsKeyFile === undefined ? {} : { keyFile: resolve(secretsKeyFile) }),
    },
    bootstrap: {
      ...base.bootstrap,
      ...fileConfig.bootstrap,
      ...(bootstrapToken === undefined ? {} : { token: bootstrapToken, tokenFile: resolve(bootstrapTokenFile!) }),
    },
    ...(fileConfig.runtimeHostExecutable !== undefined ? {} : installedExecutables.runtimeHostExecutable === undefined ? {} : { runtimeHostExecutable: installedExecutables.runtimeHostExecutable }),
    ...(fileConfig.agentProcessExecutable !== undefined ? {} : installedExecutables.agentProcessExecutable === undefined ? {} : { agentProcessExecutable: installedExecutables.agentProcessExecutable }),
    ...(fileConfig.manifestLoaderExecutable !== undefined ? {} : installedExecutables.manifestLoaderExecutable === undefined ? {} : { manifestLoaderExecutable: installedExecutables.manifestLoaderExecutable }),
    ...(environment.MARCUS_RUNTIME_HOST_EXECUTABLE === undefined ? {} : { runtimeHostExecutable: resolve(environment.MARCUS_RUNTIME_HOST_EXECUTABLE) }),
    ...(environment.MARCUS_AGENT_PROCESS_EXECUTABLE === undefined ? {} : { agentProcessExecutable: resolve(environment.MARCUS_AGENT_PROCESS_EXECUTABLE) }),
    ...(environment.MARCUS_MANIFEST_LOADER_EXECUTABLE === undefined ? {} : { manifestLoaderExecutable: resolve(environment.MARCUS_MANIFEST_LOADER_EXECUTABLE) }),
    ...(argv.includes("--force-recover") ? { forceRecover: true } : {}),
  };
}

async function detectInstalledExecutables(executablePath: string): Promise<Pick<MarcusdConfig, "runtimeHostExecutable" | "agentProcessExecutable" | "manifestLoaderExecutable">> {
  const executableDirectory = dirname(executablePath);
  const extension = process.platform === "win32" ? ".exe" : "";
  const directories = [executableDirectory, resolve(executableDirectory, "..", "lib", "marcus")];
  const resolved: Pick<MarcusdConfig, "runtimeHostExecutable" | "agentProcessExecutable" | "manifestLoaderExecutable"> = {};
  for (const [field, name] of [
    ["runtimeHostExecutable", `marcus-runtime-host${extension}`],
    ["agentProcessExecutable", `marcus-agent-process${extension}`],
    ["manifestLoaderExecutable", `marcus-manifest-loader${extension}`],
  ] as const) {
    for (const directory of directories) {
      const candidate = resolve(directory, name);
      if (await Bun.file(candidate).exists()) {
        resolved[field] = candidate;
        break;
      }
    }
  }
  return resolved;
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function parseListen(value: string): Pick<MarcusdConfig["listen"], "host" | "port"> {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) throw new Error("--listen must be host:port");
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("--listen port is invalid");
  return { host: value.slice(0, separator), port };
}

if (import.meta.main) {
  const restoreSource = valueAfter(process.argv.slice(2), "--restore");
  const verifySource = valueAfter(process.argv.slice(2), "--verify-backup");
  if (restoreSource !== undefined) {
    const result = await restoreMarcusBackup(await loadMarcusdConfig(), restoreSource);
    process.stdout.write(`${JSON.stringify({ level: "info", event: "marcusd.restore.completed", ...result })}\n`);
  } else if (verifySource !== undefined) {
    const manifest = await verifyMarcusBackup(verifySource);
    process.stdout.write(`${JSON.stringify({ level: "info", event: "marcusd.backup.verified", manifest })}\n`);
  } else await runMarcusd();
}
