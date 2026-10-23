import { describe, expect, it } from "vitest";

import { fillAgentVariables } from "./agent-variables";

const values = {
  current_date: "Thursday, 22 October 2026",
  current_user: "Dana",
};

describe("fillAgentVariables", () => {
  it("fills every known placeholder, spaces inside the braces allowed", () => {
    expect(
      fillAgentVariables(
        "Today is {{current_date}}. Greet {{ current_user }}, then {{current_user}}.",
        values
      )
    ).toBe("Today is Thursday, 22 October 2026. Greet Dana, then Dana.");
  });

  it("leaves unknown placeholders as written", () => {
    expect(fillAgentVariables("Fill in {{topic}} later.", values)).toBe(
      "Fill in {{topic}} later."
    );
  });

  it("doesn't fill a value's own braces again", () => {
    expect(
      fillAgentVariables("Hi {{current_user}}", {
        ...values,
        current_user: "{{current_date}}",
      })
    ).toBe("Hi {{current_date}}");
  });
});
