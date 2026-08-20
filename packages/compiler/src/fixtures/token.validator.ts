import { defineAuthValidator } from "@marcus/sdk";

export default defineAuthValidator({
  id: "compiled-token",
  scheme: "bearer",
  async validate(_context, credential) {
    return credential.token === "valid"
      ? { authenticated: true, principal: { id: "external-user", type: "external" } }
      : { authenticated: false, code: "TOKEN_INVALID" };
  },
});
