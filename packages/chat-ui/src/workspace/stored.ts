// The panel's remembered layout lives in `localStorage`. Storage can be off
// (private mode, a policy): then reads give nothing, writes are dropped, and
// the panel still works for as long as the page is open.

export const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStored = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved.
  }
};
