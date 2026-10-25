import { describe, expect, it } from "vitest";
import { resetPasswordSchema, signUpSchema } from "./auth.ts";

describe("auth schemas", () => {
  it("normalizes the e-mail and trims the name", () => {
    const r = signUpSchema.parse({ name: "  Pedro ", email: " Pedro@Example.COM ", password: "correct horse battery" });
    expect(r).toEqual({ name: "Pedro", email: "pedro@example.com", password: "correct horse battery" });
  });

  it("rejects short passwords with the product copy", () => {
    const r = signUpSchema.safeParse({ name: "Pedro", email: "p@example.com", password: "short" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Use at least 10 characters.");
  });

  it("requires both new passwords to match", () => {
    const r = resetPasswordSchema.safeParse({ password: "a long password", confirm: "a long passwor" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["confirm"]);
  });
});
