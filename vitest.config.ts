import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    {
      name: "markdown-text",
      transform(code, id) {
        if (id.endsWith(".md"))
          return { code: `export default ${JSON.stringify(code)}`, map: null };
      },
    },
    cloudflareTest(async () => ({
      main: "./src/server/index.ts",
      miniflare: {
        compatibilityDate: "2026-10-27",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["ARTIFACTS"],
        queueProducers: { BUILDS: "test-builds" },
        durableObjects: { LIVE: { className: "ProjectLive", useSQLite: true } },
        ratelimits: {
          AUTH_LIMITER: {
            namespace_id: "1001",
            simple: { limit: 20, period: 60 },
          },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test-google-secret",
          DAILY_BUILD_LIMIT: "100",
          RELEASE_SHA: "test",
        },
      },
    })),
  ],
  test: { include: ["src/server/**/*.test.ts"] },
});
