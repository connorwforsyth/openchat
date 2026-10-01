"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { FileTextIcon } from "@workspace/icons";

import type { SourcePart } from "../model/parts";
import { useConversationActions } from "./actions";
import { UrlSourceChip } from "./link-preview";

/**
 * The citations a message used: web pages (with favicon and a preview card,
 * 101) and chunks of uploaded files.
 */
export function Sources({
  sources,
}: {
  readonly sources: readonly SourcePart[];
}) {
  const { t } = useLingui();
  const { fileUrl } = useConversationActions();
  if (sources.length === 0) {
    return null;
  }
  return (
    <section aria-label={t`Sources`} className="flex flex-col gap-1.5">
      <h4 className="font-medium text-muted-foreground text-xs">
        <Trans>Sources</Trans>
      </h4>
      <ol className="flex flex-wrap gap-1.5">
        {sources.map((part, index) => {
          const { source } = part;
          const number = index + 1;
          if (source.kind === "url") {
            return (
              <li key={part.id}>
                <UrlSourceChip
                  number={number}
                  title={source.title}
                  url={source.url}
                />
              </li>
            );
          }
          const name = source.title ?? source.filename ?? t`Uploaded file`;
          const label = source.page ? t`${name}, page ${source.page}` : name;
          const href = fileUrl?.(source.fileId);
          const content = (
            <>
              <span className="text-muted-foreground tabular-nums">
                {number}
              </span>
              <FileTextIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{label}</span>
            </>
          );
          return (
            <li key={part.id}>
              {href ? (
                <a
                  className="flex max-w-64 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-(--motion-fast) hover:bg-muted"
                  href={href}
                >
                  {content}
                </a>
              ) : (
                <span className="flex max-w-64 items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
