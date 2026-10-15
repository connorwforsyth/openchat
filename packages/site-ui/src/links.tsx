import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "cn";

import { SiteIcon, type SiteIconName } from "./icons";

// Links and the buttons that are links. A site's buttons go somewhere (a
// page, an anchor, another site), so they're `<a>` styled as the kit's
// button rather than `<button>`: a static page has nothing to click into.

export interface SiteLink {
  readonly href: string;
  readonly label: string;
}

export interface SiteAction extends SiteLink {
  readonly icon?: SiteIconName;
  readonly variant?: "default" | "ghost" | "outline" | "secondary";
}

export function ActionLink({
  action,
  className,
}: {
  readonly action: SiteAction;
  readonly className?: string;
}) {
  return (
    <a
      className={cn(
        buttonVariants({ size: "lg", variant: action.variant ?? "default" }),
        "px-4",
        className
      )}
      href={action.href}
    >
      {action.label}
      {action.icon ? <SiteIcon className="size-4" name={action.icon} /> : null}
    </a>
  );
}

export function Actions({
  actions,
  className,
}: {
  readonly actions: readonly SiteAction[] | undefined;
  readonly className?: string;
}) {
  if (!actions || actions.length === 0) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {actions.map((action) => (
        <ActionLink action={action} key={`${action.href}${action.label}`} />
      ))}
    </div>
  );
}
