import type { Json } from "./types";

type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const PASSWORD_POLICY_MESSAGE = "La contraseña debe tener al menos 6 caracteres, una mayúscula y uno de estos caracteres: $ % # ! & *.";
export type ProjectRole = "project_owner" | "project_operator" | "project_developer" | "project_viewer";

export function validateLogin(value: unknown): ValidationResult<{ username: string; password: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const username = stringValue(value.username);
  const password = stringValue(value.password, false);
  if (username === undefined || password === undefined) return invalid("Usuario y contraseña son obligatorios.");
  if (username.length > 128 || password.length > 1024) return invalid("Las credenciales exceden el tamaño permitido.");
  return { ok: true, value: { username, password } };
}

export function validateAdminUser(value: unknown): ValidationResult<{ username: string; password: string; systemAdmin: true }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const username = validatedUsername(value.username);
  if (!username.ok) return username;
  const password = validatedPassword(value.password);
  if (!password.ok) return password;
  return { ok: true, value: { username: username.value, password: password.value, systemAdmin: true } };
}

export function validatePasswordChange(value: unknown): ValidationResult<{ currentPassword: string; password: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const currentPassword = stringValue(value.currentPassword, false);
  if (currentPassword === undefined || currentPassword.length > 1_024) return invalid("La contraseña actual es obligatoria.");
  const password = validatedPassword(value.password);
  if (!password.ok) return password;
  return { ok: true, value: { currentPassword, password: password.value } };
}

export function validateProjectMemberCreate(value: unknown): ValidationResult<{ username: string; password: string; role: ProjectRole }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const username = validatedUsername(value.username);
  if (!username.ok) return username;
  const password = validatedPassword(value.password);
  if (!password.ok) return password;
  const role = validatedProjectRole(value.role);
  if (!role.ok) return role;
  return { ok: true, value: { username: username.value, password: password.value, role: role.value } };
}

export function validateProjectMemberUpdate(value: unknown): ValidationResult<{ username: string; password?: string; role: ProjectRole }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const username = validatedUsername(value.username);
  if (!username.ok) return username;
  const role = validatedProjectRole(value.role);
  if (!role.ok) return role;
  const requestedPassword = stringValue(value.password, false);
  if (requestedPassword !== undefined) {
    const password = validatedPassword(requestedPassword);
    if (!password.ok) return password;
    return { ok: true, value: { username: username.value, password: password.value, role: role.value } };
  }
  return { ok: true, value: { username: username.value, role: role.value } };
}

export function validateProject(value: unknown): ValidationResult<{ slug: string; name: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const slug = stringValue(value.slug)?.toLowerCase();
  const name = stringValue(value.name);
  if (slug === undefined || name === undefined) return invalid("Slug y nombre son obligatorios.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 80) {
    return invalid("El slug debe usar minúsculas, números y guiones.");
  }
  if (name.length > 120) return invalid("El nombre no puede superar 120 caracteres.");
  return { ok: true, value: { slug, name } };
}

export function validateProjectToken(value: unknown): ValidationResult<{ label: string; expiresAt?: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const label = stringValue(value.label);
  if (label === undefined || label.length < 2 || label.length > 80) return invalid("El nombre del token debe tener entre 2 y 80 caracteres.");
  const expiresAt = stringValue(value.expiresAt);
  if (expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return invalid("La expiración del token debe ser una fecha futura.");
  }
  return { ok: true, value: { label, ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt).toISOString() }) } };
}

export function validateAgentApiAccess(value: unknown): ValidationResult<{ enabled: boolean }> {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return invalid("El estado de acceso API debe ser booleano.");
  return { ok: true, value: { enabled: value.enabled } };
}

export function validateFile(value: unknown): ValidationResult<{ path: string; content: string; expectedRevision?: number }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const path = stringValue(value.path);
  const content = typeof value.content === "string" ? value.content : undefined;
  if (path === undefined || content === undefined) return invalid("Path y contenido son obligatorios.");
  if (!path.startsWith("project:/") || path.length > 512 || path.includes("\0")) {
    return invalid("El path debe comenzar con project:/ y ser válido.");
  }
  if (content.length > 900_000) return invalid("El contenido supera el límite de 900 KB.");
  const expectedRevision = typeof value.expectedRevision === "number" && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0
    ? value.expectedRevision
    : undefined;
  return { ok: true, value: { path, content, ...(expectedRevision === undefined ? {} : { expectedRevision }) } };
}

export function validateAgentPrompt(value: unknown): ValidationResult<{ prompt: string; progressId?: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const prompt = stringValue(value.prompt);
  if (prompt === undefined || prompt.length < 12) return invalid("Describí el agente con al menos 12 caracteres.");
  if (prompt.length > 20_000) return invalid("La descripción no puede superar 20000 caracteres.");
  const progressId = stringValue(value.progressId);
  if (progressId !== undefined && !/^generation_[a-zA-Z0-9_-]{8,96}$/u.test(progressId)) return invalid("El identificador de progreso no es válido.");
  return { ok: true, value: { prompt, ...(progressId === undefined ? {} : { progressId }) } };
}

export function validateAgentPlan(value: unknown): ValidationResult<{ prompt: string; sourceKind: "markdown" | "sdk" }> {
  const prompt = validateAgentPrompt(value);
  if (!prompt.ok) return prompt;
  if (!isRecord(value) || (value.sourceKind !== "markdown" && value.sourceKind !== "sdk")) {
    return invalid("El formato de fuente debe ser markdown o sdk.");
  }
  return { ok: true, value: { prompt: prompt.value.prompt, sourceKind: value.sourceKind } };
}

