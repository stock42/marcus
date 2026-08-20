import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defaultProfilesPath, MARCUS_CLI_HELP, resolveUsername, runMarcus } from "./index";

test("help is available without authentication or a network connection", async () => {
  await expect(runMarcus(["--help"])).resolves.toBe(0);
  expect(MARCUS_CLI_HELP).toContain("127.0.0.1:4242");
  expect(MARCUS_CLI_HELP).toContain("username                  admin");
  expect(MARCUS_CLI_HELP).toContain("--password-stdin");
  expect(MARCUS_CLI_HELP).toContain("--bootstrap-token-file");
  expect(MARCUS_CLI_HELP).toContain("~/.marcus/bootstrap.token");
});

test("CLI profiles live inside the unified Marcus home", () => {
  expect(defaultProfilesPath()).toBe(resolve(homedir(), ".marcus", "profiles.json"));
});

test("username defaults to admin and keeps explicit/profile precedence", () => {
  expect(resolveUsername([])).toBe("admin");
  expect(resolveUsername([], { username: "profile-admin" })).toBe("profile-admin");
  expect(resolveUsername(["--user", "operator"], { username: "profile-admin" })).toBe("operator");
  expect(resolveUsername(["--username", "root"], { username: "profile-admin" })).toBe("root");
});

test("non-interactive one-shot requires an explicit password channel", async () => {
  await expect(runMarcus(["127.0.0.1:1", "--command", "doctor"])).rejects.toThrow("--password-stdin");
});
