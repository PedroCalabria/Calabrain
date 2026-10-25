import { defineConfig } from "vitest/config";

const testDb =
  process.env.TEST_DATABASE_URL ?? "postgres://calabrain:calabrain@localhost:5432/calabrain_test";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDb,
      API_URL: "http://localhost:3000",
      WEB_URL: "http://localhost:5173",
      AUTH_SECRET: "test-secret-test-secret-test-secret-123",
      MAIL_TRANSPORT: "memory",
    },
  },
});