export function validateAgentTestCase(value: unknown): ValidationResult<{ input: Json }> {
  if (!isRecord(value) || !("input" in value) || !isJson(value.input)) return invalid("El test case debe contener un input JSON válido.");
  return { ok: true, value: { input: value.input } };
}

export function validateDefaultLlm(value: unknown): ValidationResult<{ catalogId?: "openai" | "deepseek"; provider: string; baseUrl: string; apiKey: string; model: string }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const provider = stringValue(value.provider);
  const baseUrl = stringValue(value.baseUrl);
  const apiKey = stringValue(value.apiKey, false);
  const model = stringValue(value.model);
  if (provider === undefined || baseUrl === undefined || apiKey === undefined || model === undefined) {
    return invalid("Proveedor, URL base, API key y modelo son obligatorios.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(provider)) return invalid("El nombre del proveedor no es válido.");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return invalid("La URL base debe usar HTTP o HTTPS.");
  } catch {
    return invalid("La URL base debe ser absoluta.");
  }
  if (apiKey.length > 8_192 || model.length > 256) return invalid("La API key o el modelo exceden el tamaño permitido.");
  const catalogId = value.catalogId;
  if (catalogId !== undefined && catalogId !== "openai" && catalogId !== "deepseek") return invalid("El proveedor no pertenece al catálogo de Marcus.");
  return { ok: true, value: { ...(catalogId === undefined ? {} : { catalogId }), provider, baseUrl: baseUrl.replace(/\/$/u, ""), apiKey, model } };
}

export function validateAssistant(value: unknown): ValidationResult<{ messages: Array<{ role: "user" | "assistant"; content: string }>; projectId?: string; conversationId?: string; mode?: "agent-file-edit"; path?: string }> {
  if (!isRecord(value) || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 30) {
    return invalid("La conversación debe contener entre 1 y 30 mensajes.");
  }
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of value.messages) {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant")) return invalid("La conversación contiene un rol inválido.");
    const content = stringValue(item.content);
    if (content === undefined || content.length > 20_000) return invalid("Cada mensaje debe contener entre 1 y 20000 caracteres.");
    messages.push({ role: item.role, content });
  }
  const projectId = stringValue(value.projectId);
  const conversationId = stringValue(value.conversationId);
  if (conversationId !== undefined && (conversationId.length > 128 || !conversationId.startsWith("conv_"))) return invalid("La conversación de Marcus AI no es válida.");
  const mode = stringValue(value.mode);
  if (mode !== undefined && mode !== "agent-file-edit") return invalid("El modo de Marcus AI no es válido.");
  const path = stringValue(value.path);
  if (mode === "agent-file-edit" && (projectId === undefined || path === undefined || !/^project:\/.+\.agent\.md$/iu.test(path))) {
    return invalid("La edición con Agente AI requiere un Project y un path .agent.md válido.");
  }
  if (mode === undefined && path !== undefined) return invalid("El path de edición requiere el modo Agente AI.");
  return { ok: true, value: { messages, ...(projectId === undefined ? {} : { projectId }), ...(conversationId === undefined ? {} : { conversationId }), ...(mode === undefined ? {} : { mode }), ...(path === undefined ? {} : { path }) } };
}

export function validateUploadOpen(value: unknown): ValidationResult<{ fileName: string; destination: string; size: number; purpose: "project-file" }> {
  if (!isRecord(value)) return invalid("El cuerpo debe ser un objeto JSON.");
  const fileName = stringValue(value.fileName);
  const destination = stringValue(value.destination);
  const size = value.size;
  if (fileName === undefined || destination === undefined || typeof size !== "number") return invalid("Archivo, destino y tamaño son obligatorios.");
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") return invalid("El nombre del archivo no es válido.");
  if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) return invalid("El archivo debe pesar como máximo 100 MiB.");
  const path = validateLogicalPath(destination);
  if (!path.ok) return path;
  return { ok: true, value: { fileName, destination: path.value, size, purpose: "project-file" } };
}

export function validateUploadChunk(value: unknown): ValidationResult<{ data: string }> {
  if (!isRecord(value) || typeof value.data !== "string" || value.data.length > 500_000 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value.data)) {
    return invalid("El chunk base64 no es válido.");
  }
  return { ok: true, value: { data: value.data } };
}

export function validateLogicalPath(value: string | null): ValidationResult<string> {
  const path = value ?? "project:/";
  if (!path.startsWith("project:/") || path.length > 512 || path.includes("\0")) {
    return invalid("El path solicitado no es válido.");
  }
  return { ok: true, value: path };
}

function stringValue(value: unknown, trim = true): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = trim ? value.trim() : value;
  return normalized.length === 0 ? undefined : normalized;
}

function validatedUsername(value: unknown): ValidationResult<string> {
  const username = stringValue(value);
  if (username === undefined || !/^[a-zA-Z0-9._-]{3,64}$/u.test(username)) {
    return invalid("El usuario debe tener entre 3 y 64 caracteres y usar letras, números, punto, guion o guion bajo.");
  }
  return { ok: true, value: username };
}

function validatedPassword(value: unknown): ValidationResult<string> {
  const password = stringValue(value, false);
  if (password === undefined || password.length < 6 || password.length > 1_024 || !/[A-Z]/u.test(password) || !/[$%#!&*]/u.test(password)) {
    return invalid(PASSWORD_POLICY_MESSAGE);
  }
  return { ok: true, value: password };
}

function validatedProjectRole(value: unknown): ValidationResult<ProjectRole> {
  if (value === "project_owner" || value === "project_operator" || value === "project_developer" || value === "project_viewer") {
    return { ok: true, value };
  }
  return invalid("Seleccioná un rol válido para el proyecto.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item));
  return isRecord(value) && Object.values(value).every((item) => isJson(item));
}

function invalid<T>(message: string): ValidationResult<T> {
  return { ok: false, message };
}
