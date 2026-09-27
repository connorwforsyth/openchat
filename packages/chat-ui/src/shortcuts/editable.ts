// Single-key shortcuts must never fire while someone is typing, or inside a
// widget that owns its keys (menus type-ahead, dialogs, list boxes). This is
// the one check for both.

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const KEY_OWNING_WIDGETS =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="combobox"], [role="grid"]';

/** True when a key press on `target` belongs to the target, not to the app. */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (target.getAttribute("role") === "textbox") {
    return true;
  }
  return target.closest(KEY_OWNING_WIDGETS) !== null;
};

const APPLE = /Mac|iPhone|iPad|iPod/i;

/** Apple platforms use ⌘ where others use Ctrl. */
export const isApplePlatform = (navigatorLike: {
  readonly platform?: string;
  readonly userAgent?: string;
}): boolean =>
  APPLE.test(navigatorLike.platform || navigatorLike.userAgent || "");
