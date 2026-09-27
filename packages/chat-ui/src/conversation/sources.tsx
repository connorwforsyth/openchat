"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLinkIcon, FileTextIcon } from "@workspace/icons";

import type { SourcePart } from "../model/parts";
import { useConversationActions } from "./actions";

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The citations a message used: web pages and chunks of uploaded files. */
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
            const label = source.title ?? hostOf(source.url);
            return (
              <li key={part.id}>
                <a
                  className="flex max-w-64 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-(--motion-fast) hover:bg-muted"
                  href={source.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {number}
                  </span>
                  <span className="truncate">{label}</span>
                  <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
                </a>
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
