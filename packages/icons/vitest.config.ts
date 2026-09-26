import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    include: ["{src,scripts}/**/*.test.{ts,tsx}"],
    name: "icons",
  },
});
