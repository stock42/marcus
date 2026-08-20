import { MarcusError, type JsonValue } from "@marcus/contracts";

export interface CliContext {
  projectId?: string;
  projectSlug?: string;
  projectPath: string;
}

export type ParsedCommand =
  | { type: "local"; action: "help" | "exit" | "context" | "clear" }
  | { type: "use-project"; reference: string }
  | { type: "change-directory"; path: string }
  | { type: "upload-file"; localPath: string; projectPath: string }
  | { type: "download-file"; projectPath: string; localPath: string }
  | {
      type: "sync-directory";
      localPath: string;
      projectPath: string;
      watch: boolean;
      delete: boolean;
      dryRun: boolean;
      initial: boolean;
      debounceMs: number;
      ignoreFile?: string;
    }
  | { type: "scaffold-agent"; localPath: string; kind: "sdk" | "markdown" }
  | { type: "bootstrap-setup"; username: string }
  | { type: "configure-default-llm" }
  | { type: "secret-set"; name: string }
  | { type: "user-create"; username: string; systemAdmin: boolean }
  | { type: "validator-test"; reference: string }
  | { type: "request"; operation: string; payload: JsonValue; projectRequired?: boolean; idempotencyKey?: string };

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  let escaping = false;
  for (const character of line.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === "\\") escaping = true;
    else if (quote !== "") {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/u.test(character)) {
      if (current.length > 0) { tokens.push(current); current = ""; }
    } else current += character;
  }
  if (escaping || quote !== "") throw cliError("CLI_PARSE_ERROR", "Unclosed quote or escape sequence");
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseCommand(line: string, context: CliContext): ParsedCommand | undefined {
  const args = tokenize(line);
  if (args.length === 0) return undefined;
  const [noun, verb, ...rest] = args;
  if (noun === "help" || noun === "?") return { type: "local", action: "help" };
  if (noun === "exit" || noun === "quit") return { type: "local", action: "exit" };
  if (noun === "clear") return { type: "local", action: "clear" };
  if (noun === "context" || noun === "pwd") return { type: "local", action: "context" };
  if (noun === "cd") return { type: "change-directory", path: projectPath(required(verb, "Directory path"), context) };
  if (noun === "use" && verb === "project") return { type: "use-project", reference: required(rest[0], "Project reference") };
  if (noun === "doctor") return request("system.doctor", {});
  if (noun === "config" && verb === "default") return { type: "configure-default-llm" };
  if (noun === "bootstrap" && verb === "setup") return { type: "bootstrap-setup", username: required(option(rest, "--username") ?? rest[0], "Administrator username") };
  if (noun === "backup" || noun === "backups") {
    if (verb === "list" || verb === "ls") return request("backups.list", {});
    if (verb === "create") return request("backups.create", { destination: required(option(rest, "--destination") ?? rest[0], "Backup destination") });
    if (verb === "verify") return request("backups.verify", { source: required(rest[0], "Backup source") });
  }
  if (noun === "ls" && context.projectId === undefined) return request("projects.list", {});
  if (noun === "ls") return request("files.list", { path: context.projectPath }, true);

  if (noun === "project" || noun === "projects") {
    if (verb === "list" || verb === "ls") return request("projects.list", {});
    if (verb === "show") return request("projects.get", {}, true);
    if (verb === "update") return request("projects.update", { name: required(option(rest, "--name"), "--name") }, true);
    if (verb === "archive") return request("projects.archive", {}, true);
    if (verb === "members") return request("projectMembers.list", {}, true);
    if (verb === "member-add") return request("projectMembers.add", { user: required(rest[0], "User"), role: required(option(rest, "--role"), "--role") }, true);
    if (verb === "member-remove") return request("projectMembers.remove", { user: required(rest[0], "User") }, true);
    if (verb === "create") {
      const slug = required(rest[0], "Project slug");
      return request("projects.create", { slug, name: option(rest, "--name") ?? slug, mode: option(rest, "--linked") === undefined ? "managed" : "linked", ...(option(rest, "--linked") === undefined ? {} : { physicalPath: option(rest, "--linked")! }) });
    }
  }

  if (noun === "file" || noun === "files") {
    if (verb === "list" || verb === "ls") return request("files.list", { path: projectPath(rest[0] ?? context.projectPath, context) }, true);
    if (verb === "read" || verb === "cat") return request("files.read", { path: projectPath(required(rest[0], "File path"), context) }, true);
    if (verb === "stat") return request("files.stat", { path: projectPath(required(rest[0], "File path"), context) }, true);
    if (verb === "write") return request("files.write", {
      path: projectPath(required(rest[0], "File path"), context),
      content: required(option(rest, "--content"), "--content"),
      ...(option(rest, "--revision") === undefined ? {} : { expectedRevision: numberOption(option(rest, "--revision"), "--revision") }),
    }, true);
    if (verb === "mkdir") return request("files.mkdir", { path: projectPath(required(rest[0], "Directory path"), context) }, true);
    if (verb === "move" || verb === "mv") return request("files.move", { from: projectPath(required(rest[0], "Source path"), context), to: projectPath(required(rest[1], "Destination path"), context) }, true);
    if (verb === "copy" || verb === "cp") return request("files.copy", { from: projectPath(required(rest[0], "Source path"), context), to: projectPath(required(rest[1], "Destination path"), context) }, true);
    if (verb === "trash" || verb === "rm") return request("files.trash", { path: projectPath(required(rest[0], "File path"), context) }, true);
    if (verb === "restore") return request("files.restore", { trashId: required(rest[0], "Trash id") }, true);
    if (verb === "search") return request("files.search", { query: required(rest[0], "Search query") }, true);
    if (verb === "watch") return request("files.watch", { path: projectPath(rest[0] ?? context.projectPath, context), ...(option(rest, "--cursor") === undefined ? {} : { cursor: option(rest, "--cursor")! }) }, true);
  }

  if (noun === "mv") return request("files.move", { from: projectPath(required(verb, "Source path"), context), to: projectPath(required(rest[0], "Destination path"), context) }, true);
  if (noun === "cp") return request("files.copy", { from: projectPath(required(verb, "Source path"), context), to: projectPath(required(rest[0], "Destination path"), context) }, true);

  if (noun === "put") return { type: "upload-file", localPath: localPath(required(verb, "Local path")), projectPath: projectPath(required(rest[0], "Project path"), context) };
  if (noun === "get") return { type: "download-file", projectPath: projectPath(required(verb, "Project path"), context), localPath: localPath(required(rest[0], "Local path")) };
  if (noun === "sync" && (verb === "list" || verb === "ls")) return request("files.sync.list", {}, true);
  if (noun === "sync" && verb === "stop") return request("files.sync.stop", { syncId: required(rest[0], "Sync ID") }, true);
  if (noun === "sync" && verb === "push") {
    const debounceMs = option(rest, "--debounce") === undefined ? 250 : numberOption(option(rest, "--debounce"), "--debounce");
    if (!Number.isInteger(debounceMs) || debounceMs < 10 || debounceMs > 60_000) throw cliError("CLI_ARGUMENT_INVALID", "--debounce must be an integer between 10 and 60000 milliseconds");
    const ignore = option(rest, "--ignore");
    return {
      type: "sync-directory",
      localPath: localPath(required(rest[0], "Local directory")),
      projectPath: projectPath(required(rest[1], "Project path"), context),
      watch: rest.includes("--watch"),
      delete: rest.includes("--delete"),
      dryRun: rest.includes("--dry-run"),
      initial: !rest.includes("--no-initial"),
      debounceMs,
      ...(ignore === undefined ? {} : { ignoreFile: localPath(ignore) }),
    };
  }

  if (noun === "agent" || noun === "agents") {
    if (verb === "list" || verb === "ls") return request("agents.list", {}, true);
    if (verb === "show" || verb === "inspect") return request("agents.get", { agent: required(rest[0], "Agent") }, true);
    if (verb === "versions") return request("agents.versions", { agent: required(rest[0], "Agent") }, true);
    if (verb === "contract") return request("agents.contract", { agent: required(rest[0], "Agent") }, true);
    if (verb === "diff" || verb === "status") return request("agents.diff", { agent: required(rest[0], "Agent") }, true);
    if (verb === "instances") return request("agents.instances", { agent: required(rest[0], "Agent") }, true);
    if (verb === "activate") return request("agents.activate", { agent: required(rest[0], "Agent"), ...(option(rest, "--version") === undefined ? {} : { agentVersionId: option(rest, "--version")! }) }, true);
    if (verb === "disable") return request("agents.disable", { agent: required(rest[0], "Agent") }, true);
    if (verb === "start" || verb === "stop" || verb === "restart") return request(`agents.${verb}`, { agent: required(rest[0], "Agent") }, true);
    if (verb === "scaffold") return { type: "scaffold-agent", localPath: localPath(required(rest[0], "Local directory")), kind: option(rest, "--kind") === "markdown" ? "markdown" : "sdk" };
    if (verb === "apply" && rest[0] !== undefined && !rest[0].includes("/") && !rest[0].endsWith(".ts") && !rest[0].endsWith(".md")) return request("agents.apply", { agent: rest[0] }, true);
    if (["create", "apply", "build"].includes(verb ?? "")) {
      const source = required(rest[0], "Project source path");
      const sourceKind = source.endsWith(".md") ? "markdown" : "sdk";
      return request("agents.createFromProjectSource", { sourcePath: projectPath(source, context), sourceKind, activate: !rest.includes("--no-activate") }, true);
    }
    if (verb === "run" || verb === "invoke") {
      const input = jsonOption(option(rest, "--input") ?? "{}");
      return request("runs.invoke", { agent: required(rest[0], "Agent"), input, ...(option(rest, "--chat-id") === undefined ? {} : { chatId: option(rest, "--chat-id")! }) }, true, option(rest, "--idempotency-key"));
    }
  }

  if (noun === "tool" || noun === "tools") {
    if (verb === "list" || verb === "ls") {
      return request("tools.list", {
        ...(rest[0] === undefined || rest[0].startsWith("--") ? {} : { agent: rest[0] }),
        ...(option(rest, "--version") === undefined ? {} : { agentVersionId: option(rest, "--version")! }),
      }, true);
    }
  }

  if (noun === "schedule" || noun === "schedules") {
    if (verb === "list" || verb === "ls") return request("schedules.list", {}, true);
    if (verb === "trigger") return request("schedules.trigger", { agent: required(rest[0], "Agent"), scheduleId: required(rest[1], "Schedule ID"), ...(option(rest, "--input") === undefined ? {} : { input: jsonOption(option(rest, "--input")!) }) }, true);
  }

  if (noun === "run" || noun === "runs") {
    if (verb === "list" || verb === "ls") return request("runs.list", { ...(option(rest, "--limit") === undefined ? {} : { limit: numberOption(option(rest, "--limit"), "--limit") }) }, true);
    if (verb === "show") return request("runs.get", { runId: required(rest[0], "Run ID") }, true);
    if (verb === "cancel" || verb === "kill") return request("runs.cancel", { runId: required(rest[0], "Run ID") }, true);
    if (verb === "graph") return request("runs.graph", { runId: required(rest[0], "Run ID") }, true);
    if (verb === "checkpoints") return request("runs.checkpoints", { runId: required(rest[0], "Run ID") }, true);
    if (verb === "attach") return request("runs.attach", { runId: required(rest[0], "Run ID"), ...(option(rest, "--after") === undefined ? {} : { afterEventSeq: numberOption(option(rest, "--after"), "--after") }) }, true);
  }

  if (noun === "ps") return request("processes.list", { ...(option(args.slice(1), "--state") === undefined ? {} : { state: option(args.slice(1), "--state")! }), includeTerminal: args.includes("--all") }, context.projectId !== undefined);
  if (noun === "top") return request("processes.top", {}, context.projectId !== undefined);
  if (noun === "process" && verb === "show") return request("processes.get", { mpid: required(rest[0], "MPID") }, context.projectId !== undefined);
  if (noun === "process" && verb === "kill") return request("processes.kill", { mpid: required(rest[0], "MPID") }, context.projectId !== undefined);
  if (noun === "process" && verb === "attach") return request("processes.attach", { mpid: required(rest[0], "MPID"), ...(option(rest, "--after") === undefined ? {} : { afterEventSeq: numberOption(option(rest, "--after"), "--after") }) }, true);

  if (noun === "provider" || noun === "providers") {
    if (verb === "list" || verb === "ls") return request("providers.list", {});
    if (verb === "add") return request("providers.add", { name: required(rest[0], "Provider name"), type: option(rest, "--type") ?? "openai-compatible", baseUrl: required(option(rest, "--base-url"), "--base-url"), secretRefs: option(rest, "--secret-ref") === undefined ? [] : [option(rest, "--secret-ref")!] });
    if (verb === "test") return request("providers.test", { provider: required(rest[0], "Provider") });
    if (verb === "models") return request("providers.models", { provider: required(rest[0], "Provider") });
  }
  if (noun === "role" || noun === "roles") {
    if (verb === "list" || verb === "ls") return request("modelRoles.list", {});
    if (verb === "set") return request("modelRoles.set", { role: required(rest[0], "Role"), provider: required(option(rest, "--provider"), "--provider"), model: required(option(rest, "--model"), "--model") });
    if (verb === "delete" || verb === "rm") return request("modelRoles.delete", { role: required(rest[0], "Role") });
  }
  if (noun === "secret" || noun === "secrets") {
    if (verb === "list" || verb === "ls") return request("secrets.list", {}, context.projectId !== undefined);
    if (verb === "show") return request("secrets.show", { name: required(rest[0], "Secret name") }, context.projectId !== undefined);
    if (verb === "set") return { type: "secret-set", name: required(rest[0], "Secret name") };
    if (verb === "revoke") return request("secrets.revoke", { name: required(rest[0], "Secret name") }, context.projectId !== undefined);
  }
  if (noun === "validator" || noun === "validators") {
    if (verb === "list" || verb === "ls") return request("authValidators.list", {}, true);
    if (verb === "show") return request("authValidators.get", { validator: required(rest[0], "Validator") }, true);
    if (verb === "versions") return request("authValidators.versions", { validator: required(rest[0], "Validator") }, true);
    if (verb === "create" || verb === "apply" || verb === "build") return request("authValidators.createFromProjectSource", { sourcePath: projectPath(required(rest[0], "Validator source path"), context), activate: !rest.includes("--no-activate") }, true);
    if (verb === "activate") return request("authValidators.activate", { validator: required(rest[0], "Validator"), ...(option(rest, "--version") === undefined ? {} : { validatorVersionId: option(rest, "--version")! }) }, true);
    if (verb === "disable") return request("authValidators.disable", { validator: required(rest[0], "Validator") }, true);
    if (verb === "test") return { type: "validator-test", reference: required(rest[0], "Validator") };
  }
  if (noun === "user" || noun === "users") {
    if (verb === "list" || verb === "ls") return request("users.list", {});
    if (verb === "create") return { type: "user-create", username: required(rest[0], "Username"), systemAdmin: rest.includes("--system-admin") };
    if (verb === "disable") return request("users.disable", { user: required(rest[0], "User") });
  }
  if (noun === "token" || noun === "tokens") {
    if (verb === "list" || verb === "ls") return request("tokens.list", {});
    if (verb === "create") return request("tokens.create", { type: rest.includes("--service-account") ? "service-account-token" : "personal-access-token", ...(option(rest, "--user") === undefined ? {} : { user: option(rest, "--user")! }), scopes: (option(rest, "--scopes") ?? "").split(",").filter(Boolean) });
    if (verb === "revoke") return request("tokens.revoke", { tokenId: required(rest[0], "Token ID") });
  }
  if (noun === "artifact" || noun === "artifacts") return request("artifacts.list", { ...(option(rest, "--run") === undefined ? {} : { runId: option(rest, "--run")! }) }, true);
  if (noun === "conversation" || noun === "conversations") {
    if (verb === "list" || verb === "ls") return request("conversations.list", {}, true);
    if (verb === "show") return request("conversations.get", { conversationId: required(rest[0], "Conversation ID") }, true);
    if (verb === "messages") return request("conversations.messages", { conversationId: required(rest[0], "Conversation ID") }, true);
    if (verb === "clear") return request("conversations.clear", { conversationId: required(rest[0], "Conversation ID") }, true);
  }
  if (noun === "events") return request("events.list", {}, true);
  if (noun === "logs") return request("logs.list", { ...(option(args.slice(1), "--run") === undefined ? {} : { runId: option(args.slice(1), "--run")! }), ...(option(args.slice(1), "--agent") === undefined ? {} : { agentId: option(args.slice(1), "--agent")! }), ...(option(args.slice(1), "--mpid") === undefined ? {} : { mpid: option(args.slice(1), "--mpid")! }) }, true);
  if (noun === "audit") return request("audit.list", {}, true);
  if (noun === "approvals") return request("approvals.list", { ...(option(rest, "--status") === undefined ? {} : { status: option(rest, "--status")! }) }, true);
  if (noun === "approval" && (verb === "approve" || verb === "reject")) return request("approvals.decide", { approvalId: required(rest[0], "Approval ID"), decision: verb }, true);
  throw cliError("CLI_COMMAND_UNKNOWN", `Unknown command: ${args.join(" ")}`);
}

