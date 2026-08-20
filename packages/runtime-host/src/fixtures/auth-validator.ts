import { defineAuthValidator } from "@marcus/sdk";

export default defineAuthValidator({
  id: "runtime-validator",
  scheme: "bearer",
  async validate(_context, credential) {
    return credential.token === "accepted"
      ? { authenticated: true, principal: { id: "registered-external", type: "external" } }
      : { authenticated: false, code: "AUTH_REGISTERED_REJECTED" };
  },
});
