import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Most tests are pure and need no DOM; the interaction smoke test opts in
    // with a `@vitest-environment jsdom` docblock.
    environment: "node",
    // Standing up jsdom and importing the app can pass 5s when the whole suite
    // runs in parallel on a loaded machine, which failed the interaction test
    // twice on timing alone. The assertions are unchanged — this is startup
    // cost, not a slow test.
    testTimeout: 20000,
  },
});
