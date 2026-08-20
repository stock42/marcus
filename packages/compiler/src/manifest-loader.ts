import { isMarcusAgentModule } from "@marcus/sdk";

const validatorMode = process.argv[2] === "--auth-validator";
const artifactPath = process.argv[validatorMode ? 3 : 2];
if (artifactPath === undefined) throw new Error("Artifact path is required");

const imported = (await import(artifactPath)) as Record<string, unknown>;
const candidates = [imported.default, imported.agent, ...Object.values(imported)];
if (validatorMode) {
  const validator = candidates.find((candidate): candidate is { type: "auth-validator"; id: string; scheme: string; validate: Function } => (
    typeof candidate === "object" && candidate !== null
    && (candidate as { type?: unknown }).type === "auth-validator"
    && typeof (candidate as { id?: unknown }).id === "string"
    && typeof (candidate as { scheme?: unknown }).scheme === "string"
    && typeof (candidate as { validate?: unknown }).validate === "function"
  ));
  if (validator === undefined) throw new Error("Artifact exports no Marcus auth validator");
  process.stdout.write(`${JSON.stringify({ type: validator.type, id: validator.id, scheme: validator.scheme })}\n`);
} else {
  const module = candidates.find(isMarcusAgentModule);
  if (module === undefined) throw new Error("Artifact exports no Marcus agent module");
  process.stdout.write(`${JSON.stringify(module.toManifest({ entrypoint: artifactPath }))}\n`);
}
