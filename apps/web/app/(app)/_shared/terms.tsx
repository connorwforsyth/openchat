"use client";

import { defaultTerms, type Terms } from "@workspace/config/terms";
import { createContext, type ReactNode, useContext } from "react";

// What this instance calls its features (191), resolved on the server for
// the viewer's locale and inlined with the page. Without a provider (tests,
// a bad config) the defaults apply.

const TermsContext = createContext<Terms>(defaultTerms);

export const TermsProvider = ({
  children,
  terms,
}: {
  readonly children: ReactNode;
  readonly terms: Terms;
}) => <TermsContext.Provider value={terms}>{children}</TermsContext.Provider>;

export const useTerms = (): Terms => useContext(TermsContext);
