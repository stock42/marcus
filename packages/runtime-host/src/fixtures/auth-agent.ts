import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "auth-runtime-test",
  name: "Authentication Runtime Test",
  input: m.object({ value: m.string() }),
  output: m.object({ value: m.string() }),
  entrypoints: {
    api: {
      enabled: true,
      authentication: {
        type: "custom",
        scheme: "test",
        validate: async (_context, credential) => credential.token === "accepted"
          ? { authenticated: true, principal: { id: "external-test", type: "external" } }
          : { authenticated: false, code: "AUTH_REJECTED" },
      },
    },
  },
  async onStart() {
    throw new Error("general lifecycle must not run during authentication");
  },
  async onRun(_context, input) {
    return input;
  },
});
