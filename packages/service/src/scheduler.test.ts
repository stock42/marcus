import { describe, expect, test } from "bun:test";
import { cronMatches, validateCron } from "./scheduler";

describe("cron scheduler", () => {
  test("matches steps and IANA timezone calendar fields", () => {
    const instant = new Date("2026-08-11T15:30:00.000Z");
    expect(cronMatches("*/15 12 * * 2", "America/Argentina/Buenos_Aires", instant)).toBe(true);
    expect(cronMatches("31 12 * * 2", "America/Argentina/Buenos_Aires", instant)).toBe(false);
  });

  test("rejects invalid expressions and timezones", () => {
    expect(() => validateCron("* * *", "UTC")).toThrow("five fields");
    expect(() => validateCron("* * * * *", "Mars/Olympus")).toThrow("Unsupported timezone");
  });
});
