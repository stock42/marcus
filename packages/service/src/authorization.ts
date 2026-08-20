import { MarcusError, type Principal } from "@marcus/contracts";
import type { MarcusSqliteDatabase } from "@marcus/storage-sqlite";

const projectRoleCapabilities: Readonly<Record<string, readonly string[]>> = {
  project_owner: ["projects.read", "projects.update", "files.read", "files.write", "agents.read", "agents.create", "agents.activate", "agents.start", "agents.kill", "runs.read", "runs.invoke", "runs.cancel", "providers.manage", "secrets.manage", "audit.read"],
  project_operator: ["projects.read", "files.read", "agents.read", "agents.start", "agents.kill", "runs.read", "runs.invoke", "runs.cancel", "audit.read"],
  project_developer: ["projects.read", "files.read", "files.write", "agents.read", "agents.create", "agents.activate", "runs.read", "runs.invoke", "runs.cancel"],
  project_viewer: ["projects.read", "files.read", "agents.read", "runs.read"],
};

export class AuthorizationService {
  constructor(private readonly database: MarcusSqliteDatabase) {}

  assert(principal: Principal, capability: string, projectId?: string): void {
    const tokenProjectId = typeof principal.claims?.tokenProjectId === "string" ? principal.claims.tokenProjectId : undefined;
    if (tokenProjectId !== undefined) {
      if (projectId === tokenProjectId && (principal.scopes?.includes("*") || principal.scopes?.includes(capability))) return;
      throw new MarcusError({ code: "RBAC_FORBIDDEN", message: `Project token cannot access ${projectId ?? "global operations"}`, retryable: false });
    }
    if (principal.scopes?.includes("*") || principal.scopes?.includes(capability)) return;
    const roles = String(principal.claims?.systemRoles ?? "").split(",");
    if (roles.includes("system_admin")) return;
    if (capability === "projects.read" && projectId === undefined && principal.type === "user") return;
    if (projectId !== undefined && principal.type === "user") {
      const row = this.database.raw
        .query<{ role: string }, [string, string]>("SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?")
        .get(projectId, principal.id);
      if (row !== null && projectRoleCapabilities[row.role]?.includes(capability)) return;
    }
    throw new MarcusError({ code: "RBAC_FORBIDDEN", message: `Missing capability ${capability}`, retryable: false });
  }
}
