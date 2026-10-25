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
      // S3-compatible test server (moto_server) on :9100, away from the dev MinIO on :9000.
      S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9100",
      S3_REGION: "us-east-1",
      S3_BUCKET: "calabrain-test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test-secret",
      S3_FORCE_PATH_STYLE: "true",
    },
  },
});
