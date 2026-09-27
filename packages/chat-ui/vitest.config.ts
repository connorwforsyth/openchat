import { defineProject } from "vitest/config";

// The sandbox panel's pure model runs in Node. Component tests (browser
// mode, like `composer`) arrive with the rest of chat-ui.
export default defineProject({
  test: {
    include: ["src/**/*.test.ts"],
    name: "chat-ui",
  },
});
