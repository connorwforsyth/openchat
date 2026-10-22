"use client";

import { Trans } from "@lingui/react/macro";
import type { ChipKind } from "@workspace/ai/messages/chips";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import {
  AgentIcon,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  MonitorIcon,
  NetworkIcon,
  PlayIcon,
  SparklesIcon,
  UserIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";

// A chip: what a `/` or `@` pick looks like in the composer's text and in
// the sent message. Its icon says what it is; the label says which one.

/**
 * Each artifact kind's icon, as its definition in `@workspace/artifacts-kit`
 * names it. Kept here rather than read from the kit so the composer's chunk
 * doesn't carry every kind's definition.
 */
export const ARTIFACT_ICONS: Readonly<Record<ArtifactKind, Icon>> = {
  code: CodeIcon,
  diagram: NetworkIcon,
  document: FileTextIcon,
  html: GlobeIcon,
  image: ImageIcon,
  markdown: FileTextIcon,
  mermaid: NetworkIcon,
  presentation: PlayIcon,
  react: LayersIcon,
  site: MonitorIcon,
  spreadsheet: LayoutGridIcon,
  svg: ImageIcon,
};

const KIND_ICONS: Readonly<Record<ChipKind, Icon>> = {
  agent: AgentIcon,
  artifact: SparklesIcon,
  file: FileIcon,
  skill: SparklesIcon,
  user: UserIcon,
};

export const chipIcon = (kind: ChipKind, artifact?: ArtifactKind): Icon =>
  kind === "artifact" && artifact ? ARTIFACT_ICONS[artifact] : KIND_ICONS[kind];

export interface ChipProps {
  /** For an artifact chip, which kind: picks its icon. */
  readonly artifact?: ArtifactKind;
  readonly className?: string;
  /** The owner's unpublished draft. */
  readonly draft?: boolean;
  readonly kind: ChipKind;
  readonly label: string;
}

export function Chip({ artifact, className, draft, kind, label }: ChipProps) {
  const Glyph = chipIcon(kind, artifact);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-baseline gap-1 rounded-md bg-accent px-1 align-baseline font-medium text-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:self-center [&_svg]:text-muted-foreground",
        className
      )}
      data-chip={kind}
    >
      <Glyph aria-hidden />
      <span className="truncate">{label}</span>
      {draft ? (
        <span className="text-muted-foreground text-xs">
          <Trans>Draft</Trans>
        </span>
      ) : null}
    </span>
  );
}
