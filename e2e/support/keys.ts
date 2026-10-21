// The palette's ⌘K comes from @workspace/shortcuts, which picks the platform
// from the user agent. The Desktop Chrome device's agent says Windows, so the
// app binds Ctrl+K on every host; ControlOrMeta would send Meta on a Mac.
export const PALETTE_KEY = "Control+K";
