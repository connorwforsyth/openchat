"use client";

import { useLingui } from "@lingui/react/macro";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";
import { memo, useMemo } from "react";
import {
  type IconMap,
  Streamdown,
  type StreamdownTranslations,
} from "streamdown";

// Model output as markdown. shadcn's Message pattern renders replies with
// Streamdown in a project-owned `markdown` component; this is ours.

// Streamdown ships its own glyphs and English labels. Handing it the registry's
// icons (D19) and Lingui strings (D12) keeps rendered markdown on the active
// icon set and locale like everything else.
//
// The cast is sound: registry icons accept every prop Streamdown passes (their
// `size` is wider); TypeScript only balks at class components' `defaultProps`.
const icons = {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} as IconMap;

export const useStreamdownDefaults = (): {
  readonly icons: IconMap;
  readonly translations: StreamdownTranslations;
} => {
  const { t } = useLingui();

  const translations = useMemo<StreamdownTranslations>(
    () => ({
      close: t`Close`,
      copied: t`Copied`,
      copyCode: t`Copy code`,
      copyLink: t`Copy link`,
      copyTable: t`Copy table`,
      copyTableAsCsv: t`Copy table as CSV`,
      copyTableAsMarkdown: t`Copy table as Markdown`,
      copyTableAsTsv: t`Copy table as TSV`,
      downloadDiagram: t`Download diagram`,
      downloadDiagramAsMmd: t`Download diagram as MMD`,
      downloadDiagramAsPng: t`Download diagram as PNG`,
      downloadDiagramAsSvg: t`Download diagram as SVG`,
      downloadFile: t`Download file`,
      downloadImage: t`Download image`,
      downloadTable: t`Download table`,
      downloadTableAsCsv: t`Download table as CSV`,
      downloadTableAsMarkdown: t`Download table as Markdown`,
      exitFullscreen: t`Exit fullscreen`,
      externalLinkWarning: t`You're about to visit an external website.`,
      imageNotAvailable: t`Image not available`,
      mermaidFormatMmd: t`MMD`,
      mermaidFormatPng: t`PNG`,
      mermaidFormatSvg: t`SVG`,
      openExternalLink: t`Open external link?`,
      openLink: t`Open link`,
      resetView: t`Reset zoom and pan`,
      tableFormatCsv: t`CSV`,
      tableFormatMarkdown: t`Markdown`,
      tableFormatTsv: t`TSV`,
      viewFullscreen: t`View fullscreen`,
      zoomIn: t`Zoom in`,
      zoomOut: t`Zoom out`,
    }),
    [t]
  );

  return { icons, translations };
};

export type MarkdownProps = ComponentProps<typeof Streamdown>;

export const Markdown = memo(
  ({ className, ...props }: MarkdownProps) => {
    const defaults = useStreamdownDefaults();

    return (
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        icons={defaults.icons}
        translations={defaults.translations}
        {...props}
      />
    );
  },
  // Re-rendering markdown is the expensive part of streaming; only a change in
  // the text itself warrants it.
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

Markdown.displayName = "Markdown";
