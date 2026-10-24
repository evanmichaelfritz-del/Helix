import type { ZodType } from "zod";
import { zValidator } from "@hono/zod-validator";

const MAX_ZOD_MESSAGE = 200;
const noInput = Symbol("no-zod-input");

function clipZodMessage(message: string): string {
  if (message.length <= MAX_ZOD_MESSAGE) return message;
  let clipped = message.slice(0, MAX_ZOD_MESSAGE - 1);
  const last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

/** Fields shared by Zod 4 issues. Custom messages are kept when they differ from the v4 default. */
type FormattableIssue = {
  code?: string;
  path: readonly PropertyKey[];
  message: string;
  expected?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  exact?: boolean;
  format?: string;
  pattern?: string;
  prefix?: string;
  suffix?: string;
  includes?: string;
  divisor?: number | bigint;
  keys?: readonly PropertyKey[];
  values?: readonly unknown[];
  options?: readonly unknown[];
};

const SIZABLE_UNIT: Record<string, string> = {
  string: "characters",
  file: "bytes",
  array: "items",
  set: "items",
  map: "entries",
};

const FORMAT_NAME: Record<string, string> = {
  regex: "input",
  email: "email address",
  url: "URL",
  emoji: "emoji",
  uuid: "UUID",
  uuidv4: "UUIDv4",
  uuidv6: "UUIDv6",
  nanoid: "nanoid",
  guid: "GUID",
  cuid: "cuid",
  cuid2: "cuid2",
  ulid: "ULID",
  xid: "XID",
  ksuid: "KSUID",
  datetime: "ISO datetime",
  date: "ISO date",
  time: "ISO time",
  duration: "ISO duration",
  ipv4: "IPv4 address",
  ipv6: "IPv6 address",
  mac: "MAC address",
  cidrv4: "IPv4 range",
  cidrv6: "IPv6 range",
  base64: "base64-encoded string",
  base64url: "base64url-encoded string",
  json_string: "JSON string",
  e164: "E.164 number",
  currency_code: "currency code",
  credit_card: "credit card number",
  iban: "IBAN",
  jwt: "JWT",
  template_literal: "input",
};

function stringifyPrimitive(value: unknown): string {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "string") return `"${value}"`;
  return `${value}`;
}

function v4BoundMessage(issue: FormattableIssue, kind: "big" | "small"): string | null {
  const bound = kind === "big" ? issue.maximum : issue.minimum;
  if (bound === undefined) return null;
  const adj = issue.exact
    ? "exactly "
    : kind === "big"
      ? issue.inclusive
        ? "<="
        : "<"
      : issue.inclusive
        ? ">="
        : ">";
  const unit = issue.origin ? SIZABLE_UNIT[issue.origin] : undefined;
  if (unit) {
    const origin = kind === "big" ? (issue.origin ?? "value") : issue.origin;
    return `Too ${kind}: expected ${origin} to have ${adj}${bound.toString()} ${unit}`;
  }
  return `Too ${kind}: expected ${issue.origin ?? "value"} to be ${adj}${bound.toString()}`;
}

function v4DefaultMessage(issue: FormattableIssue): string | null {
  switch (issue.code) {
    case "too_big":
      return v4BoundMessage(issue, "big");
    case "too_small":
      return v4BoundMessage(issue, "small");
    case "invalid_format": {
      if (issue.format === "starts_with") return `Invalid string: must start with "${issue.prefix ?? ""}"`;
      if (issue.format === "ends_with") return `Invalid string: must end with "${issue.suffix ?? ""}"`;
      if (issue.format === "includes") return `Invalid string: must include "${issue.includes ?? ""}"`;
      if (issue.format === "regex") return `Invalid string: must match pattern ${issue.pattern ?? ""}`;
      const name = (issue.format && FORMAT_NAME[issue.format]) || issue.format || "input";
      return `Invalid ${name}`;
    }
    case "invalid_value": {
      const values = issue.values ?? [];
      if (values.length === 1) return `Invalid input: expected ${stringifyPrimitive(values[0])}`;
      return `Invalid option: expected one of ${values.map(stringifyPrimitive).join("|")}`;
    }
    case "invalid_type": {
      const expected = issue.expected === "nan" ? "NaN" : issue.expected;
      const pattern = /^Invalid input: expected (.*), received (.*)$/;
      const match = pattern.exec(issue.message);
      if (!match || match[1] !== expected) return null;
      return issue.message;
    }
    case "not_multiple_of":
      return issue.divisor === undefined ? null : `Invalid number: must be a multiple of ${issue.divisor}`;
    case "unrecognized_keys": {
      const keys = issue.keys ?? [];
      return `Unrecognized key${keys.length > 1 ? "s" : ""}: ${keys.map(stringifyPrimitive).join(", ")}`;
    }
    case "invalid_union": {
      if (issue.options && issue.options.length > 0) {
        return `Invalid discriminator value. Expected ${issue.options.map((option) => `'${String(option)}'`).join(" | ")}`;
      }
      if (issue.inclusive === false) return "Invalid input: more than one option matched";
      return "Invalid input";
    }
    case "custom":
      return "Invalid input";
    default:
      return null;
  }
}

