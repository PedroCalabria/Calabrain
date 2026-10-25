import type { Me } from "@calabrain/shared";
import { queryOptions } from "@tanstack/react-query";
import { authClient } from "./auth-client.ts";

/** The signed-in user, or null when there is no session (answers 200 either way, no console noise). */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(error.message ?? "Couldn't check your session.");
    if (!data) return null;
    const { id, name, email, createdAt } = data.user;
    return { id, name, email, createdAt: new Date(createdAt).toISOString() };
  },
  staleTime: 60_000,
});

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
