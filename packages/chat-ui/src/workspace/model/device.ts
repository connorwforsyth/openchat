import { z } from "zod";

// The device the Preview draws its page for (137): the panel's own width, or
// a tablet's or a phone's, centred in an outline. Chosen per chat and kept
// for the browser session (`sessionStorage`), so it survives a reload and
// switching chats but doesn't follow the person to tomorrow.

export const previewDeviceSchema = z.enum(["desktop", "tablet", "phone"]);
export type PreviewDevice = z.infer<typeof previewDeviceSchema>;

export const PREVIEW_DEVICES: readonly PreviewDevice[] =
  previewDeviceSchema.options;

/** CSS pixels the page gets; `null` is the browser half's own width. */
export const DEVICE_WIDTH: Readonly<Record<PreviewDevice, number | null>> = {
  desktop: null,
  phone: 390,
  tablet: 768,
};

export const DEFAULT_DEVICE: PreviewDevice = "desktop";

/** Where a chat's choice is kept; a chat not created yet shares one key. */
export const deviceStorageKey = (chatKey: string | null): string =>
  `chat-ui:preview-device:${chatKey ?? "new"}`;

/** Reads a stored device; anything unreadable is the default. */
export const parseDevice = (raw: string | null): PreviewDevice => {
  const parsed = previewDeviceSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_DEVICE;
};
