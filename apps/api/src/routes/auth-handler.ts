import type { FastifyInstance } from "fastify";
import { auth } from "../auth/auth.ts";

/** Hands /api/auth/* to Better Auth (sign-up, sign-in, sign-out, session, password reset). */
export async function authHandlerRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `${request.protocol}://${request.headers.host ?? "localhost"}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const hasBody = request.method !== "GET" && request.body !== undefined && request.body !== null;
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          body: hasBody ? JSON.stringify(request.body) : undefined,
        }),
      );

      reply.status(response.status);
      const cookies = response.headers.getSetCookie();
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
