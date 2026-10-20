import { render, screen } from "@testing-library/react";
import { SLIDE_UI_EXPORTS } from "@workspace/artifacts-kit/kinds/presentation/slides";
import { describe, expect, it } from "vitest";

// biome-ignore lint/performance/noNamespaceImport: the test compares the module's whole export list.
import * as slideUi from "./index";
import {
  Agenda,
  Bullets,
  Closing,
  ImageSlide,
  Logo,
  Notes,
  Quote,
  Section,
  Slide,
  Stat,
  Step,
  Title,
  TwoColumn,
} from "./index";
import { SLIDE_HEIGHT, SLIDE_TYPE, SLIDE_WIDTH } from "./scale";

// slide-ui's layouts (164), in a real browser: the canvas they draw on and
// what they say, as a viewer (and a screen reader) meets it.

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const canvasOf = (container: HTMLElement) => {
  const canvas = container.querySelector<HTMLElement>("[data-slide-canvas]");
  if (!canvas) {
    throw new Error("no canvas");
  }
  return canvas;
};

describe("slide-ui's exports", () => {
  it("are exactly the components the Presentation kind lets a slide import", () => {
    expect(Object.keys(slideUi).sort()).toEqual([...SLIDE_UI_EXPORTS].sort());
  });
});

describe("slide-ui's layouts", () => {
  it("draw on one 1920×1080 canvas, on the theme's colours", () => {
    const { container } = render(<Title subtitle="Q3" title="Review" />);
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([SLIDE_WIDTH, SLIDE_HEIGHT]);
    expect(canvas.style.backgroundColor).toBe("var(--background)");
    expect(screen.getByRole("heading", { name: "Review" }).style.fontSize).toBe(
      `${SLIDE_TYPE.display}px`
    );
  });

  it("say each layout's words", () => {
    render(
      <>
        <Section number="02" title="Results" />
        <Bullets items={["One", "Two"]} title="Points" />
        <TwoColumn left="Before" right="After" title="Change" />
        <Quote author="Ada" byline="Engineer" quote="Hello" />
        <Stat label="growth" value="42%" />
        <ImageSlide alt="A chart" caption="Source: us" src={PIXEL} />
        <Agenda current={1} items={["Intro", "Plan"]} />
        <Closing contact="ada@example.org" title="Thanks" />
      </>
    );
    for (const name of ["Results", "Points", "Change", "Agenda", "Thanks"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("img", { name: "A chart" })).toBeTruthy();
    expect(screen.getByText("“Hello”")).toBeTruthy();
  });

  it("mark steps for the presenter, and keep notes out of sight", () => {
    const { container } = render(
      <Slide>
        <Step>First</Step>
        <Bullets items={["a", "b", "c"]} steps title="Steps" />
        <Notes>Say hello</Notes>
        <Logo text="Acme" />
      </Slide>
    );
    expect(container.querySelectorAll("[data-step]")).toHaveLength(4);
    const notes = container.querySelector<HTMLElement>("[data-notes]");
    expect(notes?.hidden).toBe(true);
    expect(notes?.textContent).toBe("Say hello");
    expect(screen.getByText("Acme")).toBeTruthy();
  });
});
