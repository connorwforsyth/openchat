import { Separator } from "@workspace/ui/components/separator";
import { cn } from "cn";
import type { ReactNode } from "react";

import { Actions, type SiteAction, type SiteLink } from "./links";

// The frame of a page: the page itself, its sections, the bar along the top
// and the footer, and running text. Every word arrives as a prop, aria
// labels included: it's the site's content, in the site's language, not
// the product's UI (so not Lingui's).

/** A page: the theme's background and text, full height. */
export function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground antialiased">
      {children}
    </div>
  );
}

const WIDTH = "mx-auto w-full max-w-6xl px-6";

/** A heading and a lede over a section's content, when there are any. */
function SectionHeading({
  align = "center",
  description,
  title,
}: {
  readonly align?: "center" | "start";
  readonly description?: string;
  readonly title?: string;
}) {
  if (!(title || description)) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-3",
        align === "center" ? "mx-auto items-center text-center" : "text-start"
      )}
    >
      {title ? (
        <h2 className="text-balance font-semibold text-3xl tracking-tight">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="text-pretty text-lg text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export interface SectionProps {
  readonly children?: ReactNode;
  readonly description?: string;
  /** The anchor a link can jump to (`href="#pricing"`). */
  readonly id?: string;
  readonly title?: string;
  /** `muted` sets a section apart on the muted background. */
  readonly tone?: "default" | "muted";
}

/** A band of the page, with an optional heading. */
export function Section({
  children,
  description,
  id,
  title,
  tone = "default",
}: SectionProps) {
  return (
    <section className={cn("py-20", tone === "muted" && "bg-muted/50")} id={id}>
      <div className={cn(WIDTH, "flex flex-col gap-12")}>
        <SectionHeading description={description} title={title} />
        {children}
      </div>
    </section>
  );
}

export interface NavProps {
  /** The site's name, linking home. */
  readonly brand: string;
  /** Where `brand` links; the home page by default. */
  readonly brandHref?: string;
  readonly cta?: SiteAction;
  /** What a screen reader calls the bar, like "Main". */
  readonly label: string;
  readonly links?: readonly SiteLink[];
}

/** The bar along the top: the site's name, its pages and one action. */
export function Nav({
  brand,
  brandHref = "index.html",
  cta,
  label,
  links = [],
}: NavProps) {
  return (
    <header className="border-border border-b bg-background">
      <nav
        aria-label={label}
        className={cn(WIDTH, "flex h-16 items-center gap-6")}
      >
        <a className="font-semibold text-lg tracking-tight" href={brandHref}>
          {brand}
        </a>
        <ul className="ms-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {links.map((link) => (
            <li key={`${link.href}${link.label}`}>
              <a
                className="text-muted-foreground transition-colors hover:text-foreground"
                href={link.href}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        {cta ? <Actions actions={[cta]} /> : null}
      </nav>
    </header>
  );
}

export interface FooterProps {
  readonly brand?: string;
  /** What a screen reader calls the footer's links, like "Footer". */
  readonly label: string;
  readonly links?: readonly SiteLink[];
  /** A line under it all, like "© 2026 Harbour Walks". */
  readonly note?: string;
}

/** The end of the page: the name, a few links and a line of small print. */
export function Footer({ brand, label, links = [], note }: FooterProps) {
  return (
    <footer className="mt-auto bg-background py-10 text-sm">
      <div className={cn(WIDTH, "flex flex-col gap-6")}>
        <Separator />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {brand ? <span className="font-semibold">{brand}</span> : null}
          <nav aria-label={label} className="ms-auto">
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {links.map((link) => (
                <li key={`${link.href}${link.label}`}>
                  <a
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    href={link.href}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        {note ? <p className="text-muted-foreground">{note}</p> : null}
      </div>
    </footer>
  );
}

/**
 * Running text written as plain elements (`h2`, `p`, `ul`, `a`,
 * `blockquote`), styled for reading: an article, an about page, terms.
 */
export function Prose({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-prose px-6 py-16 text-base leading-7",
        "[&_h1]:mb-6 [&_h1]:text-balance [&_h1]:font-semibold [&_h1]:text-4xl [&_h1]:tracking-tight",
        "[&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:font-semibold [&_h2]:text-2xl [&_h2]:tracking-tight",
        "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:font-semibold [&_h3]:text-xl",
        "[&_p]:my-4 [&_p]:text-pretty",
        "[&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:ps-6",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
        "[&_blockquote]:my-6 [&_blockquote]:border-border [&_blockquote]:border-s-2 [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm"
      )}
    >
      {children}
    </div>
  );
}
