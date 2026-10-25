/** An error the API turns into its JSON error body with the given status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/**
 * A resource that doesn't exist or belongs to another user. Both answer 404, never 403,
 * so the API never reveals that someone else's item exists.
 */
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);

export const unauthorized = () => new HttpError(401, "unauthorized", "Sign in to continue.");
