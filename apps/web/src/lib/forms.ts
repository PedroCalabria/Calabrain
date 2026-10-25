import type { ZodType } from "zod";

/** Validates with a shared schema and returns the first message per field. */
export function validate<T>(schema: ZodType<T>, values: unknown):
  | { ok: true; data: T }
  | { ok: false; fields: Record<string, string> } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_");
    fields[key] ??= issue.message;
  }
  return { ok: false, fields };
}
