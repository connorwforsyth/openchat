import { describe, expect, it } from "vitest";

import {
  acceptAttribute,
  admitFiles,
  checkAttachment,
  filesFromTransfer,
  matchesAccept,
} from "./attachments";

const file = (name: string, type: string, bytes = 1) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("matchesAccept", () => {
  it("accepts anything without a list", () => {
    expect(matchesAccept(file("a.bin", ""), undefined)).toBe(true);
    expect(matchesAccept(file("a.bin", ""), [])).toBe(true);
  });

  it("matches MIME types, wildcards and extensions, ignoring case", () => {
    const accept = ["application/pdf", "image/*", ".MD"];
    expect(matchesAccept(file("a.pdf", "application/pdf"), accept)).toBe(true);
    expect(matchesAccept(file("a.png", "image/png"), accept)).toBe(true);
    expect(matchesAccept(file("notes.md", ""), accept)).toBe(true);
    expect(matchesAccept(file("a.txt", "text/plain"), accept)).toBe(false);
  });
});

describe("acceptAttribute", () => {
  it("joins the list for the file input", () => {
    expect(acceptAttribute({ accept: ["image/*", ".md"] })).toBe("image/*,.md");
    expect(acceptAttribute({})).toBeUndefined();
  });
});

describe("checkAttachment", () => {
  it("rejects the wrong type before the size", () => {
    expect(
      checkAttachment(file("a.txt", "text/plain", 10), {
        accept: ["image/*"],
        maxFileSize: 1,
      })
    ).toEqual({ error: { code: "type", fileName: "a.txt" }, ok: false });
  });

  it("rejects a file over the size limit", () => {
    expect(
      checkAttachment(file("big.png", "image/png", 11), { maxFileSize: 10 })
    ).toEqual({
      error: { code: "size", fileName: "big.png", maxFileSize: 10 },
      ok: false,
    });
  });
});

describe("admitFiles", () => {
  it("takes files in order until the count limit", () => {
    const files = [file("a.txt", "text/plain"), file("b.txt", "text/plain")];
    const { accepted, rejected } = admitFiles(2, files, { maxFiles: 3 });
    expect(accepted.map((f) => f.name)).toEqual(["a.txt"]);
    expect(rejected).toEqual([
      { code: "count", fileName: "b.txt", maxFiles: 3 },
    ]);
  });

  it("doesn't let rejected files use up the count", () => {
    const files = [
      file("big.txt", "text/plain", 5),
      file("ok.txt", "text/plain"),
    ];
    const { accepted, rejected } = admitFiles(0, files, {
      maxFileSize: 2,
      maxFiles: 1,
    });
    expect(accepted.map((f) => f.name)).toEqual(["ok.txt"]);
    expect(rejected).toEqual([
      { code: "size", fileName: "big.txt", maxFileSize: 2 },
    ]);
  });

  it("accepts everything without limits", () => {
    expect(admitFiles(10, [file("a", "")], {}).accepted).toHaveLength(1);
  });
});

describe("filesFromTransfer", () => {
  it("keeps only file items", () => {
    const transfer = new DataTransfer();
    transfer.items.add("just text", "text/plain");
    transfer.items.add(file("a.png", "image/png"));
    expect(filesFromTransfer(transfer).map((f) => f.name)).toEqual(["a.png"]);
    expect(filesFromTransfer(null)).toEqual([]);
  });
});
