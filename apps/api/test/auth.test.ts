import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { pool } from "../src/db/client.ts";
import { outbox } from "../src/lib/mailer.ts";
import { ORIGIN, cookieFrom, post, signUp, uniqueEmail } from "./helpers.ts";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("sign-up and session (RF01)", () => {
  it("creates an account and signs the user in", async () => {
    const { res, email, cookie } = await signUp(app);
    expect(res.statusCode).toBe(200);
    expect(cookie).toContain("better-auth.session_token=");

    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ name: "Pedro", email });
  });

  it("stores the e-mail in lowercase and refuses a duplicate", async () => {
    const email = uniqueEmail();
    const first = await post(app, "/api/auth/sign-up/email", {
      name: "Pedro",
      email: email.toUpperCase(),
      password: "correct horse battery",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().user.email).toBe(email);

    const again = await post(app, "/api/auth/sign-up/email", { name: "Other", email, password: "another long password" });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("refuses a password shorter than 10 characters", async () => {
    const res = await post(app, "/api/auth/sign-up/email", { name: "Pedro", email: uniqueEmail(), password: "short" });
    expect(res.statusCode).toBe(400);
  });

  it("answers 401 on /me without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "unauthorized", message: "Sign in to continue." } });
  });
});

describe("sign-in and sign-out", () => {
  it("signs in with the right password and rejects a wrong one", async () => {
    const { email, password } = await signUp(app);

    const wrong = await post(app, "/api/auth/sign-in/email", { email, password: "not the password" });
    expect(wrong.statusCode).toBe(401);

    const ok = await post(app, "/api/auth/sign-in/email", { email, password });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: cookieFrom(ok) } });
    expect(me.statusCode).toBe(200);
  });

  it("ends the session on sign-out", async () => {
    const { cookie } = await signUp(app);
    const out = await post(app, "/api/auth/sign-out", {}, cookie);
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe("password recovery (RF01)", () => {
  it("e-mails a reset link, sets the new password and ends old sessions", async () => {
    const { email, cookie: oldSession } = await signUp(app);
    outbox.length = 0;

    const req = await post(app, "/api/auth/request-password-reset", { email, redirectTo: `${ORIGIN}/reset-password` });
    expect(req.statusCode).toBe(200);
    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(email);
    const link = mail.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/reset-password`);
    const token = url.searchParams.get("token");
    expect(token).toBeTruthy();

    const reset = await post(app, "/api/auth/reset-password", { token, newPassword: "a brand new password" });
    expect(reset.statusCode).toBe(200);

    const stale = await app.inject({ method: "GET", url: "/me", headers: { cookie: oldSession } });
    expect(stale.statusCode).toBe(401);

    const oldPw = await post(app, "/api/auth/sign-in/email", { email, password: "correct horse battery" });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await post(app, "/api/auth/sign-in/email", { email, password: "a brand new password" });
    expect(newPw.statusCode).toBe(200);
  });

  it("does not reveal whether an e-mail has an account", async () => {
    outbox.length = 0;
    const res = await post(app, "/api/auth/request-password-reset", {
      email: uniqueEmail(),
      redirectTo: `${ORIGIN}/reset-password`,
    });
    expect(res.statusCode).toBe(200);
    expect(outbox).toHaveLength(0);
  });

  it("rejects a reused or invented token", async () => {
    const res = await post(app, "/api/auth/reset-password", { token: "invented-token", newPassword: "a brand new password" });
    expect(res.statusCode).toBe(400);
  });
});

describe("cross-origin requests", () => {
  it("allows the web app origin with credentials", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: { origin: ORIGIN, "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("refuses a cookie-carrying auth call from an unknown origin (CSRF)", async () => {
    const { cookie } = await signUp(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      payload: {},
      headers: { origin: "https://evil.example", cookie },
    });
    expect(res.statusCode).toBe(403);
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });
});
