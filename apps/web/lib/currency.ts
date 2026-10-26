import { type DisplayCurrency, USD } from "@workspace/config/currency";
import { loadConfig } from "@workspace/config/load";

// `usage.currency` from app.config.yaml, read once per process like the
// terms. A missing or invalid file means USD.

let loading: Promise<DisplayCurrency> | undefined;

const load = async (): Promise<DisplayCurrency> => {
  try {
    const loaded = await loadConfig();
    return loaded.ok ? loaded.value.config.usage.currency : USD;
  } catch {
    return USD;
  }
};

export const getCurrency = (): Promise<DisplayCurrency> => {
  loading ??= load();
  return loading;
};
