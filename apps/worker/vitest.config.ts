import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_WORKER_DATABASE_URL ?? "postgres://calabrain:calabrain@localhost:5432/calabrain_worker_test",
      S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9100",
      S3_REGION: "us-east-1",
      S3_BUCKET: "calabrain-worker-test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test-secret",
      S3_FORCE_PATH_STYLE: "true",
    },
  },
});
