import { buildApp } from "./app.ts";
import { pool } from "./db/client.ts";
import { env } from "./env.ts";

const app = await buildApp({
  logger:
    env.NODE_ENV === "development"
      ? { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
      : { level: "info" },
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
