import { createAuthClient } from "better-auth/react";
import { API_URL } from "./api.ts";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
});

/** Better Auth error codes → the copy the user sees. */
const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That e-mail and password don't match. Check both and try again.",
  USER_ALREADY_EXISTS: "There's already an account with this e-mail. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "There's already an account with this e-mail. Sign in instead.",
  PASSWORD_TOO_SHORT: "Use at least 10 characters.",
  PASSWORD_TOO_LONG: "Use at most 128 characters.",
  INVALID_TOKEN: "This reset link has expired or was already used. Ask for a new one.",
  INVALID_EMAIL: "Enter a valid e-mail address.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "New accounts are closed on this Calabrain.",
};

export function authErrorMessage(error: { code?: string | undefined; message?: string | undefined; status?: number }): string {
  if (error.code && messages[error.code]) return messages[error.code]!;
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  return "Something went wrong on our side. Try again.";
}
