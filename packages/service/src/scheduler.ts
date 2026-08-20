import { MarcusError } from "@marcus/contracts";

const weekdayNumbers: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function cronMatches(expression: string, timezone: string, instant: Date): boolean {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) throw schedulerError("SCHEDULE_CRON_INVALID", "Cron expression must contain five fields");
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "2-digit",
      hour: "2-digit",
      day: "2-digit",
      month: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]));
  } catch {
    throw schedulerError("SCHEDULE_TIMEZONE_INVALID", `Unsupported timezone ${timezone}`);
  }
  const minute = Number(parts.minute);
  const hour = Number(parts.hour);
  const day = Number(parts.day);
  const month = Number(parts.month);
  const weekday = weekdayNumbers[parts.weekday ?? ""];
  if (weekday === undefined) throw schedulerError("SCHEDULE_TIMEZONE_INVALID", `Could not resolve weekday in ${timezone}`);
  const minuteMatch = fieldMatches(fields[0]!, minute, 0, 59);
  const hourMatch = fieldMatches(fields[1]!, hour, 0, 23);
  const dayMatch = fieldMatches(fields[2]!, day, 1, 31);
  const monthMatch = fieldMatches(fields[3]!, month, 1, 12);
  const weekdayMatch = fieldMatches(fields[4]!, weekday, 0, 7, true);
  const dayRestricted = fields[2] !== "*";
  const weekdayRestricted = fields[4] !== "*";
  const calendarDayMatch = dayRestricted && weekdayRestricted ? dayMatch || weekdayMatch : dayMatch && weekdayMatch;
  return minuteMatch && hourMatch && monthMatch && calendarDayMatch;
}

export function validateCron(expression: string, timezone: string): void {
  cronMatches(expression, timezone, new Date("2026-01-04T00:00:00.000Z"));
}

function fieldMatches(field: string, current: number, minimum: number, maximum: number, sundayAlias = false): boolean {
  let matched = false;
  for (const segment of field.split(",")) {
    const [rangeExpression, stepExpression] = segment.split("/");
    if (rangeExpression === undefined || segment.split("/").length > 2) throw schedulerError("SCHEDULE_CRON_INVALID", `Invalid cron field ${field}`);
    const step = stepExpression === undefined ? 1 : Number(stepExpression);
    if (!Number.isInteger(step) || step <= 0) throw schedulerError("SCHEDULE_CRON_INVALID", `Invalid cron step ${segment}`);
    let start: number;
    let end: number;
    if (rangeExpression === "*") {
      start = minimum;
      end = maximum;
    } else if (rangeExpression.includes("-")) {
      const values = rangeExpression.split("-");
      if (values.length !== 2) throw schedulerError("SCHEDULE_CRON_INVALID", `Invalid cron range ${rangeExpression}`);
      start = cronNumber(values[0]!, minimum, maximum);
      end = cronNumber(values[1]!, minimum, maximum);
      if (end < start) throw schedulerError("SCHEDULE_CRON_INVALID", `Descending cron range ${rangeExpression} is unsupported`);
    } else {
      start = cronNumber(rangeExpression, minimum, maximum);
      end = start;
    }
    const normalizedCurrent = sundayAlias && current === 0 && start === 7 ? 7 : current;
    if (normalizedCurrent >= start && normalizedCurrent <= end && (normalizedCurrent - start) % step === 0) matched = true;
  }
  return matched;
}

function cronNumber(value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value)) throw schedulerError("SCHEDULE_CRON_INVALID", `Cron value ${value} is not numeric`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw schedulerError("SCHEDULE_CRON_INVALID", `Cron value ${value} is outside ${minimum}-${maximum}`);
  return parsed;
}

function schedulerError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
