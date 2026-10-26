// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/app/lib/text-diff.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
export function textDiff(prevText: string, nextText: string) {
  let start = 0;
  while (
    start < prevText.length &&
    start < nextText.length &&
    prevText[start] === nextText[start]
  ) {
    start += 1;
  }

  let prevEnd = prevText.length;
  let nextEnd = nextText.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    prevText[prevEnd - 1] === nextText[nextEnd - 1]
  ) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  return { end: prevEnd, start, value: nextText.slice(start, nextEnd) };
}
