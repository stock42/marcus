// The process profile executes the same runtime engine in a dedicated Bun
// process. This transport shim preserves the Runtime Host protocol while the
// operating system process itself is the isolation and termination boundary.
type ProcessScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

export {};

const scope: ProcessScope = {
  onmessage: null,
  postMessage(message) {
    process.send?.(message);
  },
  close() {
    process.exit(0);
  },
};

Object.defineProperty(globalThis, "self", { value: scope, configurable: true });
process.on("message", (data: unknown) => scope.onmessage?.({ data } as MessageEvent<unknown>));
process.on("disconnect", () => scope.close());
await import("./worker-entry");
