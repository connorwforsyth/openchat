import { chatArtifacts } from "@workspace/chat-ui/fixtures";
import { conversation, fixtureId, userAda } from "@workspace/contract/fixtures";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";

// One artifact of each kind the artifact runtime renders, on top of the
// chat fixtures' HTML page and Markdown plan. The React one's first version
// imports a module previews don't allow, to show how errors look. Sample
// content, not UI copy, so it isn't localised.

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 8, 27, 9, minute)).toISOString();
const messageId = fixtureId("message", 104);

const artifact = (
  n: number,
  kind: Artifact["kind"],
  title: string,
  versions: number
): Artifact => ({
  conversationId: conversation.id,
  createdAt: at(4),
  id: fixtureId("artifact", n),
  kind,
  latestVersionId: fixtureId("artifactVersion", n + versions - 1),
  messageId,
  ownerId: userAda.id,
  title,
  updatedAt: at(4 + versions),
});

const version = (
  owner: Artifact,
  n: number,
  number: number,
  content: string
): ArtifactVersion => ({
  artifactId: owner.id,
  content,
  conversationId: owner.conversationId,
  createdAt: at(4 + number),
  id: fixtureId("artifactVersion", n),
  language: null,
  messageId,
  number,
});

const counter = artifact(31, "react", "Counter.tsx", 2);
const diagram = artifact(41, "mermaid", "search-pipeline.mmd", 1);
const chart = artifact(51, "svg", "latency.svg", 1);

const counterBroken = `import { useState } from "react";
import confetti from "canvas-confetti";

export default function Counter() {
  const [count, setCount] = useState(0);
  const add = () => {
    setCount(count + 1);
    confetti();
  };
  return <button onClick={add}>Count {count}</button>;
}
`;

const counterFixed = `import { useEffect, useState } from "react";

type Props = { start?: number };

export default function Counter({ start = 0 }: Props) {
  const [count, setCount] = useState(start);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    setLog((entries) => [\`count is \${count}\`, ...entries].slice(0, 3));
  }, [count]);

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Counter</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setCount((n) => n - 1)}>-1</button>
        <output style={{ minWidth: 32, textAlign: "center" }}>{count}</output>
        <button onClick={() => setCount((n) => n + 1)}>+1</button>
      </div>
      <ul>
        {log.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </main>
  );
}
`;

const pipeline = `flowchart LR
  write[Message saved] --> outbox[(Outbox)]
  outbox --> worker{{Worker, every 2 s}}
  worker --> meili[(Meilisearch)]
  worker -. on failure .-> retry[Retry with backoff]
  retry --> worker
  query[Search box] --> meili
`;

const latency = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" font-family="system-ui" font-size="12" fill="currentColor">
  <text x="8" y="20" font-size="14" font-weight="600">p95 latency (ms)</text>
  <text x="8" y="58">Postgres FTS</text>
  <rect x="104" y="44" width="190" height="20" rx="3" fill-opacity="0.35" />
  <text x="300" y="58" text-anchor="end">38</text>
  <text x="8" y="98">Meilisearch</text>
  <rect x="104" y="84" width="30" height="20" rx="3" fill-opacity="0.7" />
  <text x="140" y="98">6</text>
</svg>
`;

export const demoArtifacts: readonly Artifact[] = [
  ...chatArtifacts,
  counter,
  diagram,
  chart,
];

export const demoArtifactVersions: Readonly<
  Record<string, readonly ArtifactVersion[]>
> = {
  [counter.id]: [
    version(counter, 31, 1, counterBroken),
    version(counter, 32, 2, counterFixed),
  ],
  [diagram.id]: [version(diagram, 41, 1, pipeline)],
  [chart.id]: [version(chart, 51, 1, latency)],
};
