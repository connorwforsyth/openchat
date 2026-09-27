import type { ReactNode } from "react";

import { SectionNav, type SectionNavItem } from "./section-nav";

// Settings and admin share one frame: a heading, the page list, the page.
// Deliberately plain; 025 puts it inside the app shell's main column.

export const SectionLayout = ({
  back,
  children,
  heading,
  items,
  navLabel,
}: {
  readonly back?: ReactNode;
  readonly children: ReactNode;
  readonly heading: ReactNode;
  readonly items: readonly SectionNavItem[];
  readonly navLabel: string;
}) => (
  <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
    <div className="flex flex-col gap-2">
      {back}
      <p className="font-medium text-xl">{heading}</p>
    </div>
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <aside className="md:w-48 md:shrink-0">
        <SectionNav items={items} label={navLabel} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
    </div>
  </div>
);
