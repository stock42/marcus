import { MarcusError, type JsonValue, type Principal } from "@marcus/contracts";
import type { MnpRequest } from "@marcus/protocol";
import type { AuthorizationService } from "./authorization";

export interface MarcusSession {
  sessionId: string;
  connectionId: string;
  principal: Principal;
  authenticatedAt: string;
  client: { name: string; version: string; platform?: string };
  selectedProjectId?: string;
}

export interface CommandContext {
  session: MarcusSession;
  request: MnpRequest;
  projectId?: string;
  sourceAddress: string;
}

export type CommandHandler = (context: CommandContext, payload: JsonValue) => JsonValue | Promise<JsonValue>;

export interface CommandDefinition {
  capability: string;
  projectRequired?: boolean;
  mutation?: boolean;
  handler: CommandHandler;
}

export interface CommandAuditEvent {
  context: CommandContext;
  operation: string;
  payload: JsonValue;
  result?: JsonValue;
  error?: unknown;
}

export type CommandAuditHandler = (event: CommandAuditEvent) => void | Promise<void>;
export type CommandGuard = (operation: string, definition: CommandDefinition) => void | Promise<void>;

export class CommandRouter {
  private readonly commands = new Map<string, CommandDefinition>();

  constructor(
    private readonly authorization: AuthorizationService,
    private readonly audit?: CommandAuditHandler,
    private readonly guard?: CommandGuard,
  ) {}

  register(operation: string, definition: CommandDefinition): this {
    if (this.commands.has(operation)) throw new Error(`Operation ${operation} already registered`);
    this.commands.set(operation, definition);
    return this;
  }

  listOperations(): readonly string[] {
    return [...this.commands.keys()].sort();
  }

  async route(session: MarcusSession, request: MnpRequest, sourceAddress: string): Promise<JsonValue> {
    if (request.protocolVersion !== 1) throw new MarcusError({ code: "PROTOCOL_VERSION_UNSUPPORTED", message: "Only MNP/1 is supported", retryable: false });
    if (request.deadlineAt !== undefined && Date.parse(request.deadlineAt) <= Date.now()) {
      throw new MarcusError({ code: "REQUEST_DEADLINE_EXCEEDED", message: "Request deadline has elapsed", retryable: false });
    }
    const command = this.commands.get(request.operation);
    if (command === undefined) throw new MarcusError({ code: "OPERATION_NOT_FOUND", message: `Unknown operation ${request.operation}`, retryable: false });
    const projectId = request.projectId ?? session.selectedProjectId;
    if (command.projectRequired === true && projectId === undefined) {
      throw new MarcusError({ code: "PROJECT_REQUIRED", message: `${request.operation} requires projectId`, retryable: false });
    }
    const context: CommandContext = {
      session,
      request,
      sourceAddress,
      ...(projectId === undefined ? {} : { projectId }),
    };
    try {
      await this.guard?.(request.operation, command);
      this.authorization.assert(session.principal, command.capability, projectId);
      const result = await command.handler(context, request.payload as JsonValue);
      if ((command.mutation ?? isMutationOperation(request.operation)) && this.audit !== undefined) {
        await this.audit({ context, operation: request.operation, payload: request.payload as JsonValue, result });
      }
      return result;
    } catch (error) {
      if ((command.mutation ?? isMutationOperation(request.operation)) && this.audit !== undefined) {
        await this.audit({ context, operation: request.operation, payload: request.payload as JsonValue, error });
      }
      throw error;
    }
  }
}

function isMutationOperation(operation: string): boolean {
  const action = operation.split(".").at(-1) ?? operation;
  return new Set([
    "setup", "create", "register", "update", "archive", "write", "mkdir", "trash", "set", "revoke", "add",
    "delete", "test", "activate", "deactivate", "invoke", "cancel", "kill", "stop", "restart", "commit", "apply",
    "upload", "restore", "move", "copy", "open", "send", "publish", "approve", "reject",
  ]).has(action) || operation === "agents.createFromProjectSource";
}
