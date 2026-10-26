import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";
import { env } from "../env.ts";
import { subscribe } from "../lib/events.ts";

/** Server-Sent Events: processing status of documents, notes and recordings, as it changes (RF16). */
export async function eventRoutes(app: FastifyInstance) {
  app.get("/events", { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: don't buffer the stream
      "access-control-allow-origin": env.WEB_URL,
      "access-control-allow-credentials": "true",
      vary: "Origin",
    });
    res.write("retry: 3000\n: connected\n\n");

    const unsubscribe = await subscribe(user.id, (event) => {
      const { userId: _omit, ...data } = event;
      res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
