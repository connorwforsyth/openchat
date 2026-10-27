import { NESTED_PROBE_CHANNEL } from "@workspace/chat-ui/artifacts/annotate/probe";
import { describe, expect, it } from "vitest";

import { HTML_REPORTER_CHANNEL, withReporter } from "./documents";

// The reporter, then Annotate's probe.
const REPORTER = /(?:<script>\(\(\) => \{[\s\S]*?<\/script>){2}/;

const strip = (html: string) => html.replace(REPORTER, "<!--reporter-->");

describe("withReporter", () => {
  it("goes first in <head>, keeping the doctype first", () => {
    expect(
      strip(
        withReporter(
          '<!doctype html><html lang="en"><head><title>x</title></head></html>'
        )
      )
    ).toBe(
      '<!doctype html><html lang="en"><head><!--reporter--><title>x</title></head></html>'
    );
  });

  it("falls back to after <html>, then the doctype, then the very start", () => {
    expect(strip(withReporter("<html><body>hi</body></html>"))).toBe(
      "<html><!--reporter--><body>hi</body></html>"
    );
    expect(strip(withReporter("<!DOCTYPE html><p>hi</p>"))).toBe(
      "<!DOCTYPE html><!--reporter--><p>hi</p>"
    );
    expect(strip(withReporter("<p>hi</p>"))).toBe("<!--reporter--><p>hi</p>");
  });

  it("doesn't mistake <header> for <head>", () => {
    expect(strip(withReporter("<header>top</header>"))).toBe(
      "<!--reporter--><header>top</header>"
    );
  });

  it("lets Annotate ask the page what's at a point", () => {
    expect(withReporter("<p>hi</p>")).toContain(NESTED_PROBE_CHANNEL);
  });

  it("posts on the reporter channel", () => {
    expect(withReporter("")).toContain(HTML_REPORTER_CHANNEL);
  });
});
