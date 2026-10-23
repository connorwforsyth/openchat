import { describe, expect, it } from "vitest";

import { compileTsx } from "./compile-tsx";

describe("compileTsx", () => {
  it("passes TSX the runtime can compile", () => {
    expect(
      compileTsx(
        'import { Title } from "@workspace/slide-ui";\nexport default function S() { return <Title title="Hi" />; }'
      )
    ).toBeNull();
  });

  it("says where TSX breaks, with the line it breaks on", () => {
    const problem = compileTsx(
      'import { Title } from "@workspace/slide-ui";\nexport default function S() { return <Title title="Hi" ; }'
    );
    expect(problem).toContain("(2:");
    expect(problem).toContain("at `export default function S()");
  });
});
