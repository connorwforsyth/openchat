import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useScreenLink } from "./screen-link";

const GIVES_UP = `<script>parent.postMessage({ source: "dot-computer", state: "failed" }, "*")</script>`;
const QUIET = "<p>connecting</p>";

/** A frame wired like the computer panel's, showing what the link reports. */
function Screen({
  doc,
  mount,
}: {
  readonly doc: string;
  readonly mount: number;
}) {
  const link = useScreenLink();
  return (
    <>
      <output>{link.failed ? "disconnected" : "live"}</output>
      <iframe
        key={`${mount}-${link.attempt}`}
        ref={link.ref}
        sandbox="allow-scripts"
        srcDoc={doc}
        title="screen"
      />
    </>
  );
}

afterEach(cleanup);

describe("useScreenLink", () => {
  it("forgets a disconnect once the frame remounts", async () => {
    const { rerender } = render(<Screen doc={GIVES_UP} mount={0} />);
    await expect
      .poll(() => screen.getByRole("status").textContent)
      .toBe("disconnected");
    rerender(<Screen doc={QUIET} mount={1} />);
    await expect
      .poll(() => screen.getByRole("status").textContent)
      .toBe("live");
  });
});
