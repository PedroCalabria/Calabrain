import type { FastifyInstance, LightMyRequestResponse } from "fastify";

export const ORIGIN = "http://localhost:5173";

let counter = 0;
export const uniqueEmail = () => `user${Date.now()}${counter++}@example.com`;

/** The cookie header to send back, built from a response's set-cookie headers. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

export function post(app: FastifyInstance, url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
  });
}

export async function signUp(app: FastifyInstance, password = "correct horse battery") {
  const email = uniqueEmail();
  const res = await post(app, "/api/auth/sign-up/email", { name: "Pedro", email, password });
  return { res, email, password, cookie: cookieFrom(res) };
}
