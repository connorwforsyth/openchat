"use client";

import { Plural } from "@lingui/react/macro";
import type { AnnotationsData } from "@workspace/ai/messages/annotations";
import { SquareDashedMousePointerIcon } from "@workspace/icons";

import { TargetWords } from "./target-words";

/**
 * A sent message's notes on an artifact, as the person wrote them: the
 * artifact, then each note with what it points at. The message's text is
 * what the model read; this is what people read.
 */
export function AnnotationsNote({ data }: { readonly data: AnnotationsData }) {
  const count = data.notes.length;
  return (
    <div
      className="flex flex-col gap-2 text-sm"
      data-artifact-id={data.artifactId}
      data-slot="message-annotations"
    >
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <SquareDashedMousePointerIcon aria-hidden className="size-3.5" />
        <Plural
          one={`# note on ${data.title}`}
          other={`# notes on ${data.title}`}
          value={count}
        />
      </p>
      <ol className="flex list-decimal flex-col gap-1.5 ps-5">
        {data.notes.map((note, index) => (
          // Notes have no ids once sent; their order is fixed.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <li key={index}>
            <span>{note.note}</span>
            {note.target ? (
              <span className="block truncate text-muted-foreground text-xs">
                <TargetWords target={note.target} />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
