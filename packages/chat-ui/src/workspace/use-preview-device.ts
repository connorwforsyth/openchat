"use client";

import { useCallback, useState } from "react";

import {
  DEFAULT_DEVICE,
  deviceStorageKey,
  type PreviewDevice,
  parseDevice,
} from "./model/device";

// The Preview's device, per chat, for the browser session (137). Read when
// the panel mounts or the chat changes; written on each pick.

const readStored = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage can be off (private mode, a policy): the default it is.
    return null;
  }
};

const writeStored = (key: string, value: string): void => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Not kept; the pick still holds while the panel is open.
  }
};

const readDevice = (key: string): PreviewDevice =>
  typeof window === "undefined" ? DEFAULT_DEVICE : parseDevice(readStored(key));

export const usePreviewDevice = (
  chatKey: string | null
): readonly [PreviewDevice, (device: PreviewDevice) => void] => {
  const key = deviceStorageKey(chatKey);
  const [state, setState] = useState(() => ({
    device: readDevice(key),
    key,
  }));
  // Another chat: its own choice.
  if (state.key !== key) {
    setState({ device: readDevice(key), key });
  }
  const setDevice = useCallback(
    (device: PreviewDevice) => {
      setState({ device, key });
      writeStored(key, device);
    },
    [key]
  );
  return [state.key === key ? state.device : readDevice(key), setDevice];
};
