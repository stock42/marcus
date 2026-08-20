import { MarcusError } from "@marcus/contracts";

type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };
type Line = { number: number; indent: number; text: string };

export function parseMarcusYaml(source: string, lineOffset = 0): YamlValue {
  if (/^[\s\S]*(?:^|\s)(?:&[A-Za-z]|\*[A-Za-z]|![A-Za-z]|<<\s*:)/mu.test(source)) {
    throw yamlError("MD_YAML_FEATURE_UNSUPPORTED", "Anchors, aliases, tags, and merge keys are not supported", lineOffset + 1);
  }
  const lines = source.split(/\r?\n/u).map((raw, index): Line | undefined => {
    if (/\t/u.test(raw)) throw yamlError("MD_YAML_TAB", "Tabs are not allowed for indentation", lineOffset + index + 1);
    const indent = raw.match(/^ */u)?.[0].length ?? 0;
    const text = stripComment(raw.slice(indent)).trimEnd();
    return text.trim().length === 0 ? undefined : { number: lineOffset + index + 1, indent, text };
  }).filter((line): line is Line => line !== undefined);
  if (lines.length === 0) return {};
  const parsed = parseBlock(lines, 0, lines[0]!.indent);
  if (parsed.next !== lines.length) throw yamlError("MD_YAML_INDENT", "Unexpected indentation", lines[parsed.next]!.number);
  return parsed.value;
}

function parseBlock(lines: readonly Line[], start: number, indent: number): { value: YamlValue; next: number } {
  return lines[start]!.text.startsWith("- ") || lines[start]!.text === "-"
    ? parseArray(lines, start, indent)
    : parseObject(lines, start, indent);
}

function parseObject(lines: readonly Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const output: Record<string, YamlValue> = {};
  let index = start;
  while (index < lines.length && lines[index]!.indent === indent && !lines[index]!.text.startsWith("- ")) {
    const line = lines[index]!;
    const separator = findSeparator(line.text);
    if (separator <= 0) throw yamlError("MD_YAML_MAPPING", "Expected key: value", line.number);
    const key = unquote(line.text.slice(0, separator).trim());
    if (key in output) throw yamlError("MD_YAML_DUPLICATE_KEY", `Duplicate key ${key}`, line.number);
    const rest = line.text.slice(separator + 1).trim();
    if (rest === "|") {
      const literal = collectLiteral(lines, index + 1, indent, line.number);
      output[key] = literal.value;
      index = literal.next;
    } else if (rest.length > 0) {
      output[key] = parseScalar(rest, line.number);
      index += 1;
    } else if (index + 1 < lines.length && lines[index + 1]!.indent > indent) {
      const child = parseBlock(lines, index + 1, lines[index + 1]!.indent);
      output[key] = child.value;
      index = child.next;
    } else {
      output[key] = null;
      index += 1;
    }
  }
  return { value: output, next: index };
}

function parseArray(lines: readonly Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const output: YamlValue[] = [];
  let index = start;
  while (index < lines.length && lines[index]!.indent === indent && (lines[index]!.text === "-" || lines[index]!.text.startsWith("- "))) {
    const line = lines[index]!;
    const rest = line.text.slice(1).trim();
    if (rest.length === 0) {
      if (index + 1 >= lines.length || lines[index + 1]!.indent <= indent) output.push(null);
      else {
        const child = parseBlock(lines, index + 1, lines[index + 1]!.indent);
        output.push(child.value);
        index = child.next;
        continue;
      }
      index += 1;
      continue;
    }
    const separator = findSeparator(rest);
    if (separator > 0) {
      const key = unquote(rest.slice(0, separator).trim());
      const object: Record<string, YamlValue> = {};
      const value = rest.slice(separator + 1).trim();
      object[key] = value.length === 0 ? null : parseScalar(value, line.number);
      index += 1;
      if (index < lines.length && lines[index]!.indent > indent) {
        const continuation = parseObject(lines, index, lines[index]!.indent);
        Object.assign(object, continuation.value);
        index = continuation.next;
      }
      output.push(object);
      continue;
    }
    output.push(parseScalar(rest, line.number));
    index += 1;
  }
  return { value: output, next: index };
}

function collectLiteral(lines: readonly Line[], start: number, parentIndent: number, lineNumber: number) {
  if (start >= lines.length || lines[start]!.indent <= parentIndent) return { value: "", next: start };
  const indent = lines[start]!.indent;
  const values: string[] = [];
  let index = start;
  while (index < lines.length && lines[index]!.indent > parentIndent) {
    values.push(`${" ".repeat(Math.max(0, lines[index]!.indent - indent))}${lines[index]!.text}`);
    index += 1;
  }
  if (values.length === 0) throw yamlError("MD_YAML_LITERAL", "Invalid literal block", lineNumber);
  return { value: `${values.join("\n")}\n`, next: index };
}

function parseScalar(value: string, line: number): YamlValue {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return unquote(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body.length === 0 ? [] : splitTopLevel(body).map((item) => parseScalar(item.trim(), line));
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const output: Record<string, YamlValue> = {};
    const body = value.slice(1, -1).trim();
    if (body.length === 0) return output;
    for (const item of splitTopLevel(body)) {
      const separator = findSeparator(item);
      if (separator <= 0) throw yamlError("MD_YAML_INLINE_OBJECT", "Invalid inline object", line);
      output[unquote(item.slice(0, separator).trim())] = parseScalar(item.slice(separator + 1).trim(), line);
    }
    return output;
  }
  return value;
}

function splitTopLevel(value: string): string[] {
  const output: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== "") {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      output.push(value.slice(start, index));
      start = index + 1;
    }
  }
  output.push(value.slice(start));
  return output;
}

function stripComment(value: string): string {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== "") {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]!))) return value.slice(0, index);
  }
  return value;
}

function findSeparator(value: string): number {
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== "") {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth -= 1;
    else if (character === ":" && depth === 0) return index;
  }
  return -1;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function yamlError(code: string, message: string, line: number): MarcusError {
  return new MarcusError({ code, message, retryable: false, details: { line } });
}