function quoteV3(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : `${value}`;
}

function v3BoundMessage(issue: FormattableIssue, kind: "big" | "small"): string {
  const origin = issue.origin === "int" ? "number" : issue.origin;
  const exact = Boolean(issue.exact);
  const inclusive = Boolean(issue.inclusive);
  if (kind === "small") {
    const minimum = issue.minimum;
    if (origin === "array") {
      return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${minimum} element(s)`;
    }
    if (origin === "string") {
      return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${minimum} character(s)`;
    }
    if (origin === "number" || origin === "bigint") {
      return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${minimum}`;
    }
    if (origin === "date") {
      return `Date must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(minimum))}`;
    }
    return "Invalid input";
  }
  const maximum = issue.maximum;
  if (origin === "array") {
    return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${maximum} element(s)`;
  }
  if (origin === "string") {
    return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${maximum} character(s)`;
  }
  if (origin === "number") {
    return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
  }
  if (origin === "bigint") {
    return `BigInt must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
  }
  if (origin === "date") {
    return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(maximum))}`;
  }
  return "Invalid input";
}

function receivedLabel(received: string, expected: string | undefined): string {
  if (expected === "int" && received === "number") return "float";
  if (received === "NaN") return "nan";
  if (received === "Infinity" || received === "-Infinity") return "number";
  if (received === "Date") return "date";
  if (received === "Map") return "map";
  if (received === "Set") return "set";
  if (received === "Promise") return "promise";
  return received;
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function v3Message(issue: FormattableIssue, input: unknown, hasInput: boolean): string {
  switch (issue.code) {
    case "too_big":
      return v3BoundMessage(issue, "big");
    case "too_small":
      return v3BoundMessage(issue, "small");
    case "invalid_format":
      if (issue.format === "regex") return "Invalid";
      if (issue.format === "starts_with") return `Invalid input: must start with "${issue.prefix ?? ""}"`;
      if (issue.format === "ends_with") return `Invalid input: must end with "${issue.suffix ?? ""}"`;
      if (issue.format === "includes") return `Invalid input: must include "${issue.includes ?? ""}"`;
      if (issue.format === "email") return "Invalid email";
      return `Invalid ${issue.format ?? "input"}`;
    case "invalid_value": {
      const expected = (issue.values ?? []).map(quoteV3).join(" | ");
      const received = hasInput ? `, received '${String(valueAt(input, issue.path))}'` : "";
      return `Invalid enum value. Expected ${expected}${received}`;
    }
    case "invalid_type": {
      const match = /^Invalid input: expected (.*), received (.*)$/.exec(issue.message);
      const received = match?.[2] ?? "unknown";
      if (received === "undefined") return "Required";
      const expected = issue.expected === "int" ? "integer" : (issue.expected ?? match?.[1] ?? "value");
      return `Expected ${expected}, received ${receivedLabel(received, issue.expected)}`;
    }
    case "not_multiple_of":
      return `Number must be a multiple of ${issue.divisor}`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${(issue.keys ?? []).map(quoteV3).join(", ")}`;
    case "invalid_union":
      if (issue.options && issue.options.length > 0) {
        return `Invalid discriminator value. Expected ${issue.options.map(quoteV3).join(" | ")}`;
      }
      return "Invalid input";
    default:
      return issue.message;
  }
}

function issueText(issue: FormattableIssue, input: unknown, hasInput: boolean): string {
  const defaults = v4DefaultMessage(issue);
  if (defaults === null || issue.message !== defaults) return issue.message;
  return v3Message(issue, input, hasInput);
}

/** One string the client can show. Zod's default body is an object, so api.ts falls through to statusText. */
export function formatZodError(error: { issues: readonly FormattableIssue[] }, input: unknown = noInput): string {
  const issue = error.issues[0];
  if (!issue) return "request: Invalid request";
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "request";
  return `${path}: ${clipZodMessage(issueText(issue, input, input !== noInput))}`;
}

export function validate<T extends ZodType>(target: "json", schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: formatZodError(result.error, result.data) }, 400);
    }
  });
}
