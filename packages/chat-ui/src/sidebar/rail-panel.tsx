"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

import { navRowClass } from "./chat-sidebar";

// The panel beside the rail follows the rail (181), as ChatGPT's does: Chats
// shows the chat list, and Scheduled, Library and Artifacts show their own
// navigation here, in the same rows and rhythm. Each panel keeps to its own
// focus: New chat and Search chats belong to Chats alone, and a panel brings
// its own primary action ("New task") instead.

export interface RailPanelLink {
  /** The page it's showing: filled, and `aria-current`. */
  readonly active?: boolean;
  readonly href: string;
  readonly icon?: ReactNode;
  readonly id: string;
  readonly label: string;
  /** Quiet text at the row's end (a time, a status). */
  readonly meta?: ReactNode;
}

export interface RailPanelSection {
  /** Said when `links` is empty; the section hides without it. */
  readonly empty?: ReactNode;
  /** Left out for the panel's first, unheaded group. */
  readonly heading?: string;
  readonly id: string;
  readonly links: readonly RailPanelLink[];
}

export interface RailPanelProps {
  /** A primary action under the heading ("New task"). */
  readonly action?: RailPanelLink;
  /** The panel's name, as a section heading over the list. */
  readonly label: string;
  readonly sections: readonly RailPanelSection[];
}

const headingClass = "px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs";

function PanelRow({ link }: { readonly link: RailPanelLink }) {
  return (
    <li>
      <a
        aria-current={link.active ? "page" : undefined}
        className={cn(
          navRowClass,
          "rounded-lg",
          link.active && "bg-sidebar-foreground/8 hover:bg-sidebar-foreground/8"
        )}
        href={link.href}
      >
        {link.icon}
        <span className="min-w-0 flex-1 truncate">{link.label}</span>
        {link.meta ? (
          <span className="shrink-0 text-muted-foreground text-xs">
            {link.meta}
          </span>
        ) : null}
      </a>
    </li>
  );
}

/** A rail destination's panel: an optional action, then headed link lists. */
export function RailPanel({ action, label, sections }: RailPanelProps) {
  return (
    <nav aria-label={label} className="flex flex-col" data-slot="rail-panel">
      <h2 className={cn(headingClass, "pt-1")}>{label}</h2>
      {action ? (
        <ul className="flex flex-col">
          <PanelRow link={action} />
        </ul>
      ) : null}
      {sections.map((section) =>
        section.links.length === 0 && !section.empty ? null : (
          <section
            aria-label={section.heading}
            data-panel-section={section.id}
            key={section.id}
          >
            {section.heading ? (
              <h3 className={headingClass}>{section.heading}</h3>
            ) : null}
            {section.links.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-sm">
                {section.empty}
              </p>
            ) : (
              <ul className="flex flex-col gap-px">
                {section.links.map((link) => (
                  <PanelRow key={link.id} link={link} />
                ))}
              </ul>
            )}
          </section>
        )
      )}
    </nav>
  );
}
