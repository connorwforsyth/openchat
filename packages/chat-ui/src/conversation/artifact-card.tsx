"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDownIcon, ExternalLinkIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { ButtonGroup } from "@workspace/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { type MouseEvent, useCallback } from "react";

import { KindLabel, kindIcon } from "../artifacts/kind-icon";
import type { ArtifactRefPart } from "../model/parts";
import { useConversationActions } from "./actions";

const stopPropagation = (event: MouseEvent) => event.stopPropagation();

/**
 * A reference to an artifact the message made (night 2, after ChatGPT's
 * card): its title and kind, and an Open that shows it in the panel, with
 * its own page a menu away. The whole card opens it too, for the pointer;
 * Open is the way in from the keyboard.
 */
export function ArtifactCard({ part }: { readonly part: ArtifactRefPart }) {
  const { t } = useLingui();
  const { artifactHref, onOpenArtifact } = useConversationActions();
  const open = useCallback(
    () => onOpenArtifact?.(part),
    [onOpenArtifact, part]
  );
  // The kinds' own names and icons, as the panel and the Artifacts page
  // show them.
  const Icon = kindIcon(part.kind);
  const { title } = part;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the card's surface for the pointer; Open is the same action from the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: the same.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the same.
    <div
      className={cn(
        "flex w-full max-w-md items-center gap-3 rounded-lg border px-3 py-2",
        onOpenArtifact &&
          "cursor-pointer transition-colors duration-(--motion-fast) hover:bg-muted"
      )}
      data-slot="artifact-card"
      onClick={onOpenArtifact ? open : undefined}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">
          <KindLabel kind={part.kind} />
        </span>
      </span>
      {onOpenArtifact ? (
        // Its own presses aren't the card's.
        <ButtonGroup className="shrink-0" onClick={stopPropagation}>
          <Button
            aria-label={t`Open artifact: ${title}`}
            onClick={open}
            size="sm"
            variant="outline"
          >
            <Trans>Open</Trans>
          </Button>
          {artifactHref ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t`More ways to open ${title}`}
                    size="icon-sm"
                    variant="outline"
                  />
                }
              >
                <ChevronDownIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  render={
                    <a
                      href={artifactHref(part.artifactId)}
                      rel="noopener"
                      target="_blank"
                    />
                  }
                >
                  <ExternalLinkIcon aria-hidden />
                  <Trans>Open in a new tab</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ButtonGroup>
      ) : null}
    </div>
  );
}
