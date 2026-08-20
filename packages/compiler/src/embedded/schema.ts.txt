import type { JsonValue, SerializedSchema } from "@marcus/contracts";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export class MarcusValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path || "$"}: ${issue.message}`).join("; "));
    this.name = "MarcusValidationError";
    this.issues = issues;
  }
}

export interface MarcusSchema<T, TOptional extends boolean = false> {
  readonly definition: SerializedSchema;
  readonly optional: TOptional;
  parse(value: unknown): T;
  safeParse(value: unknown): ValidationResult<T>;
  toJSON(): SerializedSchema;
  readonly _output?: T;
}

export type Infer<TSchema extends MarcusSchema<unknown, boolean>> =
  TSchema extends MarcusSchema<infer T, boolean> ? T : never;

type AnySchema = MarcusSchema<unknown, boolean>;
type Shape = Readonly<Record<string, AnySchema>>;
type RequiredKeys<TShape extends Shape> = {
  [TKey in keyof TShape]: TShape[TKey] extends MarcusSchema<unknown, true> ? never : TKey;
}[keyof TShape];
type OptionalKeys<TShape extends Shape> = Exclude<keyof TShape, RequiredKeys<TShape>>;
type InferObject<TShape extends Shape> = {
  [TKey in RequiredKeys<TShape>]: Infer<TShape[TKey]>;
} & {
  [TKey in OptionalKeys<TShape>]?: Exclude<Infer<TShape[TKey]>, undefined>;
};

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "email" | "uuid" | "date" | "date-time" | "uri" | string;
}

export interface NumberOptions {
  minimum?: number;
  maximum?: number;
}

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface ObjectOptions {
  additionalProperties?: boolean;
}

function cloneDefinition(definition: SerializedSchema): SerializedSchema {
  return structuredClone(definition);
}

function makeSchema<T, TOptional extends boolean = false>(
  definition: SerializedSchema,
  optional: TOptional,
): MarcusSchema<T, TOptional> {
  return {
    definition,
    optional,
    parse(value: unknown): T {
      const result = validateSchema<T>(definition, value);
      if (!result.success) throw new MarcusValidationError(result.issues);
      return result.data;
    },
    safeParse(value: unknown): ValidationResult<T> {
      return validateSchema<T>(definition, value);
    },
    toJSON(): SerializedSchema {
      return cloneDefinition(definition);
    },
  };
}

export const m = {
  string(options: StringOptions = {}): MarcusSchema<string> {
    return makeSchema({ type: "string", ...options }, false);
  },

  number(options: NumberOptions = {}): MarcusSchema<number> {
    return makeSchema({ type: "number", ...options }, false);
  },

  integer(options: NumberOptions = {}): MarcusSchema<number> {
    return makeSchema({ type: "integer", ...options }, false);
  },

  boolean(): MarcusSchema<boolean> {
    return makeSchema({ type: "boolean" }, false);
  },

  literal<const TValue extends JsonValue>(value: TValue): MarcusSchema<TValue> {
    return makeSchema({ const: value }, false);
  },

  enum<const TValues extends readonly [string, ...string[]]>(values: TValues): MarcusSchema<TValues[number]> {
    return makeSchema({ type: "string", enum: values }, false);
  },

  null(): MarcusSchema<null> {
    return makeSchema({ type: "null" }, false);
  },

  unknown(): MarcusSchema<unknown> {
    return makeSchema({}, false);
  },

  object<const TShape extends Shape>(
    shape: TShape,
    options: ObjectOptions = {},
  ): MarcusSchema<InferObject<TShape>> {
    const properties: Record<string, SerializedSchema> = {};
    const required: string[] = [];
    for (const [key, schema] of Object.entries(shape)) {
      properties[key] = schema.definition;
      if (!schema.optional) required.push(key);
    }
    return makeSchema(
      {
        type: "object",
        properties,
        required,
        additionalProperties: options.additionalProperties ?? false,
      },
      false,
    );
  },

  array<TSchema extends AnySchema>(schema: TSchema, options: ArrayOptions = {}): MarcusSchema<Infer<TSchema>[]> {
    return makeSchema({ type: "array", items: schema.definition, ...options }, false);
  },

  record<TSchema extends AnySchema>(schema: TSchema): MarcusSchema<Record<string, Infer<TSchema>>> {
    return makeSchema({ type: "object", additionalProperties: schema.definition }, false);
  },

  union<const TSchemas extends readonly [AnySchema, AnySchema, ...AnySchema[]]>(
    schemas: TSchemas,
  ): MarcusSchema<Infer<TSchemas[number]>> {
    return makeSchema({ anyOf: schemas.map((schema) => schema.definition) }, false);
  },

  optional<TSchema extends AnySchema>(schema: TSchema): MarcusSchema<Infer<TSchema> | undefined, true> {
    return makeSchema(schema.definition, true);
  },

  nullable<TSchema extends AnySchema>(schema: TSchema): MarcusSchema<Infer<TSchema> | null> {
    return makeSchema({ anyOf: [schema.definition, { type: "null" }] }, false);
  },

  default<TSchema extends AnySchema>(
    schema: TSchema,
    value: Exclude<Infer<TSchema>, undefined>,
  ): MarcusSchema<Exclude<Infer<TSchema>, undefined>, true> {
    return makeSchema({ ...schema.definition, default: value as JsonValue }, true);
  },
};

export namespace m {
  export type Infer<TSchema extends MarcusSchema<unknown, boolean>> = import("./index").Infer<TSchema>;
}

export function schemaFromJSON<T = unknown>(definition: SerializedSchema): MarcusSchema<T> {
  return makeSchema<T>(cloneDefinition(definition), false);
}

export function validateSchema<T = unknown>(definition: SerializedSchema, value: unknown): ValidationResult<T> {
  const issues: ValidationIssue[] = [];
  validateNode(definition, value, "", issues);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, data: applyDefaults(definition, value) as T };
}

function validateNode(
  definition: SerializedSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (definition.anyOf !== undefined) {
    const branchResults = definition.anyOf.map((branch) => {
      const branchIssues: ValidationIssue[] = [];
      validateNode(branch, value, path, branchIssues);
      return branchIssues;
    });
    if (!branchResults.some((branch) => branch.length === 0)) {
      issue(issues, path, "union", "Value does not match any union member");
    }
    return;
  }

  if (definition.const !== undefined && !deepEqual(value, definition.const)) {
    issue(issues, path, "literal", `Expected literal ${JSON.stringify(definition.const)}`);
    return;
  }

  if (definition.enum !== undefined && !definition.enum.some((member) => deepEqual(member, value))) {
    issue(issues, path, "enum", `Expected one of ${definition.enum.map(String).join(", ")}`);
    return;
  }

  switch (definition.type) {
    case undefined:
      return;
    case "null":
      if (value !== null) issue(issues, path, "type", "Expected null");
      return;
    case "string":
      validateString(definition, value, path, issues);
      return;
    case "number":
    case "integer":
      validateNumber(definition, value, path, issues);
      return;
    case "boolean":
      if (typeof value !== "boolean") issue(issues, path, "type", "Expected boolean");
      return;
    case "array":
      validateArray(definition, value, path, issues);
      return;
    case "object":
      validateObject(definition, value, path, issues);
  }
}

function validateString(
  definition: SerializedSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string") {
    issue(issues, path, "type", "Expected string");
    return;
  }
  if (definition.minLength !== undefined && value.length < definition.minLength) {
    issue(issues, path, "min_length", `Expected at least ${definition.minLength} characters`);
  }
  if (definition.maxLength !== undefined && value.length > definition.maxLength) {
    issue(issues, path, "max_length", `Expected at most ${definition.maxLength} characters`);
  }
  if (definition.pattern !== undefined && !new RegExp(definition.pattern, "u").test(value)) {
    issue(issues, path, "pattern", `Expected string matching ${definition.pattern}`);
  }
  if (definition.format !== undefined && !matchesFormat(value, definition.format)) {
    issue(issues, path, "format", `Expected ${definition.format} format`);
  }
}

function validateNumber(
  definition: SerializedSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(issues, path, "type", `Expected ${definition.type}`);
    return;
  }
  if (definition.type === "integer" && !Number.isInteger(value)) {
    issue(issues, path, "integer", "Expected integer");
  }
  if (definition.minimum !== undefined && value < definition.minimum) {
    issue(issues, path, "minimum", `Expected value >= ${definition.minimum}`);
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    issue(issues, path, "maximum", `Expected value <= ${definition.maximum}`);
  }
}

function validateArray(
  definition: SerializedSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, path, "type", "Expected array");
    return;
  }
  if (definition.minItems !== undefined && value.length < definition.minItems) {
    issue(issues, path, "min_items", `Expected at least ${definition.minItems} items`);
  }
  if (definition.maxItems !== undefined && value.length > definition.maxItems) {
    issue(issues, path, "max_items", `Expected at most ${definition.maxItems} items`);
  }
  if (definition.uniqueItems === true && new Set(value.map(stableKey)).size !== value.length) {
    issue(issues, path, "unique_items", "Expected unique items");
  }
  if (definition.items !== undefined) {
    value.forEach((item, index) => validateNode(definition.items!, item, childPath(path, index), issues));
  }
}

function validateObject(
  definition: SerializedSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issue(issues, path, "type", "Expected object");
    return;
  }
  const properties = definition.properties ?? {};
  for (const required of definition.required ?? []) {
    if (!(required in value)) issue(issues, childPath(path, required), "required", "Required field is missing");
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    const property = properties[key];
    if (property !== undefined) {
      validateNode(property, fieldValue, childPath(path, key), issues);
      continue;
    }
    if (definition.additionalProperties === false) {
      issue(issues, childPath(path, key), "additional_property", "Unexpected field");
    } else if (typeof definition.additionalProperties === "object") {
      validateNode(definition.additionalProperties, fieldValue, childPath(path, key), issues);
    }
  }
}

function applyDefaults(definition: SerializedSchema, value: unknown): unknown {
  if (value === undefined && definition.default !== undefined) return structuredClone(definition.default);
  if (definition.type === "object" && isPlainObject(value)) {
    const output: Record<string, unknown> = { ...value };
    for (const [key, property] of Object.entries(definition.properties ?? {})) {
      const applied = applyDefaults(property, output[key]);
      if (applied !== undefined) output[key] = applied;
    }
    return output;
  }
  if (definition.type === "array" && Array.isArray(value) && definition.items !== undefined) {
    return value.map((item) => applyDefaults(definition.items!, item));
  }
  return value;
}

function matchesFormat(value: string, format: string): boolean {
  switch (format) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    case "date-time":
      return !Number.isNaN(Date.parse(value));
    case "uri":
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    default:
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPath(path: string, child: string | number): string {
  return path === "" ? String(child) : `${path}.${String(child)}`;
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableKey(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableKey(left) === stableKey(right);
}

export function toOpenApiSchema(schema: MarcusSchema<unknown, boolean> | SerializedSchema): SerializedSchema {
  return cloneDefinition("definition" in schema ? schema.definition : schema);
}
