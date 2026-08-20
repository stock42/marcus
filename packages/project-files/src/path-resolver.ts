import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { MarcusError } from "@marcus/contracts";

export interface ResolvedProjectPath {
  logicalPath: string;
  relativePath: string;
  physicalPath: string;
}

export class ProjectPathResolver {
  readonly homePath: string;
  readonly realHomePath: string;
  readonly projectSlug?: string;

  constructor(homePath: string, options: { projectSlug?: string } = {}) {
    this.homePath = resolve(homePath);
    this.realHomePath = existsSync(this.homePath) ? realpathSync.native(this.homePath) : this.homePath;
    if (options.projectSlug !== undefined) this.projectSlug = options.projectSlug;
  }

  resolve(input: string, options: { allowReserved?: boolean } = {}): ResolvedProjectPath {
    const decoded = decodePath(input);
    const relativePath = this.parseLogical(decoded);
    const segments = relativePath === "" ? [] : relativePath.split("/");
    for (const segment of segments) {
      if (segment === "..") throw pathError("FILE_PATH_TRAVERSAL", "Parent path segments are not allowed");
      if (segment === "" || segment === ".") throw pathError("FILE_PATH_INVALID", "Empty and dot path segments are not allowed");
      if (segment.includes("\0") || /[\u0000-\u001f\u007f]/u.test(segment)) {
        throw pathError("FILE_PATH_INVALID", "Control characters are not allowed in paths");
      }
    }
    if (!options.allowReserved && segments[0]?.toLocaleLowerCase("en-US") === ".marcus") {
      throw pathError("FILE_PATH_RESERVED", "The .marcus root namespace is reserved");
    }
    const physicalPath = resolve(this.homePath, ...segments);
    assertContained(this.homePath, physicalPath);
    this.assertExistingAncestorsContained(physicalPath);
    return {
      logicalPath: `project:/${relativePath}`,
      relativePath,
      physicalPath,
    };
  }

  private parseLogical(input: string): string {
    if (input.includes("\\")) throw pathError("FILE_PATH_INVALID", "Logical paths must use forward slashes");
    if (/^[a-zA-Z]:\//u.test(input) || input.startsWith("/") || input.startsWith("file:")) {
      throw pathError("FILE_PATH_SCHEME_INVALID", "Host absolute paths are not valid Project paths");
    }
    if (input.startsWith("project://")) {
      const remainder = input.slice("project://".length);
      const slash = remainder.indexOf("/");
      const slug = slash < 0 ? remainder : remainder.slice(0, slash);
      if (slug === "") throw pathError("FILE_PATH_INVALID", "Project URI requires a slug");
      if (this.projectSlug !== undefined && slug !== this.projectSlug) {
        throw pathError("FILE_PROJECT_MISMATCH", `Path belongs to project ${slug}, not ${this.projectSlug}`);
      }
      return trimLogical(slash < 0 ? "" : remainder.slice(slash + 1));
    }
    if (input.startsWith("project:/")) return trimLogical(input.slice("project:/".length));
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(input)) {
      throw pathError("FILE_PATH_SCHEME_INVALID", "Only project: paths are accepted by the server");
    }
    if (isAbsolute(input)) throw pathError("FILE_PATH_SCHEME_INVALID", "Absolute paths are not accepted");
    return trimLogical(input);
  }

  private assertExistingAncestorsContained(target: string): void {
    let candidate = target;
    while (!existsSync(candidate) && candidate !== dirname(candidate)) candidate = dirname(candidate);
    const realCandidate = realpathSync.native(candidate);
    assertContained(this.realHomePath, realCandidate);

    if (!existsSync(target)) return;
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      const realTarget = realpathSync.native(target);
      assertContained(this.realHomePath, realTarget);
    }
  }
}

function decodePath(input: string): string {
  let decoded = input;
  for (let index = 0; index < 2; index += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw pathError("FILE_PATH_INVALID", "Path contains invalid percent encoding");
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.normalize("NFC");
}

function trimLogical(value: string): string {
  return value.replace(/^\/+|\/+$/gu, "");
}

function assertContained(root: string, target: string): void {
  const path = relative(root, target);
  if (path === "") return;
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw pathError("FILE_PATH_TRAVERSAL", "Project path escapes the Project Home");
  }
}

function pathError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
