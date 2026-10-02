import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "./packages/core", include: ["src/**/*.test.ts"] } },
      { test: { name: "prism-payment", root: "./packages/prism-payment", include: ["src/**/*.test.ts"] } },
    ],
  },
})
