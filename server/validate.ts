import type { ZodError, ZodType } from "zod";
import { zValidator } from "@hono/zod-validator";

const MAX_ZOD_MESSAGE = 200;

/** One string the client can show. Zod's default body is an object, so api.ts falls through to statusText. */
export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "request: Invalid request";
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "request";
  const message =
    issue.message.length > MAX_ZOD_MESSAGE
      ? `${issue.message.slice(0, MAX_ZOD_MESSAGE - 1)}…`
      : issue.message;
  return `${path}: ${message}`;
}

export function validate<T extends ZodType>(target: "json", schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: formatZodError(result.error) }, 400);
    }
  });
}
