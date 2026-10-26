import type {
  ComposerChatMode,
  ComposerProps,
} from "@workspace/composer/props";
import type { PublicConfig } from "@workspace/contract/schemas/meta";

/** Whether the chat shows Chat / Code: offered here and on in the instance. Pure. */
export const showsModes = (
  config: PublicConfig,
  offered: boolean | undefined
): boolean => offered === true && config.chatModes === true;

/**
 * The Chat / Code switch, and the menu held to the mode, where the chat is
 * inside the switch and the instance has sandboxes. Pure.
 */
export const chatModeSwitch = (
  config: PublicConfig,
  shown: boolean,
  chatMode: ComposerChatMode
): Pick<ComposerProps, "chatMode" | "mode"> =>
  shown && config.features.sandboxes ? { chatMode, mode: chatMode.mode } : {};
