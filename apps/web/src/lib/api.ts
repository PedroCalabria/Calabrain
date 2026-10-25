import type { ApiError } from "@calabrain/shared";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** JSON request to the API with the session cookie. Throws ApiRequestError on failure. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? "unknown", err?.message ?? "Request failed.", err?.fields);
  }
  return body as T;
}
