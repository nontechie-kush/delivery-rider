import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Most tests are pure and need no DOM; the interaction smoke test opts in
    // with a `@vitest-environment jsdom` docblock.
    environment: "node",
  },
});
