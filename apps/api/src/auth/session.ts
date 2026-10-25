import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "../lib/errors.ts";
import { auth } from "./auth.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** preHandler for every route that needs a signed-in user. */
export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) throw unauthorized();
  const { id, name, email, createdAt } = session.user;
  request.user = { id, name, email, createdAt };
}

/** The signed-in user inside a route guarded by requireUser. */
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
