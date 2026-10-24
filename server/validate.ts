import type { ZodError, ZodType } from "zod";
import { zValidator } from "@hono/zod-validator";

const MAX_ZOD_MESSAGE = 200;

function clipZodMessage(message: string): string {
  if (message.length <= MAX_ZOD_MESSAGE) return message;
  let clipped = message.slice(0, MAX_ZOD_MESSAGE - 1);
  const last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

/** One string the client can show. Zod's default body is an object, so api.ts falls through to statusText. */
export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "request: Invalid request";
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "request";
  return `${path}: ${clipZodMessage(issue.message)}`;
}

export function validate<T extends ZodType>(target: "json", schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: formatZodError(result.error) }, 400);
    }
  });
}
