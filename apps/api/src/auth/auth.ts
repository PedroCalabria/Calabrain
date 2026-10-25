import { PASSWORD_MAX, PASSWORD_MIN } from "@calabrain/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { resetPasswordMail, sendMail } from "../lib/mailer.ts";

export const auth = betterAuth({
  appName: "Calabrain",
  baseURL: env.API_URL,
  basePath: "/api/auth",
  secret: env.AUTH_SECRET,
  trustedOrigins: [env.WEB_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: schema.users,
      auth_sessions: schema.authSessions,
      auth_accounts: schema.authAccounts,
      auth_verifications: schema.authVerifications,
    },
  }),
  user: { modelName: "users" },
  session: {
    modelName: "auth_sessions",
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day of use
  },
  account: { modelName: "auth_accounts" },
  verification: { modelName: "auth_verifications" },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, token }) {
      // Link straight to the web app's reset screen; the token goes back in the reset call.
      const url = `${env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await sendMail(resetPasswordMail(user.email, user.name, url));
    },
  },
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    window: 60,
    max: 30,
  },
  advanced: {
    // Better Auth skips the origin/CSRF check when NODE_ENV=test; keep it on everywhere so tests cover it.
    disableOriginCheck: false,
    database: { generateId: () => crypto.randomUUID() },
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: env.API_URL.startsWith("https://"),
      httpOnly: true,
    },
  },
});

export type Auth = typeof auth;
