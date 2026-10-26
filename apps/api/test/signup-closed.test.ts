import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { post, uniqueEmail } from "./helpers.ts";

// env.ts reads the variables once, at import: set the switch before loading the app.
process.env.SIGNUP_ENABLED = "false";
const { buildApp } = await import("../src/app.ts");
const { pool } = await import("../src/db/client.ts");

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("closed sign-up (SIGNUP_ENABLED=false)", () => {
  it("refuses new accounts with a code the web app explains", async () => {
    const res = await post(app, "/api/auth/sign-up/email", { name: "Someone", email: uniqueEmail(), password: "correct horse battery" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
  });
});
