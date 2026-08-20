import { MarcusError, createId, type Principal } from "@marcus/contracts";
import type { MnpAuthentication } from "@marcus/protocol";
import type { MarcusSqliteDatabase } from "@marcus/storage-sqlite";

export type SystemRole = "system_admin" | "service_account";
export type ProjectRole = "project_owner" | "project_operator" | "project_developer" | "project_viewer";

export const PASSWORD_POLICY_DESCRIPTION = "Password must contain at least 6 characters, one uppercase letter, and one of $ % # ! & *";

type UserRow = { user_id: string; username: string; password_hash: string | null; status: "active" | "disabled" };
type TokenRow = {
  token_id: string;
  user_id: string | null;
  project_id: string | null;
  label: string | null;
  token_type: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export interface AuthenticationServiceOptions {
  bootstrapToken?: string;
  now?: () => Date;
  maxFailures?: number;
  failureWindowMs?: number;
  backoffMs?: number;
}

export interface AuthenticatedPrincipal {
  principal: Principal;
  permissions: readonly string[];
}

export class AuthenticationService {
  private readonly database: MarcusSqliteDatabase;
  private readonly now: () => Date;
  private readonly options: Required<Pick<AuthenticationServiceOptions, "maxFailures" | "failureWindowMs" | "backoffMs">> &
    AuthenticationServiceOptions;
  private readonly failures = new Map<string, { count: number; startedAt: number; blockedUntil: number }>();
  private bootstrapUsed = false;

  constructor(database: MarcusSqliteDatabase, options: AuthenticationServiceOptions = {}) {
    this.database = database;
    this.now = options.now ?? (() => new Date());
    this.options = {
      maxFailures: options.maxFailures ?? 5,
      failureWindowMs: options.failureWindowMs ?? 60_000,
      backoffMs: options.backoffMs ?? 5_000,
      ...options,
    };
  }

  async createUser(input: {
    username: string;
    password?: string;
    roles?: readonly SystemRole[];
    project?: { projectId: string; role: ProjectRole };
  }): Promise<Principal> {
    assertUsername(input.username);
    if (input.password !== undefined) assertPasswordPolicy(input.password);
    if ((this.database.raw.query<{ value: number }, [string]>("SELECT COUNT(*) AS value FROM users WHERE username=?").get(input.username)?.value ?? 0) !== 0) {
      throw authError("AUTH_USERNAME_TAKEN", `Username ${input.username} already exists`);
    }
    const userId = createId("user");
    const now = this.now().toISOString();
    const passwordHash = input.password === undefined ? null : await Bun.password.hash(input.password);
    this.database.transaction(() => {
      this.database.raw
        .query("INSERT INTO users(user_id, username, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
        .run(userId, input.username, passwordHash, now, now);
      for (const role of input.roles ?? []) {
        this.database.raw.query("INSERT INTO user_roles(user_id, role, created_at) VALUES (?, ?, ?)").run(userId, role, now);
      }
      if (input.project !== undefined) {
        this.database.raw.query("INSERT INTO project_memberships(project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
          .run(input.project.projectId, userId, input.project.role, now);
      }
    });
    return { id: userId, type: "user", claims: { username: input.username, systemRoles: input.roles?.join(",") ?? "" } };
  }

  async changePassword(userId: string, currentPassword: string, password: string): Promise<void> {
    const user = this.database.raw
      .query<UserRow, [string]>("SELECT user_id, username, password_hash, status FROM users WHERE user_id=?")
      .get(userId);
    if (user === null || user.status !== "active" || user.password_hash === null || !(await Bun.password.verify(currentPassword, user.password_hash))) {
      throw authError("AUTH_CURRENT_PASSWORD_INVALID", "Current password is invalid");
    }
    assertPasswordPolicy(password);
    const passwordHash = await Bun.password.hash(password);
    this.database.raw.query("UPDATE users SET password_hash=?, updated_at=? WHERE user_id=?")
      .run(passwordHash, this.now().toISOString(), userId);
  }

  async updateProjectUser(input: {
    projectId: string;
    userId: string;
    username: string;
    role: ProjectRole;
    password?: string;
  }): Promise<void> {
    assertUsername(input.username);
    if (input.password !== undefined) assertPasswordPolicy(input.password);
    const membership = this.database.raw.query<{ value: number }, [string, string]>(
      "SELECT COUNT(*) AS value FROM project_memberships WHERE project_id=? AND user_id=?",
    ).get(input.projectId, input.userId)?.value ?? 0;
    if (membership !== 1) throw authError("PROJECT_MEMBER_NOT_FOUND", "Project membership not found");
    const sharedMemberships = this.database.raw.query<{ value: number }, [string]>(
      "SELECT COUNT(*) AS value FROM project_memberships WHERE user_id=?",
    ).get(input.userId)?.value ?? 0;
    const systemRoles = this.database.raw.query<{ value: number }, [string]>(
      "SELECT COUNT(*) AS value FROM user_roles WHERE user_id=?",
    ).get(input.userId)?.value ?? 0;
    if (sharedMemberships !== 1 || systemRoles !== 0) {
      throw authError("PROJECT_MEMBER_SHARED_IDENTITY", "Shared or system identities must be managed from global configuration");
    }
    const duplicate = this.database.raw.query<{ value: number }, [string, string]>(
      "SELECT COUNT(*) AS value FROM users WHERE username=? AND user_id<>?",
    ).get(input.username, input.userId)?.value ?? 0;
    if (duplicate !== 0) throw authError("AUTH_USERNAME_TAKEN", `Username ${input.username} already exists`);
    const passwordHash = input.password === undefined ? undefined : await Bun.password.hash(input.password);
    const now = this.now().toISOString();
    this.database.transaction(() => {
      if (passwordHash === undefined) this.database.raw.query("UPDATE users SET username=?, updated_at=? WHERE user_id=?").run(input.username, now, input.userId);
      else this.database.raw.query("UPDATE users SET username=?, password_hash=?, updated_at=? WHERE user_id=?").run(input.username, passwordHash, now, input.userId);
      this.database.raw.query("UPDATE project_memberships SET role=? WHERE project_id=? AND user_id=?")
        .run(input.role, input.projectId, input.userId);
    });
  }

  setProjectRole(projectId: string, userId: string, role: ProjectRole): void {
    this.database.raw
      .query(`INSERT INTO project_memberships(project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`)
      .run(projectId, userId, role, this.now().toISOString());
  }

  issueToken(input: {
    userId?: string;
    projectId?: string;
    label?: string;
    type: "personal-access-token" | "service-account-token";
    scopes: readonly string[];
    expiresAt?: string;
  }): { tokenId: string; token: string } {
    const tokenId = `tok_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const token = `marcus_${Bun.randomUUIDv7().replaceAll("-", "")}${Bun.randomUUIDv7().replaceAll("-", "")}`;
    this.database.raw
      .query(`INSERT INTO access_tokens(token_id, user_id, token_hash, token_type, scopes_json, expires_at, revoked_at, last_used_at, created_at, project_id, label)
              VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
      .run(
        tokenId,
        input.userId ?? null,
        hashToken(token),
        input.type,
        JSON.stringify(input.scopes),
        input.expiresAt ?? null,
        this.now().toISOString(),
        input.projectId ?? null,
        input.label ?? null,
      );
    return { tokenId, token };
  }

  replaceServiceToken(tokenId: string, scopes: readonly string[]): { tokenId: string; token: string } {
    if (!/^tok_[a-zA-Z0-9._-]{3,64}$/u.test(tokenId)) throw authError("AUTH_TOKEN_ID_INVALID", "Token identifier is invalid");
    const token = `marcus_${Bun.randomUUIDv7().replaceAll("-", "")}${Bun.randomUUIDv7().replaceAll("-", "")}`;
    this.database.transaction(() => {
      this.database.raw.query("DELETE FROM access_tokens WHERE token_id = ?").run(tokenId);
      this.database.raw
        .query(`INSERT INTO access_tokens(token_id, user_id, token_hash, token_type, scopes_json, expires_at, revoked_at, last_used_at, created_at)
                VALUES (?, NULL, ?, 'service-account-token', ?, NULL, NULL, NULL, ?)`)
        .run(tokenId, hashToken(token), JSON.stringify(scopes), this.now().toISOString());
    });
    return { tokenId, token };
  }

  isServiceTokenActive(token: string, tokenId: string, scopes: readonly string[]): boolean {
    const row = this.database.raw
      .query<Pick<TokenRow, "token_id" | "scopes_json" | "expires_at" | "revoked_at">, [string]>(
        "SELECT token_id, scopes_json, expires_at, revoked_at FROM access_tokens WHERE token_hash = ? AND token_type = 'service-account-token'",
      )
      .get(hashToken(token));
    if (row === null || row.token_id !== tokenId || row.revoked_at !== null || (row.expires_at !== null && Date.parse(row.expires_at) <= this.now().getTime())) return false;
    const actualScopes = [...parseScopes(row.scopes_json)].sort();
    const expectedScopes = [...scopes].sort();
    return actualScopes.length === expectedScopes.length && actualScopes.every((scope, index) => scope === expectedScopes[index]);
  }

  revokeToken(tokenId: string): void {
    this.database.raw.query("UPDATE access_tokens SET revoked_at = ? WHERE token_id = ?").run(this.now().toISOString(), tokenId);
  }

  async authenticate(authentication: MnpAuthentication, source: string): Promise<AuthenticatedPrincipal> {
    const failureKey = `${source}:${authentication.method === "username-password" ? authentication.username : authentication.method}`;
    this.checkBackoff(failureKey);
    try {
      let result: AuthenticatedPrincipal;
      if (authentication.method === "username-password") result = await this.authenticatePassword(authentication.username, authentication.password);
      else if (authentication.method === "bootstrap-token") result = this.authenticateBootstrap(authentication.token);
      else result = this.authenticateToken(authentication.token, authentication.method);
      this.failures.delete(failureKey);
      return result;
    } catch (error) {
      this.recordFailure(failureKey);
      throw error;
    }
  }

  private async authenticatePassword(username: string, password: string): Promise<AuthenticatedPrincipal> {
    const user = this.database.raw
      .query<UserRow, [string]>("SELECT user_id, username, password_hash, status FROM users WHERE username = ?")
      .get(username);
    if (user === null || user.status !== "active" || user.password_hash === null || !(await Bun.password.verify(password, user.password_hash))) {
      throw authError("AUTH_CREDENTIALS_INVALID", "Invalid credentials");
    }
    return this.userPrincipal(user);
  }

  private authenticateToken(token: string, method: "personal-access-token" | "service-account-token"): AuthenticatedPrincipal {
    const row = this.database.raw
      .query<TokenRow, [string, string]>(
        "SELECT token_id, user_id, project_id, label, token_type, scopes_json, expires_at, revoked_at FROM access_tokens WHERE token_hash = ? AND token_type = ?",
      )
      .get(hashToken(token), method);
    if (row === null || row.revoked_at !== null || (row.expires_at !== null && Date.parse(row.expires_at) <= this.now().getTime())) {
      throw authError("AUTH_TOKEN_INVALID", "Token is invalid, expired, or revoked");
    }
    this.database.raw.query("UPDATE access_tokens SET last_used_at = ? WHERE token_id = ?").run(this.now().toISOString(), row.token_id);
    const scopes = parseScopes(row.scopes_json);
    if (row.user_id === null) {
      return {
        principal: {
          id: row.token_id,
          type: "service-account",
          scopes,
          ...(row.project_id === null ? {} : { claims: { tokenProjectId: row.project_id } }),
        },
        permissions: scopes,
      };
    }
    const user = this.database.raw
      .query<UserRow, [string]>("SELECT user_id, username, password_hash, status FROM users WHERE user_id = ?")
      .get(row.user_id);
    if (user === null || user.status !== "active") throw authError("AUTH_PRINCIPAL_DISABLED", "Token principal is disabled");
    const principal = this.userPrincipal(user).principal;
    const tokenPurpose = row.label?.startsWith("mcp:") === true ? "mcp-admin" : undefined;
    return {
      principal: {
        ...principal,
        scopes,
        ...((row.project_id === null && tokenPurpose === undefined) ? {} : {
          claims: {
            ...principal.claims,
            ...(row.project_id === null ? {} : { tokenProjectId: row.project_id }),
            ...(tokenPurpose === undefined ? {} : { tokenPurpose }),
          },
        }),
      },
      permissions: scopes,
    };
  }

  private authenticateBootstrap(token: string): AuthenticatedPrincipal {
    if (this.options.bootstrapToken === undefined || this.bootstrapUsed || !constantTimeEqual(token, this.options.bootstrapToken)) {
      throw authError("AUTH_BOOTSTRAP_INVALID", "Bootstrap token is invalid or already used");
    }
    const hasAdmin = this.database.raw
      .query<{ value: number }, []>("SELECT COUNT(*) AS value FROM user_roles WHERE role = 'system_admin'")
      .get()?.value ?? 0;
    if (hasAdmin > 0) throw authError("AUTH_BOOTSTRAP_CLOSED", "Bootstrap is already complete");
    this.bootstrapUsed = true;
    return {
      principal: { id: "bootstrap", type: "service-account", scopes: ["bootstrap.setup"] },
      permissions: ["bootstrap.setup"],
    };
  }

  private userPrincipal(user: UserRow): AuthenticatedPrincipal {
    const roles = this.database.raw
      .query<{ role: string }, [string]>("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
      .all(user.user_id)
      .map((row) => row.role);
    const permissions = roles.includes("system_admin") ? ["*"] : [];
    return {
      principal: { id: user.user_id, type: "user", claims: { username: user.username, systemRoles: roles.join(",") } },
      permissions,
    };
  }

  private checkBackoff(key: string): void {
    const state = this.failures.get(key);
    if (state !== undefined && state.blockedUntil > this.now().getTime()) throw authError("AUTH_RATE_LIMITED", "Authentication temporarily rate limited", true);
  }

  private recordFailure(key: string): void {
    const now = this.now().getTime();
    const previous = this.failures.get(key);
    const state = previous === undefined || now - previous.startedAt > this.options.failureWindowMs
      ? { count: 1, startedAt: now, blockedUntil: 0 }
      : { ...previous, count: previous.count + 1 };
    if (state.count >= this.options.maxFailures) state.blockedUntil = now + this.options.backoffMs;
    this.failures.set(key, state);
  }
}

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function parseScopes(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = new Bun.CryptoHasher("sha256").update(left).digest();
  const rightHash = new Bun.CryptoHasher("sha256").update(right).digest();
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash[index % leftHash.length] ?? 0) ^ (rightHash[index % rightHash.length] ?? 0);
  }
  return difference === 0;
}

function authError(code: string, message: string, retryable = false): MarcusError {
  return new MarcusError({ code, message, retryable });
}

function assertUsername(username: string): void {
  if (!/^[a-zA-Z0-9._-]{3,64}$/u.test(username)) throw authError("AUTH_USERNAME_INVALID", "Username is invalid");
}

function assertPasswordPolicy(password: string): void {
  if (password.length < 6 || password.length > 1_024 || !/[A-Z]/u.test(password) || !/[$%#!&*]/u.test(password)) {
    throw authError("AUTH_PASSWORD_POLICY", PASSWORD_POLICY_DESCRIPTION);
  }
}
