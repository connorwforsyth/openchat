"use client";

import { useLingui } from "@lingui/react/macro";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import {
  CodeIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  NetworkIcon,
} from "@workspace/icons";
import type { IconName } from "@workspace/icons/names";

import {
  artifactKindDefinition,
  artifactKindLabels,
} from "../model/artifact-kinds";

// A kind's icon is named by its definition in the kit (`icon`); this maps
// the names the kinds use to components, so a new kind only needs its
// icon added here if it picks one nobody uses yet.

const kindIcons: Partial<Record<IconName, Icon>> = {
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  NetworkIcon,
};

export const kindIcon = (kind: ArtifactKind): Icon =>
  kindIcons[artifactKindDefinition(kind).icon] ?? FileIcon;

/** The kind's icon, labelled with the kind's name for screen readers. */
export function KindIcon({
  className,
  kind,
}: {
  readonly className?: string;
  readonly kind: ArtifactKind;
}) {
  const { i18n } = useLingui();
  const Glyph = kindIcon(kind);
  return (
    <Glyph
      aria-label={i18n._(artifactKindLabels[kind])}
      className={className}
      role="img"
    />
  );
}

/** The kind's name in the reader's language. */
export function KindLabel({ kind }: { readonly kind: ArtifactKind }) {
  const { i18n } = useLingui();
  return <>{i18n._(artifactKindLabels[kind])}</>;
}
