"use client";

import { cn } from "@workspace/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The left-hand list of pages in settings and admin. Client-side only for
// `aria-current`; the labels are rendered (and translated) on the server.

export interface SectionNavItem {
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: ReactNode;
}

export const SectionNav = ({
  items,
  label,
}: {
  readonly items: readonly SectionNavItem[];
  readonly label: string;
}) => {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {items.map((item) => {
          const current =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-muted-foreground text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
                  current && "bg-muted text-foreground"
                )}
                href={item.href}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/** A page title with an optional line under it. */
export const PageHeader = ({
  description,
  title,
}: {
  readonly description?: ReactNode;
  readonly title: ReactNode;
}) => (
  <header className="flex flex-col gap-1">
    <h1 className="font-medium text-lg">{title}</h1>
    {description ? (
      <p className="text-muted-foreground text-sm">{description}</p>
    ) : null}
  </header>
);
