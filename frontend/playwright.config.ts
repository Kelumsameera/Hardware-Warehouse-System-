import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", timeout: 60000, workers: 1,
  use: { baseURL: "http://localhost:3008", browserName: "chromium", trace: "retain-on-failure" },
  webServer: [
    { command: "node ../backend/tests/helpers/qa-server.mjs", url: "http://127.0.0.1:4008/api/health", env: { MONGODB_TEST_URI: "mongodb://127.0.0.1:27028/wms_ui_test?replicaSet=wmsqa" }, timeout: 60000 },
    { command: "npm run dev -- --port 3008", url: "http://localhost:3008/login", env: { WMS_QA: "1", BACKEND_API_URL: "http://127.0.0.1:4008/api", NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:4008", SESSION_COOKIE_SECURE: "false" }, timeout: 120000 },
  ],
});
