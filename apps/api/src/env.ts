import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the repo-root .env when present (development). In production the variables come from Docker.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const bool = z
  .enum(["true", "false", ""])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(3000),
  API_URL: z.url(),
  WEB_URL: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must have at least 32 characters"),
  /** "false" closes sign-up (a personal install: create your account, then turn it off). */
  SIGNUP_ENABLED: z
    .enum(["true", "false", ""])
    .default("true")
    .transform((v) => v !== "false"),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().default("Calabrain <no-reply@calabrain.local>"),
  /** "smtp" sends for real; "memory" keeps messages in an in-process outbox (tests). */
  MAIL_TRANSPORT: z.enum(["smtp", "memory"]).default("smtp"),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${issues}\nCopy .env.example to .env and fill it in.`);
}

export const env = parsed.data;
export type Env = typeof env;
