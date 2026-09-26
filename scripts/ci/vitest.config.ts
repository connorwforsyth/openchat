import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    exclude: ["__fixtures__/**", "**/node_modules/**"],
    include: ["**/*.test.ts"],
    name: "guards",
  },
});
