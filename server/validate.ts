import type { ZodError, ZodType } from "zod";
import { zValidator } from "@hono/zod-validator";

/** One string the client can show. Zod's default body is an object, so api.ts falls through to statusText. */
export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "request: Invalid request";
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "request";
  return `${path}: ${issue.message}`;
}

export function validate<T extends ZodType>(target: "json", schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: formatZodError(result.error) }, 400);
    }
  });
}
