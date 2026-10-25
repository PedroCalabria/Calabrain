import type { ApiError } from "@calabrain/shared";
import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { env } from "./env.ts";
import { HttpError } from "./lib/errors.ts";
import { authHandlerRoutes } from "./routes/auth-handler.ts";
import { documentRoutes } from "./routes/documents.ts";
import { folderRoutes } from "./routes/folders.ts";
import { meRoutes } from "./routes/me.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { subjectRoutes } from "./routes/subjects.ts";
import { trashRoutes } from "./routes/trash.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { stopQueue } from "./lib/queue.ts";

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({ trustProxy: true, ...opts });

  app.decorateRequest("user", null);

  await app.register(cors, {
    origin: env.WEB_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });

  app.setErrorHandler((err, request, reply) => {
    let status = 500;
    let body: ApiError = { error: { code: "internal", message: "Something went wrong on our side. Try again." } };

    if (err instanceof HttpError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
    } else if (err instanceof ZodError) {
      status = 400;
      const fields: Record<string, string> = {};
      for (const issue of err.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      body = { error: { code: "invalid_input", message: "Check the highlighted fields.", fields } };
    } else if (typeof (err as { statusCode?: number }).statusCode === "number" && (err as { statusCode: number }).statusCode < 500) {
      status = (err as { statusCode: number }).statusCode;
      body = { error: { code: (err as { code?: string }).code ?? "bad_request", message: (err as Error).message } };
    } else {
      request.log.error(err);
    }
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found." } } satisfies ApiError),
  );

  app.get("/health", async () => ({ ok: true }));
  await app.register(authHandlerRoutes);
  await app.register(meRoutes);
  await app.register(subjectRoutes);
  await app.register(folderRoutes);
  await app.register(sessionRoutes);
  await app.register(trashRoutes);
  await app.register(uploadRoutes);
  await app.register(documentRoutes);
  app.addHook("onClose", stopQueue);

  return app;
}
