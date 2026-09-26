#!/usr/bin/env bun
/** Prints the wayfinder frontier: open, unblocked, unclaimed tickets. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "tickets");

type Ticket = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  labels: string[];
  blockedBy: string[];
  file: string;
};

const field = (src: string, key: string) =>
  src.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";

const list = (src: string, key: string) =>
  field(src, key)
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

const tickets: Ticket[] = readdirSync(dir)
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const src = readFileSync(join(dir, file), "utf8");
    return {
      id: field(src, "id"),
      title: field(src, "title"),
      status: field(src, "status"),
      assignee: field(src, "assignee"),
      labels: list(src, "labels"),
      blockedBy: list(src, "blockedBy"),
      file,
    };
  });

const byId = new Map(tickets.map((t) => [t.id, t]));
const closed = (id: string) => byId.get(id)?.status === "closed";

const frontier = tickets.filter(
  (t) => t.status === "open" && !t.assignee && t.blockedBy.every(closed),
);
const blocked = tickets.filter(
  (t) => t.status === "open" && !t.blockedBy.every(closed),
);
const claimed = tickets.filter((t) => t.status === "open" && t.assignee);

const show = (t: Ticket) =>
  `  ${t.id}  ${t.title}  ${t.labels.join(" ")}${t.assignee ? `  @${t.assignee}` : ""}${
    t.blockedBy.length ? `  ⛔ ${t.blockedBy.filter((b) => !closed(b)).join(",")}` : ""
  }`;

console.log(`\nFRONTIER (${frontier.length})`);
frontier.forEach((t) => console.log(show(t)));
console.log(`\nCLAIMED (${claimed.length})`);
claimed.forEach((t) => console.log(show(t)));
console.log(`\nBLOCKED (${blocked.length})`);
blocked.forEach((t) => console.log(show(t)));
console.log(
  `\nCLOSED (${tickets.filter((t) => t.status === "closed").length}/${tickets.length})\n`,
);
