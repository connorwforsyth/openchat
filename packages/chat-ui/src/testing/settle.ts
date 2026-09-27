import { waitFor } from "@testing-library/react";

// Helpers that let component tests wait on something definite instead of on
// time (ticket 037).

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/**
 * Resolves once the fixture conversation has stopped changing: its maths has
 * rendered (Markdown swaps KaTeX in after its chunk arrives, which is
 * immediate once warmed in `beforeAll`) and the message scroller has had the
 * two frames it takes to observe the resize and re-anchor. Clicks after this
 * land where the test aimed them.
 */
export async function conversationSettled(): Promise<void> {
  await waitFor(() => {
    if (!document.querySelector(".katex")) {
      throw new Error("maths not rendered yet");
    }
  });
  await nextFrame();
  await nextFrame();
}
