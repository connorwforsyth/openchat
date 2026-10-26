"use client";

import { type DisplayCurrency, USD } from "@workspace/config/currency";
import { createContext, type ReactNode, useContext } from "react";

// The currency costs are shown in (`usage.currency`), read on the server and
// inlined with the page. Without a provider (tests, a bad config) it's USD.

const CurrencyContext = createContext<DisplayCurrency>(USD);

export const CurrencyProvider = ({
  children,
  currency,
}: {
  readonly children: ReactNode;
  readonly currency: DisplayCurrency;
}) => (
  <CurrencyContext.Provider value={currency}>
    {children}
  </CurrencyContext.Provider>
);

export const useCurrency = (): DisplayCurrency => useContext(CurrencyContext);
