import { render, screen, within } from "@testing-library/react";
import { SITE_UI_EXPORTS } from "@workspace/artifacts-kit/kinds/site/tsx";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

// biome-ignore lint/performance/noNamespaceImport: the test compares the module's whole export list.
import * as siteUi from "./index";
import {
  Cta,
  Faq,
  FeatureGrid,
  Footer,
  Hero,
  Nav,
  Page,
  Pricing,
  Prose,
  Section,
  Stats,
  Testimonial,
} from "./index";

// site-ui's blocks (163), in a real browser: what they render from their
// props, as a visitor (and a screen reader) meets it.

describe("site-ui's exports", () => {
  it("are exactly the components the Site kind lets a page import", () => {
    expect(Object.keys(siteUi).sort()).toEqual([...SITE_UI_EXPORTS].sort());
  });
});

describe("site-ui's blocks", () => {
  it("lay out a page: a labelled nav, one heading per block, a labelled footer", () => {
    render(
      <Page>
        <Nav
          brand="Harbour"
          cta={{ href: "#book", label: "Book" }}
          label="Main"
          links={[{ href: "about.html", label: "About" }]}
        />
        <Hero
          actions={[
            { href: "#pricing", icon: "arrow-right", label: "See prices" },
          ]}
          description="Two hours on foot."
          eyebrow="Spring"
          title="Harbour walks"
        />
        <FeatureGrid
          features={[
            { description: "Eight at most.", icon: "users", title: "Small" },
            // A name the model made up draws no icon, and breaks nothing.
            {
              description: "Morning and evening.",
              icon: "constructor" as "users",
              title: "Two hours",
            },
          ]}
          id="features"
          title="Why walk"
        />
        <Footer
          label="Footer"
          links={[{ href: "index.html", label: "Home" }]}
          note="© 2026"
        />
      </Page>
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav).getByRole("link", { name: "Harbour" }).getAttribute("href")
    ).toBe("index.html");
    expect(
      within(nav).getByRole("link", { name: "About" }).getAttribute("href")
    ).toBe("about.html");
    expect(within(nav).getByRole("link", { name: "Book" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Harbour walks" })
    ).toBeTruthy();
    expect(screen.getByText("Spring")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See prices" }).getAttribute("href")
    ).toBe("#pricing");
    expect(
      screen.getByRole("heading", { level: 2, name: "Why walk" })
    ).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(document.getElementById("features")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeTruthy();
    // Icons are decoration beside their text.
    for (const icon of document.querySelectorAll("svg")) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
    expect(document.querySelectorAll("li svg")).toHaveLength(1);
  });

  it("show figures, a quote, plans and a closing ask", () => {
    render(
      <Page>
        <Stats stats={[{ label: "Walkers", value: "12k" }]} tone="muted" />
        <Testimonial author="Ana" byline="Visitor" quote="The best morning." />
        <Pricing
          plans={[
            {
              action: { href: "#a", label: "Book" },
              features: ["Two hours"],
              name: "Day",
              period: "/person",
              price: "$25",
            },
            {
              action: { href: "#b", label: "Enquire" },
              badge: "Popular",
              features: ["Any time"],
              highlighted: true,
              name: "Private",
              price: "$180",
            },
          ]}
          title="Prices"
        />
        <Cta actions={[{ href: "#a", label: "Start" }]} title="Ready?" />
      </Page>
    );
    expect(screen.getByText("12k").tagName).toBe("DD");
    expect(screen.getByText("Walkers").tagName).toBe("DT");
    expect(
      screen.getByText("The best morning.").closest("blockquote")
    ).not.toBeNull();
    expect(screen.getByText("Popular")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Day" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Enquire" }).getAttribute("href")
    ).toBe("#b");
    expect(
      screen.getByRole("heading", { level: 2, name: "Ready?" })
    ).toBeTruthy();
  });

  it("open a question to its answer, natively", async () => {
    render(
      <Faq
        items={[{ answer: "We walk anyway.", question: "What if it rains?" }]}
        title="Questions"
      />
    );
    const details = document.querySelector("details");
    expect(details?.open).toBe(false);
    await userEvent.click(screen.getByText("What if it rains?"));
    expect(details?.open).toBe(true);
    expect(screen.getByText("We walk anyway.")).toBeTruthy();
  });

  it("hold your own content in a section, and running text in prose", () => {
    render(
      <Page>
        <Section description="On the quay." id="find" title="Find us">
          <p>Meet at the clock tower.</p>
        </Section>
        <Prose>
          <h1>About</h1>
          <p>Since 2019.</p>
        </Prose>
      </Page>
    );
    expect(document.getElementById("find")?.tagName).toBe("SECTION");
    expect(screen.getByRole("heading", { name: "Find us" })).toBeTruthy();
    expect(screen.getByText("Meet at the clock tower.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "About" })
    ).toBeTruthy();
  });
});
