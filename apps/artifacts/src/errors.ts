import type {
  RuntimeError,
  RuntimeErrorKind,
} from "@workspace/chat-ui/artifacts/runtime-protocol";

// Turning whatever an artifact threw into the protocol's error shape.

const MAX_DETAIL = 2000;

export const messageOf = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message || error.name : String(error);
  return message.length > MAX_DETAIL
    ? `${message.slice(0, MAX_DETAIL)}…`
    : message;
};

export const runtimeError = (
  kind: RuntimeErrorKind,
  error: unknown
): RuntimeError => ({ kind, message: messageOf(error) });
