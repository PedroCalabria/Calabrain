import type { Me } from "@calabrain/shared";
import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: requireUser }, async (request): Promise<Me> => {
    const user = currentUser(request);
    return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt.toISOString() };
  });
}
