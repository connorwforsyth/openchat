"use client";

import type { LinkComponent } from "@workspace/library-ui/components/library-index";
import Link from "next/link";

/** The library screens' links, as Next client-side navigations. */
export const NextLink: LinkComponent = ({ children, className, href }) => (
  <Link className={className} href={href}>
    {children}
  </Link>
);
