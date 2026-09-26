import { FileIcon } from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

// Our header replaces @pierre/diffs' built-in one (D19): it uses the icon
// registry and `packages/ui` styling, and has room for review actions.

export interface CodeHeaderProps {
  /** Trailing controls (view toggles, review actions). */
  readonly actions?: ReactNode;
  readonly className?: string;
  /** Shown after the path: language, change counts. */
  readonly meta?: ReactNode;
  readonly path: string;
}

export function CodeHeader({
  actions,
  className,
  meta,
  path,
}: CodeHeaderProps) {
  const slash = path.lastIndexOf("/");
  const directory = slash === -1 ? "" : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-1.5 text-sm",
        className
      )}
    >
      <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-xs" title={path}>
        <span className="text-muted-foreground">{directory}</span>
        <span className="font-medium text-foreground">{name}</span>
      </span>
      {meta ? (
        <span className="flex items-center gap-2 text-muted-foreground text-xs">
          {meta}
        </span>
      ) : null}
      {actions ? (
        <div className="ms-auto flex items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}
