import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiskArtifactStore, DiskProjectFileStore, ProjectPathResolver } from "./index";

const cleanup: string[] = [];

afterEach(async () => {
  while (cleanup.length > 0) await rm(cleanup.pop()!, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "marcus-files-test-"));
  cleanup.push(directory);
  return directory;
}

describe("ProjectPathResolver", () => {
  test("normalizes logical paths and rejects traversal variants", async () => {
    const home = await temporaryDirectory();
    const resolver = new ProjectPathResolver(home, { projectSlug: "demo" });
    expect(resolver.resolve("project://demo/agents/hello.ts").relativePath).toBe("agents/hello.ts");
    for (const invalid of ["project:/../etc/passwd", "project:/%2e%2e/etc", "/etc/passwd", "C:\\Windows\\x", "file:///etc/passwd"] ) {
      expect(() => resolver.resolve(invalid)).toThrow();
    }
    expect(() => resolver.resolve("project:/.marcus/kernel.db")).toThrow("reserved");
  });

  test("rejects external symlinks and allows contained symlinks", async () => {
    const root = await temporaryDirectory();
    const home = join(root, "home");
    const outside = join(root, "outside");
    await mkdir(home);
    await mkdir(outside);
    await mkdir(join(home, "inside"));
    await symlink(outside, join(home, "external"));
    await symlink(join(home, "inside"), join(home, "internal"));
    const resolver = new ProjectPathResolver(home);
    expect(() => resolver.resolve("external")).toThrow("escapes");
    expect(resolver.resolve("internal").relativePath).toBe("internal");
  });
});

describe("DiskProjectFileStore", () => {
  test("writes atomically and enforces optimistic revision", async () => {
    const home = await temporaryDirectory();
    const store = new DiskProjectFileStore({ projectId: "prj-1", projectSlug: "demo", homePath: home });
    await store.initialize();
    const created = await store.write("project:/docs/readme.md", "first", { expectedRevision: 0, actorId: "user-1" });
    expect(created.revision).toBe(1);
    expect(await Bun.file(join(home, "docs/readme.md")).text()).toBe("first");
    await expect(store.write("project:/docs/readme.md", "stale", { expectedRevision: 0 })).rejects.toThrow(
      "Expected revision",
    );
    const updated = await store.write("project:/docs/readme.md", "second", { expectedRevision: 1 });
    expect(updated.revision).toBe(2);
    expect(new TextDecoder().decode(await store.read("project:/docs/readme.md"))).toBe("second");
  });

  test("serializes concurrent compare-and-swap writes before replacing bytes", async () => {
    const home = await temporaryDirectory();
    const store = new DiskProjectFileStore({ projectId: "prj-1", projectSlug: "demo", homePath: home });
    await store.initialize();
    await store.write("state.txt", "initial", { expectedRevision: 0 });
    const results = await Promise.allSettled([
      store.write("state.txt", "first", { expectedRevision: 1 }),
      store.write("state.txt", "second", { expectedRevision: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(new TextDecoder().decode(await store.read("state.txt"))).toBe("first");
  });

  test("moves deletion to reserved trash by default", async () => {
    const home = await temporaryDirectory();
    const store = new DiskProjectFileStore({ projectId: "prj-1", projectSlug: "demo", homePath: home });
    await store.initialize();
    await store.write("notes.txt", "recoverable");
    const entry = await store.trash("notes.txt", "user-1");
    expect(await Bun.file(join(home, entry.storedPath)).text()).toBe("recoverable");
    expect(await Bun.file(join(home, "notes.txt")).exists()).toBe(false);
  });

  test("copies, moves, restores, and reconciles externally changed files", async () => {
    const home = await temporaryDirectory();
    const store = new DiskProjectFileStore({ projectId: "prj-1", projectSlug: "demo", homePath: home });
    await store.initialize();
    await store.write("agents/source.txt", "v1");
    await store.copy("agents", "copies");
    expect(new TextDecoder().decode(await store.read("copies/source.txt"))).toBe("v1");
    await store.move("copies", "moved");
    expect(new TextDecoder().decode(await store.read("moved/source.txt"))).toBe("v1");
    const trashed = await store.trash("moved/source.txt", "user-1");
    const restored = await store.restore(trashed.storedPath, trashed.originalPath, "user-1");
    expect(restored.relativePath).toBe("moved/source.txt");
    expect(new TextDecoder().decode(await store.read("moved/source.txt"))).toBe("v1");

    await Bun.write(join(home, "agents/source.txt"), "v2");
    const reconciliation = await store.reconcile();
    expect(reconciliation.changed).toBeGreaterThan(0);
    expect((await store.stat("agents/source.txt")).source).toBe("external-watcher");
  });
});

test("ArtifactStore creates directories and records provenance", async () => {
  const home = await temporaryDirectory();
  const store = new DiskArtifactStore(home, { now: () => new Date("2026-08-11T00:00:00Z") });
  const artifact = await store.create({
    projectId: "prj-1",
    agentId: "agt-1",
    agentVersionId: "av-1",
    runId: "run-1",
    name: "../report.txt",
    mediaType: "text/plain",
    bytes: "report",
  });
  expect(artifact.name).toBe("report.txt");
  expect(artifact.visibility).toBe("private");
  expect(new TextDecoder().decode(await store.read(artifact))).toBe("report");
});