export function projectPath(input: string, context: CliContext): string {
  if (input.startsWith("local:") || input.startsWith("server:")) return input;
  if (input.startsWith("project:")) return input;
  const current = context.projectPath.replace(/^project:\/?/u, "").replace(/\/$/u, "");
  const relative = [current, input].filter(Boolean).join("/");
  return `project:/${normalizeLogical(relative)}`;
}

function normalizeLogical(value: string): string {
  const output: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (output.length === 0) throw cliError("CLI_PATH_ESCAPE", "Path escapes Project root");
      output.pop();
    } else output.push(part);
  }
  return output.join("/");
}

function localPath(value: string): string { return value.startsWith("local:") ? value.slice("local:".length) : value; }

function request(operation: string, payload: JsonValue, projectRequired = false, idempotencyKey?: string): ParsedCommand {
  return { type: "request", operation, payload, ...(projectRequired ? { projectRequired: true } : {}), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
}
function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function required(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) throw cliError("CLI_ARGUMENT_REQUIRED", `${label} is required`);
  return value;
}
function numberOption(value: string | undefined, label: string): number {
  const parsed = Number(required(value, label));
  if (!Number.isFinite(parsed)) throw cliError("CLI_ARGUMENT_INVALID", `${label} must be a number`);
  return parsed;
}
function jsonOption(value: string): JsonValue {
  try { return JSON.parse(value) as JsonValue; }
  catch { throw cliError("CLI_JSON_INVALID", "--input must be valid JSON"); }
}
function cliError(code: string, message: string): MarcusError { return new MarcusError({ code, message, retryable: false }); }
