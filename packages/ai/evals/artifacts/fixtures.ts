import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

// Recorded replies to the artifacts prompt, one per request, and the
// artifacts each should contain. Re-record them when the prompt changes;
// a new case goes in both lists.

export interface ArtifactCase {
  /** Kinds of the artifacts expected, in order; empty for a plain answer. */
  readonly expected: readonly ArtifactKind[];
  readonly input: { readonly id: string; readonly request: string };
}

export const ARTIFACT_CASES: readonly ArtifactCase[] = [
  {
    expected: ["react"],
    input: { id: "counter", request: "Make me a React counter button." },
  },
  {
    expected: ["mermaid"],
    input: {
      id: "login-sequence",
      request: "Draw a sequence diagram of an OAuth login.",
    },
  },
  {
    expected: ["svg"],
    input: { id: "sun-icon", request: "An SVG icon of a sun, please." },
  },
  {
    expected: ["html", "code"],
    input: {
      id: "landing-and-script",
      request:
        "A one-page HTML landing page, and a Python script that serves it.",
    },
  },
  {
    expected: [],
    input: { id: "plain-answer", request: "What's the capital of Portugal?" },
  },
];

const fence = "```";

export const RECORDED_REPLIES: Readonly<Record<string, string>> = {
  counter: [
    "Here's a small counter component:",
    "",
    ':::artifact{identifier="counter-button" type="react" title="Counter button"}',
    `${fence}tsx`,
    'import { useState } from "react";',
    "",
    "export default function Counter() {",
    "  const [count, setCount] = useState(0);",
    "  return (",
    '    <button type="button" onClick={() => setCount((n) => n + 1)}>',
    "      Clicked {count} times",
    "    </button>",
    "  );",
    "}",
    fence,
    ":::",
    "",
    "Click it to count up.",
  ].join("\n"),
  "landing-and-script": [
    "Two artifacts: the page, then a tiny server for it.",
    "",
    ':::artifact{identifier="landing-page" type="html" title="Landing page"}',
    `${fence}html`,
    "<!doctype html>",
    '<html lang="en">',
    "  <body><h1>Hello</h1><p>Welcome aboard.</p></body>",
    "</html>",
    fence,
    ":::",
    "",
    ':::artifact{identifier="serve-page" type="code" title="serve.py"}',
    `${fence}python`,
    "from http.server import SimpleHTTPRequestHandler, HTTPServer",
    "",
    'HTTPServer(("", 8000), SimpleHTTPRequestHandler).serve_forever()',
    fence,
    ":::",
  ].join("\n"),
  "login-sequence": [
    ':::artifact{identifier="oauth-login" type="mermaid" title="OAuth login"}',
    `${fence}mermaid`,
    "sequenceDiagram",
    "  User->>App: Sign in",
    "  App->>Provider: Redirect with client id",
    "  Provider-->>App: Authorization code",
    "  App->>Provider: Exchange code for tokens",
    fence,
    ":::",
  ].join("\n"),
  "plain-answer": "Lisbon is the capital of Portugal.",
  "sun-icon": [
    ':::artifact{identifier="sun-icon" type="svg" title="Sun"}',
    `${fence}svg`,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
    '  <circle cx="12" cy="12" r="5" fill="currentColor" />',
    "</svg>",
    fence,
    ":::",
  ].join("\n"),
};
