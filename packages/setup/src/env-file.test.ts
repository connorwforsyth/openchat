import { describe, expect, it } from "vitest";

import { APPENDED_HEADER, formatValue, parseEnv, updateEnv } from "./env-file";

describe("parseEnv", () => {
  it("reads plain, quoted, exported and commented values", () => {
    const env = parseEnv(
      [
        "# a comment",
        "PLAIN=value",
        "EMPTY=",
        'DOUBLE="has space # not a comment"',
        "SINGLE='x=y'",
        "export EXPORTED=yes",
        "INLINE=value # a comment",
        "  SPACED = padded  ",
      ].join("\n")
    );
    expect(env).toEqual({
      DOUBLE: "has space # not a comment",
      EMPTY: "",
      EXPORTED: "yes",
      INLINE: "value",
      PLAIN: "value",
      SINGLE: "x=y",
      SPACED: "padded",
    });
  });

  it("keeps the last of a repeated name, as compose does", () => {
    expect(parseEnv("A=1\nA=2")).toEqual({ A: "2" });
  });
});

describe("updateEnv", () => {
  const base = "# header\nA=1\n\n# section\nB=\nC=keep\n";

  it("rewrites lines in place and keeps everything else", () => {
    expect(updateEnv(base, { A: "2", B: "set" })).toBe(
      "# header\nA=2\n\n# section\nB=set\nC=keep\n"
    );
  });

  it("clears with null and leaves the line", () => {
    expect(updateEnv(base, { A: null })).toBe(
      "# header\nA=\n\n# section\nB=\nC=keep\n"
    );
  });

  it("leaves a line byte for byte when the value already matches", () => {
    const text = "A='1' # set by hand\n";
    expect(updateEnv(text, { A: "1" })).toBe(text);
  });

  it("appends new names once under a header", () => {
    const once = updateEnv(base, { D: "new" });
    expect(once).toBe(`${base}\n${APPENDED_HEADER}\nD=new\n`);
    expect(updateEnv(once, { E: "newer" })).toBe(
      `${base}\n${APPENDED_HEADER}\nD=new\nE=newer\n`
    );
  });

  it("doesn't append a variable that's only being cleared", () => {
    expect(updateEnv(base, { MISSING: null })).toBe(base);
  });

  it("rewrites every line of a repeated name", () => {
    expect(updateEnv("A=1\nA=2\n", { A: "3" })).toBe("A=3\nA=3\n");
  });

  it("quotes values that would otherwise be misread", () => {
    expect(formatValue("plain-value_1")).toBe("plain-value_1");
    expect(formatValue('with space "and" quotes')).toBe(
      '"with space \\"and\\" quotes"'
    );
    const written = updateEnv("", { A: 'a #b "c"' });
    expect(parseEnv(written).A).toBe('a #b "c"');
  });
});
