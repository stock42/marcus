import { describe, expect, test } from "bun:test";
import { MarcusValidationError, m } from "./index";

describe("Marcus Schema DSL", () => {
  const Input = m.object(
    {
      chatId: m.string({ minLength: 1, maxLength: 128 }),
      message: m.string({ minLength: 1, maxLength: 20_000 }),
      priority: m.default(m.enum(["low", "high"]), "low"),
      tags: m.optional(m.array(m.string(), { uniqueItems: true })),
    },
    { additionalProperties: false },
  );

  test("parses typed objects and applies defaults", () => {
    expect(Input.parse({ chatId: "chat-1", message: "hello" })).toEqual({
      chatId: "chat-1",
      message: "hello",
      priority: "low",
    });
  });

  test("returns actionable paths for invalid input", () => {
    const result = Input.safeParse({ chatId: "", message: "ok", extra: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((item) => [item.path, item.code])).toEqual([
      ["chatId", "min_length"],
      ["extra", "additional_property"],
    ]);
  });

  test("rejects duplicate array entries", () => {
    expect(() => Input.parse({ chatId: "c", message: "m", tags: ["a", "a"] })).toThrow(MarcusValidationError);
  });

  test("serializes without executable functions", () => {
    const definition = Input.toJSON();
    expect(definition.type).toBe("object");
    expect(definition.required).toEqual(["chatId", "message"]);
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
  });
});
