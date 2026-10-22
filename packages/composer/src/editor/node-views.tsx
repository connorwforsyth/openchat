"use client";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { cn } from "@workspace/ui/lib/utils";

import { Chip } from "../components/chip";
import type { MentionAttrs } from "./extensions";

// How chips and a prompt's variables draw inside the editor. Both are atoms:
// the caret goes around them, Backspace takes one whole.

export function ChipView({ node }: NodeViewProps) {
  const { id, kind, label, versionId } = node.attrs as MentionAttrs;
  return (
    <NodeViewWrapper as="span" className="mx-px">
      <Chip
        artifact={kind === "artifact" ? (id as ArtifactKind) : undefined}
        draft={Boolean(versionId)}
        kind={kind}
        label={label}
      />
    </NodeViewWrapper>
  );
}

export function VariableView({ node, selected }: NodeViewProps) {
  const name = String(node.attrs.name);
  const description = node.attrs.description as string | null;
  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "rounded-sm border border-border border-dashed px-1 font-mono text-[0.9em] text-muted-foreground",
        selected && "border-ring bg-accent text-accent-foreground"
      )}
      data-variable={name}
      title={description ?? undefined}
    >
      {name}
    </NodeViewWrapper>
  );
}
