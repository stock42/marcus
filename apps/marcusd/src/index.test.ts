import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { defaultMarcusdConfig } from "@marcus/service";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadMarcusdConfig } from "./index";

test("daemon defaults use one stable user home and bind insecure MNP only to loopback", () => {
  const userConfig = defaultMarcusdConfig();
  expect(userConfig.dataDir).toBe(resolve(homedir(), ".marcus"));
  expect(userConfig.databasePath).toBe(resolve(homedir(), ".marcus", "kernel.db"));
  expect(userConfig.secrets.keyFile).toBe(resolve(homedir(), ".marcus", "secrets.key"));
  expect(userConfig.logsDir).toBe(resolve(homedir(), ".marcus", "logs"));
  expect(userConfig.bootstrap?.tokenFile).toBe(resolve(homedir(), ".marcus", "bootstrap.token"));

  const config = defaultMarcusdConfig("/tmp/marcus-config-test");
  expect(config.listen.host).toBe("127.0.0.1");
  expect(config.listen.tls).toBe("disabled-loopback");
});

test("installed daemon discovers its internal release executables", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "marcusd-installed-"));
  const bin = resolve(root, "bin");
  const lib = resolve(root, "lib/marcus");
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(lib, { recursive: true });
    for (const name of ["marcus-runtime-host", "marcus-agent-process", "marcus-manifest-loader"]) await Bun.write(resolve(lib, name), name);
    const config = await loadMarcusdConfig([], { environment: {}, executablePath: resolve(bin, "marcusd") });
    expect(config.runtimeHostExecutable).toBe(resolve(lib, "marcus-runtime-host"));
    expect(config.agentProcessExecutable).toBe(resolve(lib, "marcus-agent-process"));
    expect(config.manifestLoaderExecutable).toBe(resolve(lib, "marcus-manifest-loader"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
